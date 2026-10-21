import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import {
  Plus,
  Globe,
  ArrowUpRight,
  KeyRound,
  Scissors,
  RefreshCw,
  Check,
  Sparkles,
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
  const sites = await prisma.site.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      findings: { where: { status: "open" }, select: { severity: true } },
    },
  });

  const openCritical = sites.reduce(
    (acc, s) => acc + s.findings.filter((f) => f.severity === "critical").length,
    0,
  );
  const openTotal = sites.reduce((acc, s) => acc + s.findings.length, 0);

  return (
    <div className="space-y-8">
      <header className="hero-band">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="status-dot" aria-hidden />
              Ready to scan
            </div>
            <h1 className="font-display mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Panoramica
            </h1>
            <p className="mt-2 max-w-lg text-sm text-white/50">
              Monitora aggiornamenti e sicurezza. Collega un sito, testa gli accessi,
              scansiona, poi scegli AI o intervento manuale.
            </p>
          </div>
          <Link href="/sites/new" className="btn-on-dark">
            <Plus className="h-4 w-4" strokeWidth={2} />
            Aggiungi sito
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <span className="tag tag-sand">
          <KeyRound strokeWidth={1.75} />
          Accessi
        </span>
        <span className="tag tag-mint">
          <Scissors strokeWidth={1.75} />
          Inventario
        </span>
        <span className="tag tag-sky">
          <RefreshCw strokeWidth={1.75} />
          Remediation
        </span>
      </div>

      <div className="browser-card">
        <div className="browser-dots" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <p className="text-[1.05rem] leading-relaxed text-[var(--text)]">
          Un flusso unico:{" "}
          <span className="mark mark-mint">inventario CMS</span>,{" "}
          <span className="mark mark-sand">finding di sicurezza</span> e{" "}
          <span className="mark mark-sky">azioni AI o manuali</span> — senza
          perdere il contesto del sito.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="filter-chip">SFTP / API</span>
          <span className="filter-chip">Integrity</span>
          <span className="filter-chip">Human-in-the-loop</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <h2 className="font-display text-2xl font-bold tracking-tight text-[var(--ink)]">
            Monitoraggio continuo
          </h2>
          <p className="mt-2 max-w-md text-[1.05rem] leading-relaxed text-[var(--muted)]">
            Rileva versioni, aggiornamenti e segnali di compromissione. Tu
            scegli se lasciare agire l&apos;agente o intervenire a mano.
          </p>
          <ul className="feature-list mt-5">
            <li>
              <CheckBadge />
              Inventario core, componenti, plugin e template
            </li>
            <li>
              <CheckBadge />
              Finding prioritizzati con piano di remediation
            </li>
            <li>
              <CheckBadge />
              Export operativo pronto per backup e intervento
            </li>
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link href="/sites/new" className="btn-primary">
              Collega un sito
            </Link>
            <span className="hint-spark">
              <Sparkles strokeWidth={1.75} />
              Include check SSL, malware e update
            </span>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <Stat label="Siti collegati" value={String(sites.length)} />
          <Stat label="Finding aperti" value={String(openTotal)} />
          <Stat
            label="Critici"
            value={String(openCritical)}
            danger={openCritical > 0}
          />
        </div>
      </div>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl font-bold text-[var(--ink)]">Siti</h2>
          <span className="chip chip-slate">{sites.length} totali</span>
        </div>

        {sites.length === 0 ? (
          <div className="browser-card px-6 py-14 text-center">
            <div className="browser-dots mx-auto w-fit" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <Globe
              className="mx-auto mt-2 h-8 w-8 text-[var(--muted)]"
              strokeWidth={1.25}
            />
            <p className="mt-4 text-sm text-[var(--muted)]">
              Nessun sito in monitoraggio.
            </p>
            <Link href="/sites/new" className="btn-primary mt-5 inline-flex">
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
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--bg-soft)]">
                      <Globe
                        className="h-4 w-4 text-[var(--ink)]"
                        strokeWidth={1.75}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[var(--ink)]">
                        {site.name}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                        {site.url}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={`tag ${
                          site.cms === "joomla" ? "tag-sky" : "tag-mint"
                        }`}
                      >
                        {site.cms}
                      </span>
                      <span className={`chip ${ok ? "chip-emerald" : "chip-rose"}`}>
                        {ok
                          ? "ok"
                          : `${site.findings.length} open${critical > 0 ? ` · ${critical} crit.` : ""}`}
                      </span>
                      <span className="hidden text-xs text-[var(--muted)] sm:inline">
                        {site.lastScanAt
                          ? formatDistanceToNow(site.lastScanAt, {
                              addSuffix: true,
                              locale: it,
                            })
                          : "mai scansionato"}
                      </span>
                      {ok ? (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--teal)] text-[var(--teal)]">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-[var(--muted)]" />
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

function CheckBadge() {
  return (
    <svg className="check-badge" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5 14.2 4l2.5.3.3 2.5L19.5 9l-1.5 2.2.3 2.5-2.5.3L12 16.5l-2.2-1.5-2.5-.3-.3-2.5L5.5 9l1.5-2.2-.3-2.5 2.5-.3L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="m8.8 12 2.1 2.1 4.3-4.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-7 animate-pulse">
      <div className="h-36 rounded-[24px] bg-[var(--bg-elevated)]" />
      <div className="h-40 rounded-[24px] bg-[var(--bg-elevated)]" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-24 rounded-[16px] bg-[var(--bg-elevated)]" />
        <div className="h-24 rounded-[16px] bg-[var(--bg-elevated)]" />
        <div className="h-24 rounded-[16px] bg-[var(--bg-elevated)]" />
      </div>
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
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl font-bold tabular-nums tracking-tight ${
          danger ? "text-[var(--danger)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
