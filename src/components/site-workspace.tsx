"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  KeyRound,
  LayoutGrid,
  ListChecks,
  Radar,
  Settings2,
} from "lucide-react";
import { CredentialsPanel } from "@/components/credentials-panel";
import { SiteInventoryView } from "@/components/site-inventory";

type Scan = {
  id: string;
  status: string;
  summary: string | null;
  error: string | null;
};

type Action = {
  id: string;
  title: string;
  mode: string;
  status: string;
};

type TabId = "accessi" | "panoramica" | "finding" | "attivita";

const PRIMARY_STEPS: Array<{
  id: Exclude<TabId, "accessi">;
  label: string;
  hint: string;
  icon: typeof KeyRound;
}> = [
  {
    id: "panoramica",
    label: "Inventario",
    hint: "CMS e estensioni",
    icon: LayoutGrid,
  },
  {
    id: "finding",
    label: "Remediation",
    hint: "Finding e azioni",
    icon: Radar,
  },
  {
    id: "attivita",
    label: "Attività",
    hint: "Storico",
    icon: ListChecks,
  },
];

export function SiteWorkspace({
  siteId,
  findingsSlot,
  scans,
  actions,
  findingsCount,
  inventoryJson,
  hasSecrets,
  hasScanned,
  defaultTab = "accessi",
}: {
  siteId: string;
  findingsSlot: ReactNode;
  scans: Scan[];
  actions: Action[];
  findingsCount: number;
  inventoryJson: string | null;
  hasSecrets: boolean;
  hasScanned: boolean;
  defaultTab?: TabId;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(
    !hasSecrets ? "accessi" : defaultTab === "accessi" ? "panoramica" : defaultTab,
  );

  useEffect(() => {
    if (!hasSecrets) {
      setTab("accessi");
      return;
    }
    setTab(defaultTab === "accessi" ? "panoramica" : defaultTab);
  }, [defaultTab, hasSecrets, siteId]);

  function openTab(next: TabId) {
    setTab(next);
    if (next === "accessi") {
      router.replace(`/sites/${siteId}?tab=accessi`, { scroll: false });
      return;
    }
    router.replace(`/sites/${siteId}?tab=${next}`, { scroll: false });
  }

  const done = useMemo(
    () => ({
      panoramica: Boolean(inventoryJson),
      finding: hasScanned,
      attivita: scans.length > 0 || actions.length > 0,
    }),
    [inventoryJson, hasScanned, scans.length, actions.length],
  );

  const next = useMemo(() => {
    if (!hasSecrets) return null;
    // Inventario e remediation hanno già il loro focus — niente banner ridondante
    if (tab === "panoramica" || tab === "finding" || tab === "accessi") {
      return null;
    }
    if (!hasScanned) {
      return {
        title: "Avvia la prima scansione",
        body: "Usa «Scansiona ora» in alto per inventario e finding.",
        cta: null as string | null,
        tab: null as TabId | null,
      };
    }
    return null;
  }, [hasSecrets, hasScanned, tab]);

  // Prima configurazione: Accessi è l'unico focus
  if (!hasSecrets) {
    return (
      <div className="space-y-5">
        <div className="next-banner">
          <div>
            <p className="font-semibold text-[var(--ink)]">
              Configura gli accessi
            </p>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              Salva e testa SFTP o API. Poi potrai scansionare e gestire il sito.
            </p>
          </div>
          <span className="tag tag-sand">
            <KeyRound strokeWidth={1.75} />
            Setup
          </span>
        </div>
        <CredentialsPanel siteId={siteId} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flow-rail flex-1" aria-label="Flusso operativo">
          {PRIMARY_STEPS.map((step, i) => {
            const Icon = step.icon;
            const isActive = tab === step.id;
            const isDone = done[step.id];
            const badge =
              step.id === "finding" && findingsCount > 0
                ? String(findingsCount)
                : null;
            return (
              <div key={step.id} className="contents">
                {i > 0 && (
                  <div
                    className="flow-rail-line"
                    data-done={
                      done[PRIMARY_STEPS[i - 1]!.id] || undefined
                    }
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  className="flow-rail-step"
                  data-active={isActive || undefined}
                  data-done={!isActive && isDone ? true : undefined}
                  onClick={() => openTab(step.id)}
                >
                  <span className="flow-rail-icon">
                    {isDone && !isActive ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    ) : (
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block text-[0.8rem] font-semibold leading-tight">
                      {step.label}
                      {badge ? (
                        <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--sand)] px-1 text-[0.65rem] text-[var(--sand-ink)]">
                          {badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.7rem] opacity-70">
                      {step.hint}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </nav>

        <button
          type="button"
          className="access-secondary"
          data-active={tab === "accessi" || undefined}
          onClick={() => openTab("accessi")}
          title="Credenziali SFTP / API"
        >
          <Settings2 className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Accessi</span>
          <span className="access-secondary-ok" aria-hidden>
            <Check className="h-3 w-3" strokeWidth={2.5} />
          </span>
        </button>
      </div>

      {next && (
        <div className="next-banner">
          <div>
            <p className="font-semibold text-[var(--ink)]">{next.title}</p>
            <p className="mt-0.5 text-sm text-[var(--muted)]">{next.body}</p>
          </div>
          {next.cta && next.tab && (
            <button
              type="button"
              className="btn-primary shrink-0"
              onClick={() => openTab(next.tab!)}
            >
              {next.cta}
            </button>
          )}
        </div>
      )}

      <div className="workspace-body">
        {tab === "accessi" && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Credenziali già configurate. Modificale solo se cambiano host,
              password o token.
            </p>
            <CredentialsPanel siteId={siteId} />
          </div>
        )}
        {tab === "panoramica" && (
          <SiteInventoryView
            inventoryJson={inventoryJson}
            findingsCount={findingsCount}
            onOpenRemediation={() => openTab("finding")}
          />
        )}
        {tab === "finding" && findingsSlot}
        {tab === "attivita" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel-well">
              <h2 className="px-1 pb-1 text-sm font-semibold text-[var(--ink)]">
                Scan recenti
              </h2>
              {scans.length === 0 ? (
                <div className="panel-row text-sm text-[var(--muted)]">
                  Nessuno scan ancora
                </div>
              ) : (
                scans.map((s) => (
                  <div key={s.id} className="panel-row text-sm">
                    <span className="chip chip-slate">{s.status}</span>
                    <span className="min-w-0 flex-1 text-[var(--muted)]">
                      {s.summary ?? s.error ?? "—"}
                    </span>
                  </div>
                ))
              )}
            </section>
            <section className="panel-well">
              <h2 className="px-1 pb-1 text-sm font-semibold text-[var(--ink)]">
                Azioni
              </h2>
              {actions.length === 0 ? (
                <div className="panel-row text-sm text-[var(--muted)]">
                  Nessuna azione
                </div>
              ) : (
                actions.map((a) => (
                  <div key={a.id} className="panel-row text-sm">
                    <span className="min-w-0 flex-1 text-[var(--ink)]">
                      {a.title}
                    </span>
                    <span className="chip chip-slate">
                      {a.mode}/{a.status}
                    </span>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
