"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ShieldAlert,
  Cpu,
  RefreshCw,
  Lock,
  Link2,
  Inbox,
  CheckCircle2,
} from "lucide-react";
import { SeverityBadge } from "@/components/severity-badge";
import { FindingActions } from "@/components/finding-actions";
import {
  REMEDIATION_GROUPS,
  groupIdForFinding,
  severityRank,
  type RemediationGroupId,
} from "@/lib/remediation-groups";

export type RemediationFinding = {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  evidence: string | null;
  proposedPlan: string | null;
};

const ICONS: Record<RemediationGroupId, typeof ShieldAlert> = {
  compromise: ShieldAlert,
  runtime: Cpu,
  updates: RefreshCw,
  hardening: Lock,
  content: Link2,
  other: Inbox,
};

type BrokenItem = {
  url?: string;
  status?: number | null;
  from?: string;
};

function parsePlan(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { summary?: string; steps?: string[] } | null;
  } catch {
    return null;
  }
}

function parseBrokenItems(f: RemediationFinding): BrokenItem[] {
  if (f.type !== "broken_link" || !f.evidence) return [];
  try {
    const evidence = JSON.parse(f.evidence) as { items?: BrokenItem[] };
    return evidence.items ?? [];
  } catch {
    return [];
  }
}

export function RemediationBoard({
  findings,
}: {
  findings: RemediationFinding[];
}) {
  const grouped = useMemo(() => {
    const map = new Map<RemediationGroupId, RemediationFinding[]>();
    for (const g of REMEDIATION_GROUPS) map.set(g.id, []);

    for (const f of findings) {
      const id = groupIdForFinding(f);
      const list = map.get(id) ?? map.get("other")!;
      list.push(f);
    }

    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) ||
          a.title.localeCompare(b.title),
      );
    }

    return REMEDIATION_GROUPS.map((def) => ({
      def,
      items: map.get(def.id) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [findings]);

  const total = findings.length;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const firstOpen = grouped[0]?.def.id ?? null;
  const [openId, setOpenId] = useState<RemediationGroupId | null>(firstOpen);

  if (total === 0) {
    return (
      <section className="rounded-[var(--radius-sm)] bg-[var(--bg-panel)] px-6 py-12 text-center">
        <CheckCircle2
          className="mx-auto h-6 w-6 text-[var(--mint-ink)]"
          strokeWidth={1.75}
        />
        <p className="mt-2 font-semibold text-[var(--ink)]">
          Nessun finding in coda.
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Controlla l&apos;inventario o ripeti lo scan.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight text-[var(--ink)]">
            Coda remediation
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
            Flusso gestionale: risolvi nell&apos;ordine delle fasi. Dentro ogni
            fase, priorità per severity.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-slate">{total} da gestire</span>
          {critical > 0 && (
            <span className="chip chip-rose">{critical} critici</span>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-panel)] p-1.5">
        {grouped.map(({ def, items }, index) => {
          const worst = items[0]?.severity ?? "info";
          const active = openId === def.id;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() =>
                setOpenId((cur) => (cur === def.id ? null : def.id))
              }
              className={`inline-flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-[var(--shadow-sm)] transition-shadow ${
                active ? "ring-1 ring-[var(--ink)]" : "hover:ring-1 hover:ring-[var(--border-strong)]"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[0.65rem] font-bold ${
                  worst === "critical"
                    ? "bg-[#fee2e2] text-[#991b1b]"
                    : worst === "high"
                      ? "bg-[var(--sand)] text-[var(--sand-ink)]"
                      : "bg-[var(--bg-soft)] text-[var(--muted)]"
                }`}
              >
                {index + 1}
              </span>
              <span>{def.short}</span>
              <span className="tabular-nums text-[var(--muted)]">
                {items.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5">
        {grouped.map(({ def, items }, index) => {
          const Icon = ICONS[def.id];
          const open = openId === def.id;
          const criticalInGroup = items.filter(
            (f) => f.severity === "critical",
          ).length;
          const highInGroup = items.filter((f) => f.severity === "high").length;

          return (
            <div
              key={def.id}
              className={`rounded-[var(--radius-sm)] bg-[var(--bg-panel)] p-1.5 ${
                open && def.id === "compromise"
                  ? "shadow-[inset_3px_0_0_var(--danger)]"
                  : ""
              }`}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setOpenId((cur) => (cur === def.id ? null : def.id))
                }
                className="flex w-full flex-wrap items-start gap-3 rounded-[14px] bg-[var(--bg-elevated)] px-3.5 py-3 text-left shadow-[var(--shadow-sm)]"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 hidden shrink-0 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[var(--muted)] sm:inline">
                    Fase {index + 1}
                  </span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-soft)] text-[var(--ink)]">
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.98rem] font-bold tracking-tight text-[var(--ink)]">
                      <span className="mr-2 text-[var(--muted)] sm:hidden">
                        {index + 1}.
                      </span>
                      {def.label}
                    </p>
                    <p className="mt-0.5 text-[0.82rem] leading-snug text-[var(--muted)]">
                      {def.description}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sand-ink)]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                      {def.actionHint}
                    </p>
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {criticalInGroup > 0 && (
                    <span className="chip chip-rose">
                      {criticalInGroup} crit.
                    </span>
                  )}
                  {highInGroup > 0 && (
                    <span className="chip chip-slate">{highInGroup} high</span>
                  )}
                  <span className="chip chip-slate">{items.length}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-[var(--muted)] transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                    strokeWidth={2}
                  />
                </div>
              </button>

              {open && (
                <div className="mt-2 flex flex-col gap-2.5 px-1 pb-1">
                  {items.map((f) => {
                    const plan = parsePlan(f.proposedPlan);
                    const brokenItems = parseBrokenItems(f);
                    return (
                      <article key={f.id} className="finding-card !shadow-none">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={f.severity} />
                          <span className="chip chip-slate">{f.type}</span>
                        </div>
                        <h3 className="mt-2.5 text-[1.05rem] font-semibold text-[var(--ink)]">
                          {f.title}
                        </h3>
                        <p className="mt-1 break-words text-sm leading-relaxed text-[var(--muted)]">
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
                            <span className="mark mark-sand">Piano</span>{" "}
                            {plan.summary}
                          </p>
                        )}
                        <FindingActions findingId={f.id} />
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
