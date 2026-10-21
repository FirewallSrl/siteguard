import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecrets } from "@/lib/crypto";
import { toSecretsMeta } from "@/lib/secrets/safe";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      findings: {
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        include: {
          actions: {
            where: { status: { in: ["proposed", "approved", "running"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      scans: { orderBy: { createdAt: "desc" }, take: 5 },
      actions: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!site) {
    return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
  }

  const { secretsEnc, ...safe } = site;
  const secrets = secretsEnc ? decryptSecrets(secretsEnc) : null;
  return NextResponse.json({
    ...safe,
    hasSecrets: Boolean(secretsEnc),
    credentials: toSecretsMeta(secrets),
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await prisma.site.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
