import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import {
  Plus,
  Globe,
  ArrowUpRight,
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

  let sites: Awaited<ReturnType<typeof loadSites>>;
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
        <p className="mt-3 text-xs text-[var(--muted)]">
          Verifica host, porte, firewall e che Vercel possa raggiungere Postgres.
        </p>
      </div>
    );
  }

  const openCritical = sites.reduce(
    (acc, s) => acc + s.findings.filter((f) => f.severity === "critical").length,
    0,
  );
  const openTotal = sites.reduce((acc, s) => acc + s.findings.length, 0);

  return (
    <div className="dashboard">
      <header className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-kicker">
            <span className="status-dot" aria-hidden />
            Ready to scan
          </p>
          <h1 className="dashboard-title">Panoramica</h1>
          <p className="dashboard-sub">
            Monitora aggiornamenti e sicurezza dei siti collegati.
          </p>
        </div>
        <Link href="/sites/new" className="btn-on-dark">
          <Plus className="h-4 w-4" strokeWidth={2} />
          Aggiungi sito
        </Link>
      </header>

      <div className="dashboard-stats">
        <Stat label="Siti collegati" value={String(sites.length)} />
        <Stat label="Finding aperti" value={String(openTotal)} />
        <Stat
          label="Critici"
          value={String(openCritical)}
          danger={openCritical > 0}
        />
      </div>

      <section className="dashboard-sites">
        <div className="dashboard-sites-head">
          <h2>Siti</h2>
          <span className="chip chip-slate">{sites.length} totali</span>
        </div>

        {sites.length === 0 ? (
          <div className="dashboard-empty">
            <Globe
              className="h-8 w-8 text-[var(--muted)]"
              strokeWidth={1.25}
            />
            <p>Nessun sito in monitoraggio.</p>
            <Link href="/sites/new" className="btn-primary">
              Collega il primo
            </Link>
          </div>
        ) : (
          <ul className="panel-well">
            {sites.map((site) => {
              const critical = site.findings.filter(
                (f) => f.severity === "critical",
              ).length;
              const ok = site.findings.length === 0;
              return (
                <li key={site.id}>
                  <Link href={`/sites/${site.id}`} className="panel-row group">
                    <div className="dashboard-site-icon" aria-hidden>
                      <Globe
                        className="h-4 w-4 text-[var(--ink)]"
                        strokeWidth={1.75}
                      />
                    </div>
                    <div className="dashboard-site-main">
                      <p className="dashboard-site-name">{site.name}</p>
                      <p className="dashboard-site-url">{site.url}</p>
                    </div>
                    <div className="dashboard-site-meta">
                      <span
                        className={`tag ${
                          site.cms === "joomla" ? "tag-sky" : "tag-mint"
                        }`}
                      >
                        {site.cms}
                      </span>
                      <span
                        className={`chip ${ok ? "chip-emerald" : "chip-rose"}`}
                      >
                        {ok
                          ? "ok"
                          : `${site.findings.length} open${
                              critical > 0 ? ` · ${critical} crit.` : ""
                            }`}
                      </span>
                      <span className="dashboard-site-when">
                        {site.lastScanAt
                          ? formatDistanceToNow(site.lastScanAt, {
                              addSuffix: true,
                              locale: it,
                            })
                          : "mai scansionato"}
                      </span>
                      {ok ? (
                        <span className="dashboard-site-ok" aria-hidden>
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                      ) : (
                        <ArrowUpRight
                          className="h-4 w-4 shrink-0 text-[var(--muted)]"
                          strokeWidth={2}
                        />
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

async function loadSites() {
  return prisma.site.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      findings: { where: { status: "open" }, select: { severity: true } },
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
