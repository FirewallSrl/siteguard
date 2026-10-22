import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecrets } from "@/lib/crypto";
import { getSession } from "@/lib/auth/session";
import { withSftp, modifyTimeToIso } from "@/lib/sftp/client";
import { sanitizeErrorMessage } from "@/lib/secrets/safe";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  path: z.string().min(1).max(1024),
});

/** Legge mtime/size di un file remoto (per data compromissione stimata). */
export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id } });
  if (!site) {
    return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
  }
  if (!site.secretsEnc) {
    return NextResponse.json(
      { error: "Accessi non configurati" },
      { status: 400 },
    );
  }

  let path: string;
  try {
    path = bodySchema.parse(await req.json()).path;
  } catch {
    return NextResponse.json({ error: "Path non valido" }, { status: 400 });
  }

  // Evita path traversal grossolani
  if (path.includes("..") || path.startsWith("~")) {
    return NextResponse.json({ error: "Path non consentito" }, { status: 400 });
  }

  const secrets = decryptSecrets(site.secretsEnc);
  if (!secrets.sftp) {
    return NextResponse.json(
      { error: "Accessi FTP/SFTP mancanti" },
      { status: 400 },
    );
  }

  try {
    const meta = await withSftp(secrets.sftp, async (client, root) => {
      const candidates = [
        path,
        path.replace(/^\.\//, ""),
        `${root}/${path}`.replace(/\/+/g, "/"),
        path.startsWith(root)
          ? path
          : `${root}/${path.replace(/^\//, "")}`.replace(/\/+/g, "/"),
      ];
      const unique = [...new Set(candidates)];
      for (const candidate of unique) {
        try {
          const st = await client.stat(candidate);
          if (st.isDirectory) continue;
          return {
            path: candidate,
            size: st.size,
            modifiedAt: modifyTimeToIso(st.modifyTime) ?? null,
          };
        } catch {
          /* try next */
        }
      }
      return null;
    });

    if (!meta) {
      return NextResponse.json(
        { error: "File non trovato sul server" },
        { status: 404 },
      );
    }

    return NextResponse.json(meta);
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
