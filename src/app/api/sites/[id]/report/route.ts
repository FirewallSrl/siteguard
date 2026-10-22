import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getMailConfig, sendMail } from "@/lib/mail/transport";
import { buildSiteReport } from "@/lib/mail/site-report";
import type { SiteInventory } from "@/lib/scanner/inventory/types";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  to: z.string().email(),
  note: z.string().max(2000).optional(),
});

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  await params;
  const cfg = getMailConfig();
  return NextResponse.json({
    configured: Boolean(cfg),
    defaultTo: cfg?.defaultTo ?? session.email ?? null,
    from: cfg?.from ?? null,
  });
}

export async function POST(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { id } = await params;
  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      findings: {
        where: { status: "open" },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!site) {
    return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Indirizzo email non valido" },
      { status: 400 },
    );
  }

  if (!getMailConfig()) {
    return NextResponse.json(
      {
        error:
          "Email non configurata. Imposta SMTP_HOST e SMTP_FROM nel file .env",
      },
      { status: 503 },
    );
  }

  let inventory: SiteInventory | null = null;
  if (site.inventoryJson) {
    try {
      inventory = JSON.parse(site.inventoryJson) as SiteInventory;
    } catch {
      inventory = null;
    }
  }

  const actionable = site.findings.filter((f) => {
    if (f.severity !== "info") return true;
    if (f.type === "config" && /nessun problema/i.test(f.title)) return false;
    if (f.type === "malware" && /nessun segnale/i.test(f.title)) return false;
    if (f.type === "broken_link" && /nessun url rotto/i.test(f.title))
      return false;
    return true;
  });

  const report = buildSiteReport({
    site: {
      name: site.name,
      url: site.url,
      cms: site.cms,
      status: site.status,
      lastScanAt: site.lastScanAt,
    },
    inventory,
    findings: actionable.map((f) => ({
      type: f.type,
      severity: f.severity,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      createdAt: f.createdAt,
    })),
    operatorNote: body.note,
  });

  try {
    const sent = await sendMail({
      to: body.to.trim().toLowerCase(),
      subject: report.subject,
      text: report.text,
      html: report.html,
      replyTo: session.email,
    });

    await prisma.auditLog.create({
      data: {
        siteId: id,
        event: "report.emailed",
        detail: JSON.stringify({
          to: body.to.trim().toLowerCase(),
          by: session.email,
          messageId: sent.messageId,
          findings: actionable.length,
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      messageId: sent.messageId,
      to: body.to.trim().toLowerCase(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invio fallito";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
