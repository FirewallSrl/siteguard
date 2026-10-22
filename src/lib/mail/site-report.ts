import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { SiteInventory } from "@/lib/scanner/inventory/types";
import {
  REMEDIATION_GROUPS,
  groupIdForFinding,
  severityRank,
} from "@/lib/remediation-groups";

export type ReportFinding = {
  type: string;
  severity: string;
  title: string;
  description: string;
  evidence: string | null;
  createdAt: Date;
};

export type SiteReportInput = {
  site: {
    name: string;
    url: string;
    cms: string;
    status: string;
    lastScanAt: Date | null;
  };
  inventory: SiteInventory | null;
  findings: ReportFinding[];
  operatorNote?: string;
  generatedAt?: Date;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseModifiedAt(evidence: string | null): string | null {
  if (!evidence) return null;
  try {
    const ev = JSON.parse(evidence) as { modifiedAt?: string };
    if (typeof ev.modifiedAt === "string" && ev.modifiedAt) {
      const d = new Date(ev.modifiedAt);
      if (!Number.isNaN(d.getTime())) {
        return format(d, "d MMMM yyyy, HH:mm", { locale: it });
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function formatSsl(inv: SiteInventory | null): string {
  if (!inv?.ssl) return "non verificato";
  if (!inv.ssl.https) return "assente / non HTTPS";
  const parts = ["attivo"];
  if (inv.ssl.validTo) {
    parts.push(
      `scade ${format(new Date(inv.ssl.validTo), "d MMM yyyy", { locale: it })}`,
    );
  }
  if (inv.ssl.daysLeft != null) parts.push(`${inv.ssl.daysLeft} giorni residui`);
  return parts.join(" · ");
}

export function buildSiteReport(input: SiteReportInput): {
  subject: string;
  text: string;
  html: string;
} {
  const at = input.generatedAt ?? new Date();
  const inv = input.inventory;
  const cmsLabel = inv?.coreVersion
    ? `${inv.cms} ${inv.coreVersion}`
    : input.site.cms;
  const extTotal = inv
    ? inv.extensions.length +
      inv.plugins.length +
      inv.themes.length +
      (inv.modules?.length ?? 0)
    : 0;
  const pending = inv?.updatesPending ?? 0;
  const openFindings = [...input.findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.title.localeCompare(b.title),
  );

  const subject = `Report SiteGuard · ${input.site.name} · ${format(at, "d MMM yyyy", { locale: it })}`;

  const lines: string[] = [
    `Report SiteGuard — ${input.site.name}`,
    input.site.url,
    `Generato: ${format(at, "d MMMM yyyy, HH:mm", { locale: it })}`,
    "",
    "— Riepilogo —",
    `CMS: ${cmsLabel}`,
    `Stato: ${input.site.status}`,
    `SSL: ${formatSsl(inv)}`,
    `PHP: ${inv?.phpVersion ?? "n/d"}${inv?.phpSource ? ` (via ${inv.phpSource})` : ""}`,
    `Database: ${inv?.database ?? "n/d"}`,
    `Estensioni/plugin/moduli/template: ${extTotal}`,
    `Update pendenti: ${pending}`,
    `Finding aperti: ${openFindings.length}`,
    input.site.lastScanAt
      ? `Ultimo scan: ${format(input.site.lastScanAt, "d MMMM yyyy, HH:mm", { locale: it })}`
      : "Ultimo scan: mai",
  ];

  if (input.operatorNote?.trim()) {
    lines.push("", "— Nota operatore —", input.operatorNote.trim());
  }

  if (inv?.phpAdvisories?.length) {
    lines.push("", "— Advisory PHP —");
    for (const a of inv.phpAdvisories) {
      lines.push(`• [${a.severity}] ${a.title}${a.fixedIn ? ` → fix ${a.fixedIn}` : ""}`);
    }
  }

  if (openFindings.length) {
    lines.push("", "— Finding aperti —");
    for (const g of REMEDIATION_GROUPS) {
      const items = openFindings.filter((f) => groupIdForFinding(f) === g.id);
      if (!items.length) continue;
      lines.push(``, `[${g.label}]`);
      for (const f of items) {
        const mtime = parseModifiedAt(f.evidence);
        lines.push(
          `• [${f.severity}] ${f.title}`,
          `  ${f.description}`,
          mtime ? `  Possibile data compromissione (mtime): ${mtime}` : "",
        );
      }
    }
  } else {
    lines.push("", "Nessun finding aperto in coda.");
  }

  if (inv?.notes?.length) {
    lines.push("", "— Note tecniche —", ...inv.notes.map((n) => `• ${n}`));
  }

  lines.push(
    "",
    "—",
    "Report generato da SiteGuard (Firewall SRL).",
    "Non include password o chiavi di accesso.",
  );

  const text = lines.filter((l) => l !== "").join("\n");

  const findingHtml = openFindings.length
    ? REMEDIATION_GROUPS.map((g) => {
        const items = openFindings.filter((f) => groupIdForFinding(f) === g.id);
        if (!items.length) return "";
        const rows = items
          .map((f) => {
            const mtime = parseModifiedAt(f.evidence);
            return `<tr>
              <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
                <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${
                  f.severity === "critical"
                    ? "#fee2e2"
                    : f.severity === "high"
                      ? "#ffedd5"
                      : "#f3f4f6"
                };color:${
                  f.severity === "critical"
                    ? "#991b1b"
                    : f.severity === "high"
                      ? "#9a3412"
                      : "#374151"
                };font-size:11px;font-weight:700;text-transform:uppercase;">${esc(f.severity)}</span>
              </td>
              <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">
                <div style="font-weight:600;color:#111;">${esc(f.title)}</div>
                <div style="margin-top:4px;color:#6b7280;font-size:13px;">${esc(f.description)}</div>
                ${
                  mtime
                    ? `<div style="margin-top:6px;color:#9a3412;font-size:12px;">Possibile data compromissione: ${esc(mtime)}</div>`
                    : ""
                }
              </td>
            </tr>`;
          })
          .join("");
        return `<h3 style="margin:20px 0 8px;font-size:14px;color:#111;">${esc(g.label)}</h3>
          <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">${esc(g.actionHint)}</p>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">${rows}</table>`;
      }).join("")
    : `<p style="color:#059669;font-weight:600;">Nessun finding aperto in coda.</p>`;

  const html = `<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:0;background:#f3f4f6;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">
  <div style="max-width:640px;margin:24px auto;padding:0 16px;">
    <div style="background:#0f172a;color:#fff;border-radius:16px 16px 0 0;padding:24px 28px;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;">SiteGuard · Firewall SRL</div>
      <h1 style="margin:8px 0 4px;font-size:22px;">Report ${esc(input.site.name)}</h1>
      <a href="${esc(input.site.url)}" style="color:#99f6e4;font-size:13px;word-break:break-all;">${esc(input.site.url)}</a>
      <p style="margin:10px 0 0;font-size:12px;opacity:0.7;">Generato ${esc(format(at, "d MMMM yyyy, HH:mm", { locale: it }))}</p>
    </div>
    <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:0;">
      ${
        input.operatorNote?.trim()
          ? `<div style="margin-bottom:18px;padding:12px 14px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:6px;font-size:14px;">
              <strong>Nota operatore</strong><br/>${esc(input.operatorNote.trim())}
            </div>`
          : ""
      }
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">CMS</td><td style="padding:6px 0;font-weight:600;text-align:right;">${esc(cmsLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">SSL</td><td style="padding:6px 0;font-weight:600;text-align:right;">${esc(formatSsl(inv))}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">PHP</td><td style="padding:6px 0;font-weight:600;text-align:right;">${esc(inv?.phpVersion ?? "n/d")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Database</td><td style="padding:6px 0;font-weight:600;text-align:right;">${esc(inv?.database ?? "n/d")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Estensioni</td><td style="padding:6px 0;font-weight:600;text-align:right;">${extTotal}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Update pendenti</td><td style="padding:6px 0;font-weight:600;text-align:right;">${pending}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Finding aperti</td><td style="padding:6px 0;font-weight:600;text-align:right;">${openFindings.length}</td></tr>
      </table>
      <h2 style="margin:28px 0 8px;font-size:16px;">Finding</h2>
      ${findingHtml}
    </div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;padding:16px 28px;font-size:11px;color:#9ca3af;">
      Report automatico SiteGuard. Non include password o chiavi di accesso.
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
