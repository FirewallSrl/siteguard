"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Code2,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import {
  SCAN_SCOPE_DEFS,
  SCAN_SCOPES,
  type ScanScope,
} from "@/lib/scanner/scopes";

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
  scope?: string;
  finished?: boolean;
  error?: string;
};

const SCOPE_ICONS: Record<ScanScope, typeof RefreshCw> = {
  full: Sparkles,
  ssl: Shield,
  links: Link2,
  php: Code2,
  inventory: Package,
  updates: RefreshCw,
  integrity: ShieldAlert,
};

export function ScanButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const splitRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeScope, setActiveScope] = useState<ScanScope>("full");

  useEffect(() => setMounted(true), []);

  const placeMenu = useCallback(() => {
    const el = splitRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({
      top: r.bottom + 8,
      right: Math.max(12, window.innerWidth - r.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [menuOpen, placeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (splitRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const poll = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/sites/${siteId}/scan/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stato non disponibile");

      if (data.progress) setProgress(data.progress);

      if (data.status === "completed") {
        setLoading(false);
        setProgress((p) => {
          const base = data.progress ?? p;
          if (!base) return p;
          return {
            ...base,
            percent: 100,
            finished: true,
            current: data.summary ?? base.current,
            steps: (base.steps ?? []).map((s: Step) =>
              s.status === "pending" || s.status === "active"
                ? { ...s, status: "done" as const }
                : s,
            ),
          };
        });
        router.refresh();
        return true;
      }
      if (data.status === "failed") {
        setLoading(false);
        setError(data.error ?? "Scan fallito");
        setProgress((p) => {
          const base = data.progress ?? p;
          if (!base) return p;
          return {
            ...base,
            finished: true,
            error: data.error ?? "Scan fallito",
            steps: (base.steps ?? []).map((s: Step) =>
              s.status === "active"
                ? { ...s, status: "error" as const }
                : s,
            ),
          };
        });
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
        if (!cancelled && !done) timer = setTimeout(tick, 700);
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

  async function scan(scope: ScanScope) {
    setMenuOpen(false);
    setActiveScope(scope);
    setLoading(true);
    setError(null);
    setProgress(null);
    setOpen(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan fallito");
      setScanId(data.scanId);
      setProgress({
        percent: 2,
        current: `${SCAN_SCOPE_DEFS[scope].label} avviata…`,
        steps: [],
        scope,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
      setLoading(false);
    }
  }

  const scopeLabel = SCAN_SCOPE_DEFS[activeScope]?.short ?? "Completa";

  const menu =
    menuOpen && mounted && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="scan-menu"
            role="menu"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <p className="scan-menu-label">Tipo di scansione</p>
            {SCAN_SCOPES.map((id, i) => {
              const def = SCAN_SCOPE_DEFS[id];
              const Icon = SCOPE_ICONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="scan-menu-item"
                  style={{ animationDelay: `${40 + i * 35}ms` }}
                  data-active={id === "full" || undefined}
                  disabled={loading}
                  onClick={() => scan(id)}
                >
                  <span className="scan-menu-icon">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.85} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[0.82rem] font-semibold leading-tight">
                      {def.label}
                    </span>
                    <span className="scan-menu-desc mt-0.5 block text-[0.68rem] leading-snug text-[var(--muted)]">
                      {def.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

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
                  <span className="chip chip-slate mr-1.5 align-middle">
                    {SCAN_SCOPE_DEFS[activeScope]?.short ?? scopeLabel}
                  </span>
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
                {progress.steps.map((step, i) => (
                  <li
                    key={step.id}
                    className="scan-step"
                    data-status={step.status}
                    style={{ animationDelay: `${i * 30}ms` }}
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
      <div className="scan-actions">
        <div className="scan-split" ref={splitRef}>
          <button
            type="button"
            onClick={() => scan("full")}
            disabled={loading}
            className="btn-on-dark scan-split-main"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            {loading ? `Scan ${scopeLabel}…` : "Scansiona ora"}
          </button>
          <button
            type="button"
            className="btn-on-dark scan-split-toggle"
            disabled={loading}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Scegli tipo di scansione"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                menuOpen ? "rotate-180" : ""
              }`}
              strokeWidth={2.25}
            />
          </button>
        </div>
      </div>

      {error && !open && (
        <p className="mt-2 text-sm text-white/80">{error}</p>
      )}
      {menu}
      {panel}
    </>
  );
}
