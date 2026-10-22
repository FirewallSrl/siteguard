"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, RefreshCw, X } from "lucide-react";

type Step = {
  id: string;
  label: string;
  detail?: string;
  status: "pending" | "active" | "done" | "error" | "skipped";
};

type ProgressPayload = {
  percent: number;
  current: string;
  steps: Step[];
  finished?: boolean;
  error?: string;
};

export function ScanButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const poll = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/sites/${siteId}/scan/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stato non disponibile");

      if (data.progress) {
        setProgress(data.progress);
      }

      if (data.status === "completed") {
        setLoading(false);
        setProgress((p) =>
          p
            ? {
                ...p,
                percent: 100,
                finished: true,
                current: data.summary ?? p.current,
              }
            : p,
        );
        router.refresh();
        return true;
      }
      if (data.status === "failed") {
        setLoading(false);
        setError(data.error ?? "Scan fallito");
        setProgress((p) =>
          p ? { ...p, finished: true, error: data.error ?? "Scan fallito" } : p,
        );
        return true;
      }
      return false;
    },
    [siteId, router],
  );

  useEffect(() => {
    if (!scanId || !loading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const done = await poll(scanId!);
        if (!cancelled && !done) {
          timer = setTimeout(tick, 700);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore polling");
          setLoading(false);
        }
      }
    }

    timer = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanId, loading, poll]);

  async function scan() {
    setLoading(true);
    setError(null);
    setProgress(null);
    setOpen(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/scan`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan fallito");
      setScanId(data.scanId);
      setProgress({
        percent: 2,
        current: "Scansione avviata…",
        steps: [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
      setLoading(false);
    }
  }

  const panel =
    open && mounted
      ? createPortal(
          <div className="scan-toast" role="status" aria-live="polite">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  {progress?.finished
                    ? progress.error
                      ? "Scansione fallita"
                      : "Scansione completata"
                    : "Scansione in corso"}
                </p>
                <p className="mt-0.5 truncate text-sm text-[var(--muted)]">
                  {progress?.current ?? "Preparazione…"}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full p-1 text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
                onClick={() => setOpen(false)}
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <div className="scan-meter" aria-hidden>
              <div
                className="scan-meter-fill"
                style={{ width: `${progress?.percent ?? 4}%` }}
              />
            </div>
            <p className="mt-1 text-right font-mono text-[0.7rem] text-[var(--muted)]">
              {progress?.percent ?? 0}%
            </p>

            {progress?.steps && progress.steps.length > 0 && (
              <ul className="scan-toast-steps mt-2.5">
                {progress.steps.map((step) => (
                  <li
                    key={step.id}
                    className="scan-step"
                    data-status={step.status}
                  >
                    <span className="scan-step-icon">
                      {step.status === "done" || step.status === "skipped" ? (
                        <Check className="h-3 w-3" strokeWidth={2.5} />
                      ) : step.status === "active" ? (
                        <Loader2
                          className="h-3 w-3 animate-spin"
                          strokeWidth={2.5}
                        />
                      ) : step.status === "error" ? (
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      ) : (
                        <span className="scan-step-dot" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.78rem] font-medium leading-tight">
                        {step.label}
                      </span>
                      {step.detail && (
                        <span className="block truncate text-[0.65rem] opacity-65">
                          {step.detail}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(error || progress?.error) && (
              <p className="mt-2 text-sm text-[var(--danger)]">
                {error ?? progress?.error}
              </p>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={scan}
        disabled={loading}
        className="btn-on-dark"
      >
        <RefreshCw
          className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          strokeWidth={2}
        />
        {loading ? "Scansione…" : "Scansiona ora"}
      </button>
      {error && !open && (
        <p className="mt-2 text-sm text-white/80">{error}</p>
      )}
      {panel}
    </>
  );
}
