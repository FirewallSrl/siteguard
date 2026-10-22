import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { ScanButton } from "@/components/scan-button";
import { RemediationBoard } from "@/components/remediation-board";
import { SiteWorkspace } from "@/components/site-workspace";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
};

const TABS = ["accessi", "panoramica", "finding", "attivita"] as const;
type TabId = (typeof TABS)[number];

function parseTab(value: string | undefined): TabId | null {
  if (value && (TABS as readonly string[]).includes(value)) {
    return value as TabId;
  }
  return null;
}

export default function SiteDetailPage({ params, searchParams }: Props) {
  return (
    <Suspense
      fallback={
        <div className="animate-pulse text-sm text-[var(--muted)]">
          Caricamento…
        </div>
      }
    >
      <SiteDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SiteDetailContent({ params, searchParams }: Props) {
  await connection();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      findings: {
        where: { status: "open" },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      },
      scans: { orderBy: { createdAt: "desc" }, take: 8 },
      actions: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  if (!site) notFound();

  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const findings = [...site.findings].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );

  const actionable = findings.filter((f) => {
    if (f.severity !== "info") return true;
    if (f.type === "config" && /nessun problema/i.test(f.title)) return false;
    if (f.type === "malware" && /nessun segnale/i.test(f.title)) return false;
    if (f.type === "broken_link" && /nessun url rotto/i.test(f.title))
      return false;
    return true;
  });

  const findingsSlot = (
    <RemediationBoard
      findings={actionable.map((f) => ({
        id: f.id,
        type: f.type,
        severity: f.severity,
        title: f.title,
        description: f.description,
        evidence: f.evidence,
        proposedPlan: f.proposedPlan,
      }))}
    />
  );

  let coreLabel: string | null = null;
  let phpLabel: string | null = null;
  let phpVulnerable = false;
  if (site.inventoryJson) {
    try {
      const inv = JSON.parse(site.inventoryJson) as {
        cms?: string;
        coreVersion?: string;
        phpVersion?: string;
        phpAdvisories?: unknown[];
      };
      if (inv.coreVersion) {
        coreLabel = `${inv.cms ?? site.cms} ${inv.coreVersion}`;
      }
      if (inv.phpVersion) {
        phpLabel = `PHP ${inv.phpVersion}`;
        phpVulnerable = (inv.phpAdvisories?.length ?? 0) > 0;
      }
    } catch {
      /* ignore */
    }
  }

  const hasSecrets = Boolean(site.secretsEnc);
  const hasScanned = Boolean(site.lastScanAt) || site.scans.length > 0;

  const requestedTab = parseTab(tabParam);
  let defaultTab: TabId = requestedTab ?? "panoramica";
  if (!hasSecrets) defaultTab = "accessi";
  else if (!requestedTab && actionable.length > 0) defaultTab = "finding";
  else if (!requestedTab) defaultTab = "panoramica";

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Dashboard
      </Link>

      <header className="hero-band">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-dot" aria-hidden />
              <span className="chip">{coreLabel ?? site.cms}</span>
              {phpLabel && (
                <span
                  className={`chip ${phpVulnerable ? "chip-rose" : "chip-emerald"}`}
                >
                  {phpLabel}
                  {phpVulnerable ? " · vuln" : ""}
                </span>
              )}
              <span
                className={`chip ${
                  site.status === "connected"
                    ? "chip-emerald"
                    : site.status === "error"
                      ? "chip-rose"
                      : "chip-slate"
                }`}
              >
                {site.status}
              </span>
            </div>
            <h1 className="font-display mt-3 text-3xl font-bold tracking-tight text-white">
              {site.name}
            </h1>
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-mono text-sm text-white/55 hover:text-white"
            >
              {site.url}
            </a>
            <p className="mt-2 text-sm text-white/45">
              {site.lastScanAt
                ? `Ultimo scan ${formatDistanceToNow(site.lastScanAt, {
                    addSuffix: true,
                    locale: it,
                  })}`
                : "Mai scansionato — configura accessi, poi scansiona"}
            </p>
          </div>
          <ScanButton siteId={site.id} />
        </div>
      </header>

      <SiteWorkspace
        siteId={site.id}
        findingsCount={actionable.length}
        findingsSlot={findingsSlot}
        scans={site.scans}
        actions={site.actions}
        inventoryJson={site.inventoryJson}
        hasSecrets={hasSecrets}
        hasScanned={hasScanned}
        defaultTab={defaultTab}
      />
    </div>
  );
}
