"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddSiteForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);

    const sftpHost = String(fd.get("sftpHost") || "").trim();
    const apiUser = String(fd.get("apiUser") || "").trim();

    const body: Record<string, unknown> = {
      name: fd.get("name"),
      url: fd.get("url"),
      cms: fd.get("cms"),
    };

    if (sftpHost) {
      body.sftp = {
        host: sftpHost,
        port: Number(fd.get("sftpPort") || 22),
        username: fd.get("sftpUser"),
        password: fd.get("sftpPassword") || undefined,
        rootPath: fd.get("sftpRoot") || "/public_html",
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
      router.push(`/sites/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
    }
  }

  const label = "block text-sm text-[var(--muted)]";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-base font-bold text-[var(--ink)]">Sito</h2>
        <label className={label}>
          Nome
          <input name="name" required className="field" placeholder="Cliente Rossi" />
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
        <label className={label}>
          CMS
          <select name="cms" className="field" defaultValue="wordpress">
            <option value="wordpress">WordPress</option>
            <option value="joomla">Joomla</option>
          </select>
        </label>
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-base font-bold text-[var(--ink)]">
          API CMS
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

      <section className="panel space-y-3 p-5">
        <h2 className="font-display text-base font-bold text-[var(--ink)]">SFTP</h2>
        <p className="text-xs text-[var(--muted)]">
          File integrity, malware, cleanup. Preferisci chiave dedicata + chroot.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Host
            <input name="sftpHost" className="field" />
          </label>
          <label className={label}>
            Porta
            <input name="sftpPort" type="number" defaultValue={22} className="field" />
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
        <label className={label}>
          Root path
          <input
            name="sftpRoot"
            className="field"
            placeholder="httpdocs"
            defaultValue="httpdocs"
          />
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Plesk: di solito <code>httpdocs</code> (senza slash iniziale).
          </span>
        </label>
      </section>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Salvataggio…" : "Salva sito"}
      </button>
      <p className="text-xs text-[var(--muted)]">
        Con DEMO_SCAN=true puoi salvare senza credenziali: lo scan genera finding di esempio.
      </p>
    </form>
  );
}
