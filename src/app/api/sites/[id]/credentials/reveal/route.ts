import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecrets } from "@/lib/crypto";
import { getSession } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

/** Restituisce gli accessi FTP/SFTP in chiaro per copia (solo sessione autenticata). */
export async function POST(_req: Request, { params }: Params) {
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
      { error: "Nessun accesso configurato" },
      { status: 404 },
    );
  }

  const secrets = decryptSecrets(site.secretsEnc);
  if (!secrets.sftp) {
    return NextResponse.json(
      { error: "Accessi FTP/SFTP non configurati" },
      { status: 404 },
    );
  }

  const sftp = secrets.sftp;
  const protocol = sftp.protocol ?? "sftp";
  const port =
    sftp.port ??
    (protocol === "ftp" ? 21 : protocol === "ftps" ? 990 : 22);

  await prisma.auditLog.create({
    data: {
      siteId: id,
      event: "credentials.revealed",
      detail: JSON.stringify({
          userId: session.id,
        channel: "sftp",
        protocol,
      }),
    },
  });

  return NextResponse.json({
    sftp: {
      host: sftp.host,
      port,
      username: sftp.username,
      password: sftp.password ?? "",
      protocol,
      rootPath: sftp.rootPath,
      hasPrivateKey: Boolean(sftp.privateKey),
    },
  });
}
