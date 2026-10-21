import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecrets, encryptSecrets } from "@/lib/crypto";
import { mergeSecrets, toSecretsMeta } from "@/lib/secrets/safe";

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
    const merged = mergeSecrets(current, body);
    const secretsEnc =
      merged.sftp || merged.api ? encryptSecrets(merged) : null;

    const updated = await prisma.site.update({
      where: { id },
      data: {
        secretsEnc,
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
          // mai password / chiavi
        }),
      },
    });

    const secrets = secretsEnc ? decryptSecrets(secretsEnc) : null;
    return NextResponse.json({
      ok: true,
      status: updated.status,
      meta: toSecretsMeta(secrets),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Errore";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
