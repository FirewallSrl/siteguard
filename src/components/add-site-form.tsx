"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddSiteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus(null);
    const fd = new FormData(e.currentTarget);

    const sftpHost = String(fd.get("sftpHost") || "").trim();
    const apiUser = String(fd.get("apiUser") || "").trim();

    const body: Record<string, unknown> = {
      name: fd.get("name"),
      url: fd.get("url"),
    };

    if (sftpHost) {
      setStatus("Provo porte SFTP e cerco root CMS…");
      body.sftp = {
        host: sftpHost,
        username: fd.get("sftpUser"),
        password: fd.get("sftpPassword") || undefined,
      };
    }

    if (apiUser) {
      body.api = {
        username: apiUser,
        appPassword: fd.get("apiPassword"),
      };
    }

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Creazione fallita",
        );
      }
      router.push(`/sites/${data.id}?tab=panoramica`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }

  const label = "block text-sm text-[var(--muted)]";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-base font-bold text-[var(--ink)]">
          Sito
        </h2>
        <label className={label}>
          Nome
          <input
            name="name"
            required
            className="field"
            placeholder="Cliente Rossi"
          />
        </label>
        <label className={label}>
          URL
          <input
            name="url"
            type="url"
            required
            className="field"
            placeholder="https://www.esempio.it"
          />
        </label>
        <p className="text-xs text-[var(--muted)]">
          CMS, protocollo (SFTP o FTP), porta e cartella root vengono rilevati
          automaticamente alla connessione.
        </p>
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-base font-bold text-[var(--ink)]">
          SFTP
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Basta host, utente e password. Proviamo SFTP / FTP / FTPS sulle porte
          aperte e individuiamo root + CMS.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>
            Host
            <input
              name="sftpHost"
              className="field"
              placeholder="vps.esempio.it"
            />
          </label>
          <label className={label}>
            Username
            <input name="sftpUser" className="field" autoComplete="off" />
          </label>
          <label className={label}>
            Password
            <input
              name="sftpPassword"
              type="password"
              className="field"
              autoComplete="new-password"
            />
          </label>
        </div>
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-base font-bold text-[var(--ink)]">
          API CMS
          <span className="ml-2 text-xs font-medium text-[var(--muted)]">
            opzionale
          </span>
        </h2>
        <p className="text-xs text-[var(--muted)]">
          WordPress: Application Password · Joomla: API token Bearer
        </p>
        <label className={label}>
          Username
          <input name="apiUser" className="field" autoComplete="off" />
        </label>
        <label className={label}>
          Application Password / Token
          <input
            name="apiPassword"
            type="password"
            className="field"
            autoComplete="new-password"
          />
        </label>
      </section>

      {status && <p className="text-sm text-[var(--muted)]">{status}</p>}
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Rilevamento e salvataggio…" : "Salva sito"}
      </button>
    </form>
  );
}
