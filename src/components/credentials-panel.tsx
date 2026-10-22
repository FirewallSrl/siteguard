"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, PlugZap, ShieldCheck } from "lucide-react";
import type { SecretsMeta } from "@/lib/secrets/safe";

type TestResult = {
  sftp: { ok: boolean; latencyMs: number; message: string } | null;
  api: { ok: boolean; latencyMs: number; message: string } | null;
};

type RevealedSftp = {
  host: string;
  port: number;
  username: string;
  password: string;
  protocol: "sftp" | "ftp" | "ftps";
  rootPath: string;
  hasPrivateKey: boolean;
};

export function CredentialsPanel({ siteId }: { siteId: string }) {
  const [meta, setMeta] = useState<SecretsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
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

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function revealSftp(): Promise<RevealedSftp> {
    const res = await fetch(`/api/sites/${siteId}/credentials/reveal`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Impossibile leggere gli accessi");
    return data.sftp as RevealedSftp;
  }

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setMessage(`Copiato: ${label}`);
  }

  async function onCopyField(field: "host" | "username" | "password" | "port") {
    setError(null);
    setCopying(true);
    try {
      const sftp = await revealSftp();
      const value =
        field === "host"
          ? sftp.host
          : field === "username"
            ? sftp.username
            : field === "port"
              ? String(sftp.port)
              : sftp.password;
      if (!value) {
        throw new Error(
          field === "password"
            ? "Nessuna password salvata (accesso via chiave?)"
            : "Valore vuoto",
        );
      }
      await copyText(
        field === "host"
          ? "host"
          : field === "username"
            ? "utente"
            : field === "port"
              ? "porta"
              : "password",
        value,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setCopying(false);
    }
  }

  async function onCopyAll() {
    setError(null);
    setCopying(true);
    try {
      const sftp = await revealSftp();
      const lines = [
        `Protocollo: ${sftp.protocol.toUpperCase()}`,
        `Host: ${sftp.host}`,
        `Porta: ${sftp.port}`,
        `Utente: ${sftp.username}`,
        `Password: ${sftp.password || "(nessuna — autenticazione a chiave)"}`,
        `Root: ${sftp.rootPath}`,
      ];
      await copyText("accessi FTP", lines.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setCopying(false);
    }
  }

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
      setMessage("Rilevo porta, root e CMS…");
      body.sftp = {
        host: sftpHost || meta?.sftp?.host,
        username: String(fd.get("sftpUser") || meta?.sftp?.username || ""),
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
      const d = data.discovery as
        | {
            protocol?: string;
            port?: number;
            rootPath?: string;
            cms?: string;
          }
        | undefined;
      setMessage(
        d
          ? `Salvato · ${(d.protocol ?? "sftp").toUpperCase()} :${d.port} · ${d.rootPath} · ${d.cms ?? "cms?"}`
          : "Credenziali aggiornate (cifrate at rest).",
      );
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
      await loadMeta();
      if (data.sftp?.ok) {
        setMessage(data.sftp.message);
      }
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
            Password e chiavi non vengono caricate nel form. Lascia vuoto un
            campo segreto per mantenerlo invariato.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {meta?.hasSftp && (
            <button
              type="button"
              onClick={() => void onCopyAll()}
              disabled={copying}
              className="btn-ghost"
            >
              {copied === "accessi FTP" ? (
                <Check className="h-4 w-4 text-[var(--teal)]" strokeWidth={1.75} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.75} />
              )}
              {copying ? "Copio…" : "Copia accessi FTP"}
            </button>
          )}
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
            <li>Trasporto HTTPS in produzione · form senza password salvate</li>
            <li>Copia accessi on-demand (auditata) · errori sanificati</li>
          </ul>
        </div>
      </div>

      {test && (
        <div className="grid gap-2 sm:grid-cols-2">
          {test.sftp && <TestCard label="SFTP" result={test.sftp} />}
          {test.api && <TestCard label="API CMS" result={test.api} />}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-4" autoComplete="off">
        <div className="panel space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound className="h-4 w-4 text-[var(--muted)]" strokeWidth={1.75} />
            <h3 className="font-display text-base font-bold text-[var(--ink)]">
              SFTP / FTP
            </h3>
            {meta?.hasSftp && (
              <span className="font-mono text-[0.65rem] uppercase tracking-wide text-[var(--teal)]">
                configurato · {meta.sftp?.auth}
              </span>
            )}
          </div>
          {meta?.sftp && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span>
                Rilevato:{" "}
                <strong className="text-[var(--ink)]">
                  {meta.sftp.protocol.toUpperCase()}
                </strong>
                {" · porta "}
                <strong className="text-[var(--ink)]">{meta.sftp.port}</strong>
                {" · root "}
                <strong className="text-[var(--ink)]">{meta.sftp.rootPath}</strong>
              </span>
              <CopyChip
                label="porta"
                active={copied === "porta"}
                disabled={copying}
                onClick={() => void onCopyField("port")}
              />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-[var(--muted)] sm:col-span-2">
              <span className="mb-1 flex items-center justify-between gap-2">
                Host
                {meta?.hasSftp && (
                  <CopyChip
                    label="host"
                    active={copied === "host"}
                    disabled={copying}
                    onClick={() => void onCopyField("host")}
                  />
                )}
              </span>
              <input
                name="sftpHost"
                className="field"
                defaultValue={meta?.sftp?.host ?? ""}
                placeholder="ftp.esempio.it"
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              <span className="mb-1 flex items-center justify-between gap-2">
                Username
                {meta?.hasSftp && (
                  <CopyChip
                    label="utente"
                    active={copied === "utente"}
                    disabled={copying}
                    onClick={() => void onCopyField("username")}
                  />
                )}
              </span>
              <input
                name="sftpUser"
                className="field"
                defaultValue={meta?.sftp?.username ?? ""}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              <span className="mb-1 flex items-center justify-between gap-2">
                Password
                {meta?.hasSftp && meta.sftp?.auth === "password" && (
                  <CopyChip
                    label="password"
                    active={copied === "password"}
                    disabled={copying}
                    onClick={() => void onCopyField("password")}
                  />
                )}
              </span>
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
          <p className="text-xs text-[var(--muted)]">
            Al salvataggio/test sondiamo le porte aperte e proviamo SFTP, FTP e
            FTPS; poi individuiamo root e CMS (WordPress/Joomla).
          </p>
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

function CopyChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide text-[var(--ink)] transition-colors hover:border-[var(--border-strong)] disabled:opacity-45"
      title={`Copia ${label}`}
    >
      {active ? (
        <Check className="h-3 w-3 text-[var(--teal)]" strokeWidth={2} />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={2} />
      )}
      {active ? "ok" : "copia"}
    </button>
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
