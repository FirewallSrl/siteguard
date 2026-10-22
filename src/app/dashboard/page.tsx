import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import {
  Plus,
  Globe,
  ArrowUpRight,
  AlertTriangle,
  Check,
} from "lucide-react";
import { prisma } from "@/lib/db";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

type SiteRow = Awaited<ReturnType<typeof loadSites>>[number];

type SiteHealth = {
  site: SiteRow;
  critical: number;
  high: number;
  open: number;
  updates: number;
  vulns: number;
  brokenLinks: number;
  phpVersion: string | null;
  phpVulnerable: boolean;
  sslDays: number | null;
  sslOk: boolean;
  status: "critical" | "warn" | "ok" | "idle";
  statusLabel: string;
  topTitles: string[];
};

function parseInventory(raw: string | null) {
  if (!raw) {
    return {
      phpVersion: null as string | null,
      phpVulnerable: false,
      sslDays: null as number | null,
      sslOk: true,
      brokenLinks: null as number | null,
    };
  }
  try {
    const inv = JSON.parse(raw) as {
      phpVersion?: string;
      phpAdvisories?: unknown[];
      ssl?: { https?: boolean; daysLeft?: number };
      brokenLinks?: { brokenCount?: number };
    };
    const sslDays = inv.ssl?.daysLeft ?? null;
    return {
      phpVersion: inv.phpVersion ?? null,
      phpVulnerable: (inv.phpAdvisories?.length ?? 0) > 0,
      sslDays,
      sslOk: Boolean(inv.ssl?.https) && (sslDays == null || sslDays > 14),
      brokenLinks: inv.brokenLinks?.brokenCount ?? null,
    };
  } catch {
    return {
      phpVersion: null,
      phpVulnerable: false,
      sslDays: null,
      sslOk: true,
      brokenLinks: null,
    };
  }
}

function buildHealth(site: SiteRow): SiteHealth {
  const critical = site.findings.filter((f) => f.severity === "critical").length;
  const high = site.findings.filter((f) => f.severity === "high").length;
  const open = site.findings.length;
  const updates = site.findings.filter((f) =>
    f.type.startsWith("update_"),
  ).length;
  const vulns = site.findings.filter((f) => f.type === "vulnerability").length;
  const brokenFromFindings = site.findings.filter(
    (f) => f.type === "broken_link",
  ).length;
  const inv = parseInventory(site.inventoryJson);
  const brokenLinks = inv.brokenLinks ?? brokenFromFindings;

  let status: SiteHealth["status"] = "ok";
  let statusLabel = "Ok";
  if (!site.lastScanAt) {
    status = "idle";
    statusLabel = "Non scansionato";
  } else if (critical > 0 || inv.phpVulnerable || !inv.sslOk) {
    status = "critical";
    statusLabel = "Critico";
  } else if (high > 0 || updates > 0 || brokenLinks > 0) {
    status = "warn";
    statusLabel = "Attenzione";
  }

  const topTitles = [...site.findings]
    .sort((a, b) => {
      const order = ["critical", "high", "medium", "low", "info"];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    })
    .slice(0, 2)
    .map((f) => f.title);

  return {
    site,
    critical,
    high,
    open,
    updates,
    vulns,
    brokenLinks,
    phpVersion: inv.phpVersion,
    phpVulnerable: inv.phpVulnerable,
    sslDays: inv.sslDays,
    sslOk: inv.sslOk,
    status,
    statusLabel,
    topTitles,
  };
}

async function DashboardContent() {
  await connection();

  if (!process.env.DATABASE_URL) {
    return (
      <div className="panel mx-auto max-w-lg px-6 py-10 text-center">
        <p className="font-display text-xl font-bold text-[var(--ink)]">
          Configura il database
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Su Vercel manca <code className="font-mono">DATABASE_URL</code>.
          Aggiungila in Project Settings → Environment Variables e rideploya.
        </p>
      </div>
    );
  }

  let sites: SiteRow[];
  try {
    sites = await loadSites();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore database";
    return (
      <div className="panel mx-auto max-w-lg px-6 py-10 text-center">
        <p className="font-display text-xl font-bold text-[var(--ink)]">
          Database non raggiungibile
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">{message}</p>
      </div>
    );
  }

  const health = sites.map(buildHealth).sort((a, b) => {
    const rank = { critical: 0, warn: 1, idle: 2, ok: 3 };
    return rank[a.status] - rank[b.status] || b.open - a.open;
  });

  const openCritical = health.reduce((a, h) => a + h.critical, 0);
  const openTotal = health.reduce((a, h) => a + h.open, 0);
  const sitesAtRisk = health.filter(
    (h) => h.status === "critical" || h.status === "warn",
  ).length;

  const alertItems = health
    .flatMap((h) =>
      h.site.findings
        .filter((f) => f.severity === "critical" || f.severity === "high")
        .map((f) => ({
          siteId: h.site.id,
          siteName: h.site.name,
          severity: f.severity,
          type: f.type,
          title: f.title,
        })),
    )
    .sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === "critical" ? -1 : 1;
    })
    .slice(0, 8);

  return (
    <div className="dashboard">
      <header className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-kicker">
            <span className="status-dot" aria-hidden />
            {openCritical > 0
              ? `${openCritical} criticità da gestire`
              : sitesAtRisk > 0
                ? `${sitesAtRisk} siti da controllare`
                : "Nessuna criticità aperta"}
          </p>
          <h1 className="dashboard-title">Panoramica</h1>
          <p className="dashboard-sub">
            Stato operativo di tutti i siti — senza entrare sito per sito.
          </p>
        </div>
        <Link href="/sites/new" className="btn-on-dark">
          <Plus className="h-4 w-4" strokeWidth={2} />
          Aggiungi sito
        </Link>
      </header>

      <div className="dashboard-stats">
        <Stat label="Siti" value={String(sites.length)} />
        <Stat label="Finding aperti" value={String(openTotal)} />
        <Stat
          label="Critici"
          value={String(openCritical)}
          danger={openCritical > 0}
        />
        <Stat
          label="Siti a rischio"
          value={String(sitesAtRisk)}
          danger={sitesAtRisk > 0}
        />
      </div>

      {alertItems.length > 0 ? (
        <section className="dash-alerts">
          <div className="dash-alerts-head">
            <div className="dash-alerts-title">
              <AlertTriangle className="h-4 w-4" strokeWidth={2.25} />
              <div>
                <p className="dash-alerts-kicker">Priorità</p>
                <p className="dash-alerts-count">
                  {alertItems.length === 1
                    ? "1 criticità in evidenza"
                    : `${alertItems.length} criticità in evidenza`}
                </p>
              </div>
            </div>
          </div>
          <ul className="dash-alerts-list">
            {alertItems.map((item) => (
              <li key={`${item.siteId}-${item.title}`}>
                <Link
                  href={`/sites/${item.siteId}?tab=finding`}
                  className="dash-alert-row"
                  data-severity={item.severity}
                >
                  <span
                    className={`chip ${
                      item.severity === "critical" ? "chip-rose" : "chip-slate"
                    }`}
                  >
                    {item.severity === "critical" ? "Critico" : "Alto"}
                  </span>
                  <span className="dash-alert-site">{item.siteName}</span>
                  <span className="dash-alert-title">{item.title}</span>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-[var(--muted)]"
                    strokeWidth={2}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="dash-alerts dash-alerts-ok">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          <p>Nessuna criticità high/critical aperta</p>
        </section>
      )}

      <section className="dashboard-sites">
        <div className="dashboard-sites-head">
          <h2>Siti</h2>
          <span className="chip chip-slate">{sites.length} totali</span>
        </div>

        {health.length === 0 ? (
          <div className="dashboard-empty">
            <Globe className="h-8 w-8 text-[var(--muted)]" strokeWidth={1.25} />
            <p>Nessun sito in monitoraggio.</p>
            <Link href="/sites/new" className="btn-primary">
              Collega il primo
            </Link>
          </div>
        ) : (
          <div className="site-matrix">
            <div className="site-matrix-head" aria-hidden>
              <span>Sito</span>
              <span>Stato</span>
              <span>Crit.</span>
              <span>Update</span>
              <span>PHP</span>
              <span>SSL</span>
              <span>Link</span>
              <span>Scan</span>
              <span />
            </div>
            {health.map((h) => (
              <Link
                key={h.site.id}
                href={`/sites/${h.site.id}?tab=panoramica`}
                className="site-matrix-row"
                data-status={h.status}
              >
                <div className="site-matrix-site">
                  <span className="site-matrix-name">{h.site.name}</span>
                  <span className="site-matrix-meta">
                    <span
                      className={`tag ${
                        h.site.cms === "joomla" ? "tag-sky" : "tag-mint"
                      }`}
                    >
                      {h.site.cms}
                    </span>
                    {h.topTitles[0] ? (
                      <span className="site-matrix-issue">{h.topTitles[0]}</span>
                    ) : (
                      <span className="site-matrix-url">{h.site.url}</span>
                    )}
                  </span>
                </div>
                <span className="site-matrix-status" data-status={h.status}>
                  {h.statusLabel}
                </span>
                <span
                  className={`site-matrix-num${h.critical > 0 ? " is-bad" : ""}`}
                >
                  {h.critical}
                </span>
                <span
                  className={`site-matrix-num${h.updates > 0 ? " is-warn" : ""}`}
                >
                  {h.updates}
                </span>
                <span
                  className={`site-matrix-cell${
                    h.phpVulnerable ? " is-bad" : ""
                  }`}
                >
                  {h.phpVersion ?? "—"}
                </span>
                <span
                  className={`site-matrix-cell${h.sslOk ? "" : " is-bad"}`}
                >
                  {h.sslDays != null ? `${h.sslDays}g` : "—"}
                </span>
                <span
                  className={`site-matrix-num${
                    h.brokenLinks > 0 ? " is-warn" : ""
                  }`}
                >
                  {h.brokenLinks}
                </span>
                <span className="site-matrix-when">
                  {h.site.lastScanAt
                    ? formatDistanceToNow(h.site.lastScanAt, {
                        addSuffix: true,
                        locale: it,
                      })
                    : "mai"}
                </span>
                <span className="site-matrix-go" aria-hidden>
                  {h.status === "ok" ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : (
                    <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

async function loadSites() {
  return prisma.site.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      url: true,
      cms: true,
      status: true,
      lastScanAt: true,
      inventoryJson: true,
      findings: {
        where: { status: "open" },
        select: {
          id: true,
          severity: true,
          type: true,
          title: true,
        },
      },
    },
  });
}

function DashboardSkeleton() {
  return (
    <div className="dashboard animate-pulse">
      <div className="h-28 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)]" />
      <div className="dashboard-stats">
        <div className="h-20 rounded-[14px] bg-[var(--bg-elevated)]" />
        <div className="h-20 rounded-[14px] bg-[var(--bg-elevated)]" />
        <div className="h-20 rounded-[14px] bg-[var(--bg-elevated)]" />
        <div className="h-20 rounded-[14px] bg-[var(--bg-elevated)]" />
      </div>
      <div className="h-40 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)]" />
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <p className={`stat-tile-value${danger ? " is-danger" : ""}`}>{value}</p>
    </div>
  );
}
