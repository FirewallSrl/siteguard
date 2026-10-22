"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel mx-auto max-w-lg px-6 py-10 text-center">
      <p className="font-display text-xl font-bold text-[var(--ink)]">
        Dashboard non disponibile
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {/prisma|database|P1001|P1017|connect/i.test(error.message)
          ? "Connessione al database fallita. Controlla DATABASE_URL su Vercel e che Postgres accetti connessioni dal runtime."
          : error.message || "Errore durante il caricamento."}
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[0.7rem] text-[var(--muted)]">
          {error.digest}
        </p>
      )}
      <button type="button" className="btn-primary mt-6" onClick={reset}>
        Riprova
      </button>
    </div>
  );
}
