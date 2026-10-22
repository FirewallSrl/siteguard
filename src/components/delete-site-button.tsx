"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

export function DeleteSiteButton({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    const ok = window.confirm(
      `Eliminare «${siteName}»?\n\nVerranno cancellati scan, finding, azioni e credenziali. Operazione irreversibile.`,
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Eliminazione fallita",
        );
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void onDelete()}
        disabled={busy}
        className="btn-on-dark"
        style={{ background: "rgba(220,38,38,0.92)", color: "#fff" }}
        title="Elimina sito"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        {busy ? "Elimino…" : "Elimina"}
      </button>
      {error && (
        <p className="max-w-[14rem] text-right text-xs text-[#fecaca]">{error}</p>
      )}
    </div>
  );
}
