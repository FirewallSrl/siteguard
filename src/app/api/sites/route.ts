import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecrets } from "@/lib/crypto";
import { applyDiscovery, discoverSftp } from "@/lib/sftp/discover";
import { sanitizeErrorMessage } from "@/lib/secrets/safe";
import type { SftpCredentials } from "@/lib/types";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  /** Opzionale: se assente viene rilevato via SFTP */
  cms: z.enum(["wordpress", "joomla"]).optional(),
  sftp: z
    .object({
      host: z.string().min(1),
      port: z.number().int().positive().optional(),
      username: z.string().min(1),
      password: z.string().optional(),
      privateKey: z.string().optional(),
      rootPath: z.string().min(1).optional(),
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

    let cms = body.cms ?? "wordpress";
    let sftp: SftpCredentials | undefined = body.sftp
      ? {
          host: body.sftp.host,
          port: body.sftp.port,
          username: body.sftp.username,
          password: body.sftp.password,
          privateKey: body.sftp.privateKey,
          rootPath: body.sftp.rootPath ?? "httpdocs",
        }
      : undefined;

    let discovery:
      | {
          protocol: string;
          port: number;
          rootPath: string;
          cms: string;
          triedPorts: number[];
        }
      | undefined;

    if (sftp && (sftp.password || sftp.privateKey)) {
      try {
        const found = await discoverSftp(sftp);
        sftp = applyDiscovery(sftp, found);
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
            error: `Impossibile collegarsi in SFTP/FTP: ${sanitizeErrorMessage(err)}`,
          },
          { status: 400 },
        );
      }
    }

    const secrets =
      sftp || body.api
        ? encryptSecrets({ sftp, api: body.api })
        : null;

    const site = await prisma.site.create({
      data: {
        name: body.name,
        url: body.url.replace(/\/$/, ""),
        cms,
        secretsEnc: secrets,
        status: secrets ? "connected" : "pending",
      },
    });

    await prisma.auditLog.create({
      data: {
        siteId: site.id,
        event: "site.created",
        detail: JSON.stringify({
          hasSftp: Boolean(sftp),
          hasApi: Boolean(body.api),
          discovery: discovery ?? null,
        }),
      },
    });

    const { secretsEnc: _, ...safe } = site;
    return NextResponse.json(
      {
        ...safe,
        hasSecrets: Boolean(secrets),
        discovery: discovery ?? null,
      },
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
