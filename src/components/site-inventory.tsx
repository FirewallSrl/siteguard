"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Shield,
  Sparkles,
} from "lucide-react";
import type {
  SiteInventory,
  InventoryExtension,
} from "@/lib/scanner/inventory/types";

export function SiteInventoryView({
  inventoryJson,
  findingsCount = 0,
  onOpenRemediation,
}: {
  inventoryJson: string | null;
  findingsCount?: number;
  onOpenRemediation?: () => void;
}) {
  if (!inventoryJson) {
    return (
      <div className="panel px-5 py-12 text-center text-sm text-[var(--muted)]">
        Nessun inventario ancora. Avvia una scansione per rilevare versione CMS,
        componenti, plugin e temi.
      </div>
    );
  }

  let inv: SiteInventory;
  try {
    inv = JSON.parse(inventoryJson) as SiteInventory;
  } catch {
    return (
      <div className="panel px-5 py-8 text-sm text-[var(--danger)]">
        Inventario non leggibile.
      </div>
    );
  }

  return <InventoryDashboard inv={inv} findingsCount={findingsCount} onOpenRemediation={onOpenRemediation} />;
}

function InventoryDashboard({
  inv,
  findingsCount,
  onOpenRemediation,
}: {
  inv: SiteInventory;
  findingsCount: number;
  onOpenRemediation?: () => void;
}) {
  const pending = inv.updatesPending ?? countPending(inv);
  const outdated = useMemo(() => collectOutdated(inv), [inv]);
  const extTotal =
    inv.extensions.length + inv.plugins.length + (inv.modules?.length ?? 0);

  const coreFailNote = inv.notes?.find((n) =>
    /impossibile verificare.*core/i.test(n),
  );
  const linkNote = inv.notes?.find((n) => /link|url/i.test(n));
  const broken = inv.brokenLinks;
  const otherNotes =
    inv.notes?.filter(
      (n) =>
        n !== coreFailNote &&
        n !== linkNote &&
        !/core .*aggiornato/i.test(n) &&
        !/core joomla|core wordpress/i.test(n),
    ) ?? [];

  const sslOk = inv.ssl?.https && (inv.ssl.daysLeft == null || inv.ssl.daysLeft > 14);
  const sslExpiry = formatSslExpiry(inv.ssl?.validTo);
  const sslLabel = !inv.ssl?.https
    ? "No HTTPS"
    : sslExpiry
      ? inv.ssl.daysLeft != null
        ? `scade ${sslExpiry} · ${inv.ssl.daysLeft}g`
        : `scade ${sslExpiry}`
      : inv.ssl.daysLeft != null
        ? `${inv.ssl.daysLeft}g SSL`
        : "HTTPS ok";

  const updateTags = outdated.slice(0, 4).map((e) =>
    e.latestVersion ? `${e.name} → ${e.latestVersion}` : e.name,
  );
  const moreUpdates = Math.max(0, outdated.length - updateTags.length);

  return (
    <div className="space-y-4">
      {/* Priorità — cosa sapere subito */}
      <section className="priority-stack">
        <p className="priority-stack-label">Priorità</p>

        {inv.coreUpdateAvailable && inv.coreLatest ? (
          <PriorityRow
            tone="critical"
            title={`Core ${inv.cms} ${inv.coreVersion} → ${inv.coreLatest}`}
            body="Aggiornamento sistema disponibile"
            action={
              onOpenRemediation ? (
                <button type="button" className="btn-priority" onClick={onOpenRemediation}>
                  Remediation
                </button>
              ) : undefined
            }
          />
        ) : coreFailNote ? (
          <PriorityRow
            tone="warn"
            title="Core non verificato"
            body={coreFailNote}
          />
        ) : inv.coreLatest ? (
          <PriorityRow
            tone="ok"
            title={`Core ${inv.cms} ${inv.coreVersion}`}
            body={`Allineato al branch stabile (${inv.coreLatest})`}
          />
        ) : inv.coreVersion ? (
          <PriorityRow
            tone="neutral"
            title={`CMS ${inv.cms} ${inv.coreVersion}`}
            body="Versione rilevata"
          />
        ) : null}

        {pending > 0 && (
          <PriorityRow
            tone={inv.coreUpdateAvailable ? "warn" : "critical"}
            title={
              pending === 1
                ? "1 aggiornamento da fare"
                : `${pending} aggiornamenti da fare`
            }
            body={
              outdated.length > 0
                ? "Estensioni e componenti fuori versione"
                : "Dettaglio in remediation e nelle liste sotto"
            }
            tags={
              updateTags.length > 0
                ? [
                    ...updateTags,
                    ...(moreUpdates > 0 ? [`+${moreUpdates} altri`] : []),
                  ]
                : undefined
            }
            action={
              findingsCount > 0 && onOpenRemediation ? (
                <button type="button" className="btn-priority" onClick={onOpenRemediation}>
                  Remediation ({findingsCount})
                </button>
              ) : undefined
            }
          />
        )}

        {inv.ssl ? (
          <PriorityRow
            tone={sslOk ? "ok" : "warn"}
            title={sslOk ? "SSL / HTTPS" : "HTTPS / SSL da verificare"}
            body={sslLabel}
          />
        ) : null}

        {inv.phpAdvisories && inv.phpAdvisories.length > 0 ? (
          <PriorityRow
            tone="critical"
            title={`PHP ${inv.phpVersion ?? "?"} vulnerabile`}
            body="Advisory aperti · fonti ACN / php.net"
            tags={inv.phpAdvisories.map((a) =>
              a.eol ? `${a.id} · EOL` : a.id,
            )}
            action={
              onOpenRemediation ? (
                <button
                  type="button"
                  className="btn-priority"
                  onClick={onOpenRemediation}
                >
                  Remediation
                </button>
              ) : undefined
            }
          />
        ) : inv.phpVersion ? (
          <PriorityRow
            tone="ok"
            title={`PHP ${inv.phpVersion}`}
            body={`Runtime ok${
              inv.phpSource ? ` · rilevato via ${inv.phpSource}` : ""
            }`}
          />
        ) : null}

        {broken && broken.brokenCount > 0 && (
          <PriorityRow
            tone="warn"
            title={`${broken.brokenCount} URL rotti`}
            body={`${broken.linksChecked} link su ${broken.pagesScanned} pagine`}
            action={
              onOpenRemediation ? (
                <button
                  type="button"
                  className="btn-priority"
                  onClick={onOpenRemediation}
                >
                  Vedi finding
                </button>
              ) : undefined
            }
          />
        )}
        {broken && broken.brokenCount === 0 && broken.linksChecked > 0 && (
          <PriorityRow
            tone="ok"
            title="URL del sito ok"
            body={`${broken.linksChecked} link verificati · nessun 4xx/5xx`}
          />
        )}
      </section>

      {/* Snapshot compatto */}
      <div className="snap-bar">
        <SnapItem
          icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={2} />}
          label="CMS"
          value={`${inv.cms} ${inv.coreVersion ?? "—"}`}
        />
        <SnapItem
          icon={<Shield className="h-3.5 w-3.5" strokeWidth={2} />}
          label="SSL"
          value={sslLabel}
          ok={Boolean(sslOk)}
        />
        {inv.phpVersion && (
          <SnapItem
            label="PHP"
            value={inv.phpVersion}
            ok={!inv.phpAdvisories?.length}
          />
        )}
        <SnapItem label="Estensioni" value={String(extTotal)} />
        <SnapItem label="Template" value={String(inv.themes.length)} />
        <SnapItem
          label="Update"
          value={String(pending)}
          ok={pending === 0}
        />
        {broken && (
          <SnapItem
            label="URL"
            value={
              broken.brokenCount > 0
                ? `${broken.brokenCount} rotti`
                : `${broken.linksChecked} ok`
            }
            ok={broken.brokenCount === 0 && broken.linksChecked > 0}
          />
        )}
        {inv.database && <SnapItem label="DB" value={inv.database} />}
      </div>

      {broken && broken.brokenCount > 0 && broken.items && broken.items.length > 0 && (
        <section className="panel-well">
          <div className="flex items-baseline justify-between px-1 pb-1">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              URL rotti
            </h3>
            <span className="chip chip-rose">{broken.brokenCount}</span>
          </div>
          {broken.items.slice(0, 10).map((item) => (
            <div key={item.url} className="panel-row text-sm">
              <span className="chip chip-rose shrink-0">
                {item.status ?? "err"}
              </span>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
              >
                {item.url}
              </a>
            </div>
          ))}
        </section>
      )}

      {/* Solo elementi da aggiornare */}
      {outdated.length > 0 && (
        <section className="panel-well">
          <div className="flex items-baseline justify-between px-1 pb-1">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Da aggiornare ora
            </h3>
            <span className="chip chip-rose">{outdated.length}</span>
          </div>
          {outdated.map((row, i) => (
            <div key={`${row.folder}-${i}`} className="panel-row">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[var(--ink)]">{row.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {row.type}
                  {row.folder ? ` · ${row.folder}` : ""}
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--muted)]">
                {row.version ?? "?"}
              </span>
              <span className="chip chip-rose">→ {row.latestVersion}</span>
            </div>
          ))}
        </section>
      )}

      {otherNotes.length > 0 && (
        <div className="rounded-[var(--radius-sm)] bg-[var(--bg-soft)] px-4 py-3 text-xs text-[var(--muted)]">
          {otherNotes.map((n, i) => (
            <p key={`${i}-${n}`}>{n}</p>
          ))}
        </div>
      )}

      {/* Inventario completo — collassato di default */}
      <div className="space-y-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          Inventario completo
        </p>
        {inv.cms === "joomla" ? (
          <>
            <ExtAccordion title="Componenti" rows={inv.extensions} />
            <ExtAccordion title="Plugin" rows={inv.plugins} />
            <ExtAccordion title="Moduli" rows={inv.modules ?? []} />
            <ExtAccordion title="Template" rows={inv.themes} />
          </>
        ) : (
          <>
            <ExtAccordion title="Plugin" rows={inv.plugins} />
            <ExtAccordion title="Temi" rows={inv.themes} />
          </>
        )}
      </div>

      <p className="px-1 text-[0.7rem] text-[var(--muted)]">
        Rilevato{" "}
        {inv.collectedAt
          ? new Date(inv.collectedAt).toLocaleString("it-IT")
          : "—"}
        {inv.source.length > 0 ? ` · via ${inv.source.join(", ")}` : ""}
      </p>
    </div>
  );
}

const PRIORITY_META: Record<
  "critical" | "warn" | "ok" | "neutral",
  string
> = {
  critical: "Critico",
  warn: "Attenzione",
  ok: "Ok",
  neutral: "Info",
};

function PriorityRow({
  tone,
  title,
  body,
  tags,
  action,
}: {
  tone: "critical" | "warn" | "ok" | "neutral";
  title: string;
  body: string;
  tags?: string[];
  action?: ReactNode;
}) {
  return (
    <div
      className="priority-row"
      data-tone={tone}
      data-has-action={action ? "true" : undefined}
    >
      <span className="priority-icon" aria-hidden>
        {tone === "ok" ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        ) : tone === "neutral" ? (
          <Shield className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </span>
      <div className="priority-copy">
        <span className="priority-meta">{PRIORITY_META[tone]}</span>
        <p className="priority-title">{title}</p>
        <p className="priority-body">{body}</p>
        {tags && tags.length > 0 && (
          <div className="priority-tags">
            {tags.map((tag) => (
              <span key={tag} className="priority-tag" title={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {action ? <div className="priority-action">{action}</div> : null}
    </div>
  );
}

function SnapItem({
  label,
  value,
  ok,
  icon,
}: {
  label: string;
  value: string;
  ok?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="snap-item">
      {icon}
      <span className="text-[var(--muted)]">{label}</span>
      <strong className={ok === false ? "text-[var(--danger)]" : undefined}>
        {value}
      </strong>
      {ok === true && (
        <Check className="h-3 w-3 text-[var(--teal)]" strokeWidth={2.5} />
      )}
    </div>
  );
}

function ExtAccordion({
  title,
  rows,
}: {
  title: string;
  rows: InventoryExtension[];
}) {
  const outdated = rows.filter((r) => r.updateAvailable).length;
  const [open, setOpen] = useState(outdated > 0 && rows.length <= 30);

  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => {
    const au = a.updateAvailable ? 0 : 1;
    const bu = b.updateAvailable ? 0 : 1;
    if (au !== bu) return au - bu;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="accordion">
      <button
        type="button"
        className="accordion-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold text-[var(--ink)]">{title}</span>
        <span className="flex items-center gap-1.5">
          {outdated > 0 && (
            <span className="chip chip-rose">{outdated} update</span>
          )}
          <span className="chip chip-slate">{rows.length}</span>
          <ChevronDown
            className={`h-4 w-4 text-[var(--muted)] transition-transform ${
              open ? "rotate-180" : ""
            }`}
            strokeWidth={2}
          />
        </span>
      </button>
      {open && (
        <div className="accordion-body">
          <table className="w-full text-left text-sm">
            <thead className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Versione</th>
                <th className="px-3 py-2 font-medium">Update</th>
                <th className="px-3 py-2 font-medium">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sorted.map((row, i) => (
                <tr
                  key={`${row.folder}-${i}`}
                  className={
                    row.updateAvailable ? "bg-[var(--accent-soft)]/50" : undefined
                  }
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--ink)]">{row.name}</div>
                    <div className="font-mono text-[0.65rem] text-[var(--muted)]">
                      {row.folder ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.version ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.updateAvailable && row.latestVersion ? (
                      <span className="chip chip-rose">→ {row.latestVersion}</span>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.enabled == null ? (
                      "—"
                    ) : row.enabled ? (
                      <span className="chip chip-emerald">on</span>
                    ) : (
                      <span className="chip chip-slate">off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function collectOutdated(inv: SiteInventory): InventoryExtension[] {
  return [
    ...inv.extensions,
    ...inv.plugins,
    ...inv.themes,
    ...(inv.modules ?? []),
  ]
    .filter((e) => e.updateAvailable)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function countPending(inv: SiteInventory): number {
  return (inv.coreUpdateAvailable ? 1 : 0) + collectOutdated(inv).length;
}

function formatSslExpiry(validTo?: string): string | null {
  if (!validTo) return null;
  const d = new Date(validTo);
  if (Number.isNaN(d.getTime())) return validTo.slice(0, 10);
  return d.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
