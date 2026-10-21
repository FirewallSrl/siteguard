import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecrets } from "@/lib/crypto";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  cms: z.enum(["wordpress", "joomla"]).default("wordpress"),
  sftp: z
    .object({
      host: z.string().min(1),
      port: z.number().int().positive().optional(),
      username: z.string().min(1),
      password: z.string().optional(),
      privateKey: z.string().optional(),
      rootPath: z.string().min(1),
    })
    .optional(),
  api: z
    .object({
      username: z.string().min(1),
      appPassword: z.string().min(1),
    })
    .optional(),
});

export async function GET() {
  const sites = await prisma.site.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { findings: true } },
      findings: {
        where: { status: "open" },
        select: { severity: true },
      },
    },
  });

  return NextResponse.json(
    sites.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      cms: s.cms,
      status: s.status,
      lastScanAt: s.lastScanAt,
      openFindings: s.findings.length,
      criticalOpen: s.findings.filter((f) => f.severity === "critical").length,
      createdAt: s.createdAt,
    })),
  );
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    const secrets =
      body.sftp || body.api
        ? encryptSecrets({ sftp: body.sftp, api: body.api })
        : null;

    const site = await prisma.site.create({
      data: {
        name: body.name,
        url: body.url.replace(/\/$/, ""),
        cms: body.cms,
        secretsEnc: secrets,
        status: secrets ? "connected" : "pending",
      },
    });

    await prisma.auditLog.create({
      data: {
        siteId: site.id,
        event: "site.created",
        detail: JSON.stringify({
          hasSftp: Boolean(body.sftp),
          hasApi: Boolean(body.api),
        }),
      },
    });

    const { secretsEnc: _, ...safe } = site;
    return NextResponse.json(
      { ...safe, hasSecrets: Boolean(secrets) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Errore";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
