import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecrets, encryptSecrets } from "@/lib/crypto";
import {
  mergeSecrets,
  sanitizeErrorMessage,
  toSecretsMeta,
} from "@/lib/secrets/safe";
import { applyDiscovery, discoverSftp } from "@/lib/sftp/discover";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  sftp: z
    .object({
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      privateKey: z.string().optional(),
      rootPath: z.string().optional(),
      clear: z.boolean().optional(),
    })
    .optional(),
  api: z
    .object({
      username: z.string().optional(),
      appPassword: z.string().optional(),
      clear: z.boolean().optional(),
    })
    .optional(),
});

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id } });
  if (!site) {
    return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
  }

  const secrets = site.secretsEnc ? decryptSecrets(site.secretsEnc) : null;
  return NextResponse.json({ meta: toSecretsMeta(secrets) });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;

  try {
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) {
      return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
    }

    const body = patchSchema.parse(await req.json());
    if (!body.sftp && !body.api) {
      return NextResponse.json(
        { error: "Nessuna modifica inviata" },
        { status: 400 },
      );
    }

    const current = site.secretsEnc ? decryptSecrets(site.secretsEnc) : null;
    let merged = mergeSecrets(current, body);
    let discovery:
      | {
          protocol: string;
          port: number;
          rootPath: string;
          cms: string;
          triedPorts: number[];
        }
      | undefined;
    let cms = site.cms;

    if (merged.sftp && (merged.sftp.password || merged.sftp.privateKey)) {
      try {
        const found = await discoverSftp(merged.sftp);
        merged = {
          ...merged,
          sftp: applyDiscovery(merged.sftp, found),
        };
        if (found.cms !== "unknown") cms = found.cms;
        discovery = {
          protocol: found.protocol,
          port: found.port,
          rootPath: found.rootPath,
          cms: found.cms,
          triedPorts: found.triedPorts,
        };
      } catch (err) {
        return NextResponse.json(
          {
            error: `SFTP/FTP non raggiungibile: ${sanitizeErrorMessage(err)}`,
          },
          { status: 400 },
        );
      }
    }

    const secretsEnc =
      merged.sftp || merged.api ? encryptSecrets(merged) : null;

    const updated = await prisma.site.update({
      where: { id },
      data: {
        secretsEnc,
        cms,
        status: secretsEnc ? "connected" : "pending",
      },
    });

    await prisma.auditLog.create({
      data: {
        siteId: id,
        event: "credentials.updated",
        detail: JSON.stringify({
          touchedSftp: Boolean(body.sftp),
          touchedApi: Boolean(body.api),
          clearedSftp: Boolean(body.sftp?.clear),
          clearedApi: Boolean(body.api?.clear),
          discovery: discovery ?? null,
        }),
      },
    });

    const secrets = secretsEnc ? decryptSecrets(secretsEnc) : null;
    return NextResponse.json({
      ok: true,
      status: updated.status,
      cms: updated.cms,
      meta: toSecretsMeta(secrets),
      discovery: discovery ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Errore";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
