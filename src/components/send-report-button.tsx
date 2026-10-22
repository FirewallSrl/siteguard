"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Mail, X } from "lucide-react";

export function SendReportButton({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sites/${siteId}/report`);
        const data = await res.json();
        setConfigured(Boolean(data.configured));
        setFrom(typeof data.from === "string" ? data.from : null);
        if (typeof data.defaultTo === "string" && data.defaultTo) {
          setTo((cur) => cur || data.defaultTo);
        }
      } catch {
        setConfigured(false);
      }
    })();
  }, [open, siteId]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim(), note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Invio fallito",
        );
      }
      setDone(typeof data.to === "string" ? data.to : to.trim());
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-on-dark"
        title="Invia report via email"
      >
        <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
        Invia report
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label="Invia report email"
            onClick={() => !busy && setOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-[18px] bg-[var(--bg-panel)] p-5 shadow-[var(--shadow-lg)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    Invia report
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Riepilogo inventario e finding aperti per{" "}
                    <strong className="text-[var(--ink)]">{siteName}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-2"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  aria-label="Chiudi"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              {configured === false && (
                <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--bg-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                  SMTP non configurato. Aggiungi{" "}
                  <code className="font-mono text-xs">SMTP_HOST</code> e{" "}
                  <code className="font-mono text-xs">SMTP_FROM</code> nel{" "}
                  <code className="font-mono text-xs">.env</code>, poi riavvia
                  il server.
                </p>
              )}

              <form onSubmit={onSend} className="mt-4 space-y-3">
                <label className="block text-sm text-[var(--muted)]">
                  Destinatario
                  <input
                    type="email"
                    required
                    className="field mt-1"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="cliente@esempio.it"
                    autoComplete="email"
                    disabled={busy || configured === false}
                  />
                </label>
                <label className="block text-sm text-[var(--muted)]">
                  Nota (opzionale)
                  <textarea
                    className="field mt-1 min-h-[72px]"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Es. priorità cleanup malware entro venerdì…"
                    disabled={busy || configured === false}
                  />
                </label>
                {from && (
                  <p className="text-xs text-[var(--muted)]">
                    Mittente: <span className="font-mono">{from}</span>
                  </p>
                )}
                {error && (
                  <p className="text-sm text-[var(--danger)]">{error}</p>
                )}
                {done && (
                  <p className="inline-flex items-center gap-1.5 text-sm text-[var(--teal)]">
                    <Check className="h-4 w-4" strokeWidth={2} />
                    Inviato a {done}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setOpen(false)}
                    disabled={busy}
                  >
                    Chiudi
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={busy || configured === false || !to.trim()}
                  >
                    {busy ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          strokeWidth={1.75}
                        />
                        Invio…
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4" strokeWidth={1.75} />
                        Invia email
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
