"use client";

import { useEffect, useState } from "react";
import { KeyRound, PlugZap, ShieldCheck } from "lucide-react";
import type { SecretsMeta } from "@/lib/secrets/safe";

type TestResult = {
  sftp: { ok: boolean; latencyMs: number; message: string } | null;
  api: { ok: boolean; latencyMs: number; message: string } | null;
};

export function CredentialsPanel({ siteId }: { siteId: string }) {
  const [meta, setMeta] = useState<SecretsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  async function loadMeta() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/credentials`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setMeta(data.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    setTest(null);

    const fd = new FormData(e.currentTarget);
    const sftpHost = String(fd.get("sftpHost") || "").trim();
    const apiUser = String(fd.get("apiUser") || "").trim();

    const body: Record<string, unknown> = {};

    if (sftpHost || meta?.hasSftp) {
      body.sftp = {
        host: sftpHost || meta?.sftp?.host,
        port: Number(fd.get("sftpPort") || meta?.sftp?.port || 22),
        username: String(fd.get("sftpUser") || meta?.sftp?.username || ""),
        rootPath: String(fd.get("sftpRoot") || meta?.sftp?.rootPath || "/public_html"),
        password: String(fd.get("sftpPassword") || ""),
        privateKey: String(fd.get("sftpKey") || ""),
      };
    }

    if (apiUser || meta?.hasApi) {
      body.api = {
        username: apiUser || meta?.api?.username,
        appPassword: String(fd.get("apiPassword") || ""),
      };
    }

    try {
      const res = await fetch(`/api/sites/${siteId}/credentials`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Salvataggio fallito");
      setMeta(data.meta);
      setMessage("Credenziali aggiornate (cifrate at rest).");
      // svuota campi password dopo save
      e.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test fallito");
      setTest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="panel p-5 text-sm text-[var(--muted)]">
        Caricamento accessi…
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[var(--ink)]">
            Accessi
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Password e chiavi non vengono mai rimandate al browser. Lascia vuoto
            un campo segreto per mantenerlo invariato.
          </p>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={testing || (!meta?.hasSftp && !meta?.hasApi)}
          className="btn-ghost"
        >
          <PlugZap className="h-4 w-4" strokeWidth={1.75} />
          {testing ? "Test in corso…" : "Testa la connessione"}
        </button>
      </div>

      <div className="panel flex gap-3 border-l-[3px] border-l-[var(--cyan)] p-4 text-sm text-[var(--muted)]">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cyan)]"
          strokeWidth={1.75}
        />
        <div>
          <p className="font-medium text-[var(--ink)]">Tutela secret</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Cifratura AES-256-GCM at rest (chiave solo server)</li>
            <li>Trasporto HTTPS in produzione · password mai rimandate al browser</li>
            <li>Audit log senza secret · errori sanificati</li>
          </ul>
        </div>
      </div>

      {test && (
        <div className="grid gap-2 sm:grid-cols-2">
          {test.sftp && (
            <TestCard label="SFTP" result={test.sftp} />
          )}
          {test.api && <TestCard label="API CMS" result={test.api} />}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-4" autoComplete="off">
        <div className="panel space-y-3 p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--muted)]" strokeWidth={1.75} />
            <h3 className="font-display text-base font-bold text-[var(--ink)]">
              SFTP
            </h3>
            {meta?.hasSftp && (
              <span className="font-mono text-[0.65rem] uppercase tracking-wide text-[var(--teal)]">
                configurato · {meta.sftp?.auth}
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-[var(--muted)]">
              Host
              <input
                name="sftpHost"
                className="field"
                defaultValue={meta?.sftp?.host ?? ""}
                placeholder="ftp.esempio.it"
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Porta
              <input
                name="sftpPort"
                type="number"
                className="field"
                defaultValue={meta?.sftp?.port ?? 22}
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Username
              <input
                name="sftpUser"
                className="field"
                defaultValue={meta?.sftp?.username ?? ""}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Password
              <input
                name="sftpPassword"
                type="password"
                className="field"
                placeholder={
                  meta?.sftp?.auth === "password"
                    ? "•••••••• (invariata se vuoto)"
                    : "Nuova password"
                }
                autoComplete="new-password"
              />
            </label>
          </div>
          <label className="block text-sm text-[var(--muted)]">
            Root path
            <input
              name="sftpRoot"
              className="field"
              defaultValue={meta?.sftp?.rootPath ?? "httpdocs"}
              placeholder="httpdocs (senza / iniziale su Plesk)"
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Su Plesk usa spesso <code>httpdocs</code> o <code>public_html</code>{" "}
              relativi — non <code>/httpdocs</code> assoluto.
            </span>
          </label>
          <label className="block text-sm text-[var(--muted)]">
            Chiave privata (opzionale, alternativa alla password)
            <textarea
              name="sftpKey"
              className="field min-h-[88px] font-mono text-xs"
              placeholder={
                meta?.sftp?.auth === "key"
                  ? "Lascia vuoto per mantenere la chiave salvata"
                  : "-----BEGIN OPENSSH PRIVATE KEY-----"
              }
              autoComplete="off"
            />
          </label>
        </div>

        <div className="panel space-y-3 p-5">
          <h3 className="font-display text-base font-bold text-[var(--ink)]">
            API CMS
          </h3>
          {meta?.hasApi && (
            <p className="font-mono text-[0.65rem] uppercase tracking-wide text-[var(--teal)]">
              configurata · {meta.api?.username}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-[var(--muted)]">
              Username
              <input
                name="apiUser"
                className="field"
                defaultValue={meta?.api?.username ?? ""}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Application Password / Token
              <input
                name="apiPassword"
                type="password"
                className="field"
                placeholder={
                  meta?.hasApi
                    ? "•••••••• (invariata se vuoto)"
                    : "Token o app password"
                }
                autoComplete="new-password"
              />
            </label>
          </div>
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {message && <p className="text-sm text-[var(--teal)]">{message}</p>}

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? "Salvataggio…" : "Salva accessi"}
        </button>
      </form>
    </section>
  );
}

function TestCard({
  label,
  result,
}: {
  label: string;
  result: { ok: boolean; latencyMs: number; message: string };
}) {
  return (
    <div
      className={`panel border-l-[3px] p-4 text-sm ${
        result.ok ? "border-l-[var(--teal)]" : "border-l-[var(--danger)]"
      }`}
    >
      <p className="font-mono text-[0.65rem] uppercase tracking-wide text-[var(--muted)]">
        {label} · {result.latencyMs}ms
      </p>
      <p
        className={`mt-1 font-medium ${
          result.ok ? "text-[var(--teal)]" : "text-[var(--danger)]"
        }`}
      >
        {result.ok ? "OK" : "Fallito"}
      </p>
      <p className="mt-1 text-[var(--muted)]">{result.message}</p>
    </div>
  );
}
