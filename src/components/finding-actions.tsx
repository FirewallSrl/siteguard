"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function FindingActions({ findingId }: { findingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [manualPlan, setManualPlan] = useState<{
    summary?: string;
    steps?: string[];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "ai" | "manual" | "ignore") {
    setBusy(decision);
    setMessage(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");

      if (decision === "manual") {
        setManualPlan(
          data.checklist && typeof data.checklist === "object"
            ? data.checklist
            : null,
        );
        setMessage("Checklist manuale pronta. Esegui i passi sul sito.");
      } else if (decision === "ai") {
        setMessage("Azione AI avviata.");
      } else {
        setMessage("Finding ignorato.");
      }
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Errore");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide("ai")}
          className="btn-primary"
        >
          {busy === "ai" ? "…" : "Esegui con AI"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide("manual")}
          className="btn-ghost"
        >
          {busy === "manual" ? "…" : "Faccio io"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide("ignore")}
          className="px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:opacity-50"
        >
          Ignora
        </button>
      </div>
      {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
      {manualPlan && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--bg-soft)] p-3.5 text-sm">
          <p className="font-semibold text-[var(--ink)]">Checklist</p>
          {Array.isArray(manualPlan.steps) && (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[var(--muted)]">
              {manualPlan.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
