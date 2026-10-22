import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { SeverityBadge } from "@/components/severity-badge";
import { ScanButton } from "@/components/scan-button";
import { FindingActions } from "@/components/finding-actions";
import { SiteWorkspace } from "@/components/site-workspace";

type Props = { params: Promise<{ id: string }> };

export default function SiteDetailPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="animate-pulse text-sm text-[var(--muted)]">
          Caricamento…
        </div>
      }
    >
      <SiteDetailContent params={params} />
    </Suspense>
  );
}

async function SiteDetailContent({ params }: Props) {
  await connection();
  const { id } = await params;
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

  const actionable = findings.filter(
    (f) =>
      !(
        f.severity === "info" &&
        f.type === "config" &&
        /nessun problema/i.test(f.title)
      ),
  );

  const findingsSlot = (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold text-[var(--ink)]">
            Finding aperti
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Scegli AI, intervento manuale o ignora.
          </p>
        </div>
        <span className="chip chip-slate">{actionable.length} da gestire</span>
      </div>

      {actionable.length === 0 ? (
        <div className="finding-card py-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            Nessun finding prioritario. Controlla l’inventario o ripeti lo scan.
          </p>
        </div>
      ) : (
        <div className="panel-well">
          {actionable.map((f) => {
            const plan = f.proposedPlan
              ? (JSON.parse(f.proposedPlan) as {
                  summary?: string;
                  steps?: string[];
                } | null)
              : null;
            const evidence = f.evidence
              ? (JSON.parse(f.evidence) as {
                  items?: Array<{
                    url?: string;
                    status?: number | null;
                    from?: string;
                  }>;
                })
              : null;
            const brokenItems =
              f.type === "broken_link" ? (evidence?.items ?? []) : [];
            return (
              <article key={f.id} className="finding-card !shadow-none">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <span className="chip chip-slate">{f.type}</span>
                </div>
                <h3 className="mt-2.5 text-[1.05rem] font-semibold text-[var(--ink)]">
                  {f.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
                  {f.description}
                </p>
                {brokenItems.length > 0 && (
                  <ul className="mt-3 space-y-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-soft)] p-3 font-mono text-xs">
                    {brokenItems.map((item) => (
                      <li key={item.url} className="text-[var(--ink)]">
                        <span className="chip chip-rose mr-2">
                          {item.status ?? "err"}
                        </span>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all hover:underline"
                        >
                          {item.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {plan?.summary && (
                  <p className="mt-3 text-sm text-[var(--text)]">
                    <span className="mark mark-sand">Piano</span> {plan.summary}
                  </p>
                )}
                <FindingActions findingId={f.id} />
              </article>
            );
          })}
        </div>
      )}
    </section>
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

  let defaultTab: "accessi" | "panoramica" | "finding" | "attivita" =
    "panoramica";
  if (!hasSecrets) defaultTab = "accessi";
  else if (actionable.length > 0) defaultTab = "finding";
  else if (site.inventoryJson) defaultTab = "panoramica";
  else defaultTab = "panoramica";

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
