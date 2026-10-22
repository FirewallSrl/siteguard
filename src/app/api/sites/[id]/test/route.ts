import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { testSiteConnection } from "@/lib/secrets/test-connection";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    channels: z.array(z.enum(["sftp", "api"])).optional(),
  })
  .optional();

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id } });
  if (!site) {
    return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
  }

  let channels: Array<"sftp" | "api"> | undefined;
  try {
    const json = await req.json().catch(() => undefined);
    channels = bodySchema.parse(json)?.channels;
  } catch {
    return NextResponse.json({ error: "Body non valido" }, { status: 400 });
  }

  const result = await testSiteConnection({
    siteId: site.id,
    siteUrl: site.url,
    cms: site.cms,
    secretsEnc: site.secretsEnc,
    channels,
  });

  const anyOk =
    (result.sftp?.ok ?? false) || (result.api?.ok ?? false);
  const anyFail =
    (result.sftp && !result.sftp.ok) || (result.api && !result.api.ok);

  await prisma.site.update({
    where: { id },
    data: {
      status: anyOk && !anyFail ? "connected" : anyOk ? "connected" : "error",
    },
  });

  await prisma.auditLog.create({
    data: {
      siteId: id,
      event: "credentials.tested",
      detail: JSON.stringify({
        sftpOk: result.sftp?.ok ?? null,
        apiOk: result.api?.ok ?? null,
        // solo esiti, niente secret
      }),
    },
  });

  return NextResponse.json(result);
}
