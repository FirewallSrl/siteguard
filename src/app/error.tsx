"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-2xl font-bold text-[var(--ink)]">
        Errore del server
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {error.message || "Qualcosa è andato storto."}
        {error.digest ? ` · digest ${error.digest}` : ""}
      </p>
      <p className="mt-3 text-xs text-[var(--muted)]">
        In produzione verifica su Vercel le variabili{" "}
        <code className="font-mono">DATABASE_URL</code> e{" "}
        <code className="font-mono">CREDENTIALS_SECRET</code>.
      </p>
      <button type="button" className="btn-primary mt-6" onClick={reset}>
        Riprova
      </button>
    </div>
  );
}
