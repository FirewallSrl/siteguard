export type ScanStepStatus = "pending" | "active" | "done" | "error" | "skipped";

export type ScanStep = {
  id: string;
  label: string;
  detail?: string;
  status: ScanStepStatus;
};

export type ScanProgress = {
  scanId: string;
  siteId: string;
  percent: number;
  current: string;
  steps: ScanStep[];
  finished?: boolean;
  error?: string;
  updatedAt: number;
};

const STEP_DEFS: Array<{ id: string; label: string }> = [
  { id: "start", label: "Avvio scansione" },
  { id: "ssl", label: "Controllo HTTPS / SSL" },
  { id: "links", label: "Analisi link del sito" },
  { id: "api", label: "Check API CMS" },
  { id: "sftp", label: "Connessione SFTP" },
  { id: "inventory", label: "Inventario estensioni" },
  { id: "updates", label: "Aggiornamenti sistema" },
  { id: "save", label: "Salvataggio finding" },
  { id: "done", label: "Completato" },
];

const store = new Map<string, ScanProgress>();

export function initScanProgress(scanId: string, siteId: string): ScanProgress {
  const progress: ScanProgress = {
    scanId,
    siteId,
    percent: 0,
    current: "In coda…",
    steps: STEP_DEFS.map((s) => ({ ...s, status: "pending" as const })),
    updatedAt: Date.now(),
  };
  store.set(scanId, progress);
  return progress;
}

export function getScanProgress(scanId: string): ScanProgress | null {
  return store.get(scanId) ?? null;
}

export function clearScanProgress(scanId: string) {
  store.delete(scanId);
}

export type ProgressReporter = {
  start: (id: string, detail?: string) => void;
  done: (id: string, detail?: string) => void;
  skip: (id: string, detail?: string) => void;
  fail: (id: string, detail?: string) => void;
  setCurrent: (message: string) => void;
};

export function createProgressReporter(scanId: string): ProgressReporter {
  function bump(id: string, status: ScanStepStatus, detail?: string) {
    const p = store.get(scanId);
    if (!p) return;
    const idx = p.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    p.steps[idx] = {
      ...p.steps[idx]!,
      status,
      detail: detail ?? p.steps[idx]!.detail,
    };
    const weight = 100 / p.steps.length;
    p.percent = Math.min(
      99,
      Math.round(
        p.steps.reduce((acc, s) => {
          if (s.status === "done" || s.status === "skipped") return acc + weight;
          if (s.status === "active") return acc + weight * 0.45;
          return acc;
        }, 0),
      ),
    );
    p.current =
      detail ||
      p.steps.find((s) => s.status === "active")?.label ||
      p.current;
    p.updatedAt = Date.now();
  }

  return {
    start(id, detail) {
      bump(id, "active", detail);
    },
    done(id, detail) {
      bump(id, "done", detail);
    },
    skip(id, detail) {
      bump(id, "skipped", detail);
    },
    fail(id, detail) {
      bump(id, "error", detail);
      const p = store.get(scanId);
      if (p) {
        p.error = detail;
        p.updatedAt = Date.now();
      }
    },
    setCurrent(message) {
      const p = store.get(scanId);
      if (!p) return;
      p.current = message;
      p.updatedAt = Date.now();
    },
  };
}

export function finishScanProgress(
  scanId: string,
  opts: { ok: boolean; summary?: string; error?: string },
) {
  const p = store.get(scanId);
  if (!p) return;
  if (opts.ok) {
    for (const step of p.steps) {
      if (step.status === "pending" || step.status === "active") {
        step.status = "done";
      }
    }
    p.percent = 100;
    p.current = opts.summary ?? "Scansione completata";
    p.finished = true;
  } else {
    p.error = opts.error ?? "Scan fallito";
    p.finished = true;
    p.current = p.error;
    const active = p.steps.find((s) => s.status === "active");
    if (active) active.status = "error";
  }
  p.updatedAt = Date.now();
}
