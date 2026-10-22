/** Categorie operative per la coda Remediation (flusso gestionale). */

export type RemediationGroupId =
  | "compromise"
  | "runtime"
  | "updates"
  | "hardening"
  | "content"
  | "other";

export type RemediationGroupDef = {
  id: RemediationGroupId;
  order: number;
  label: string;
  short: string;
  description: string;
  /** Cosa fare in questa fase */
  actionHint: string;
};

export const REMEDIATION_GROUPS: RemediationGroupDef[] = [
  {
    id: "compromise",
    order: 1,
    label: "Compromissione",
    short: "Sicurezza",
    description: "Malware, backdoor, utenti sospetti, hijack impostazioni.",
    actionHint: "Isola e rimuovi prima di qualsiasi altro intervento.",
  },
  {
    id: "runtime",
    order: 2,
    label: "Runtime & vulnerabilità",
    short: "Runtime",
    description: "PHP e componenti con advisory aperti.",
    actionHint: "Aggiorna runtime / patch CVE dopo il cleanup.",
  },
  {
    id: "updates",
    order: 3,
    label: "Aggiornamenti CMS",
    short: "Update",
    description: "Core, estensioni, plugin e template non aggiornati.",
    actionHint: "Backup, poi aggiorna in ambiente controllato.",
  },
  {
    id: "hardening",
    order: 4,
    label: "Hardening",
    short: "Config",
    description: "SSL, debug, flag di sicurezza e configurazione.",
    actionHint: "Chiudi le superfici di attacco residue.",
  },
  {
    id: "content",
    order: 5,
    label: "Contenuti & URL",
    short: "URL",
    description: "Link rotti e integrità dei contenuti pubblici.",
    actionHint: "Correggi menu, moduli e pagine dopo la sicurezza.",
  },
  {
    id: "other",
    order: 6,
    label: "Altro",
    short: "Altro",
    description: "Finding non classificati nel flusso principale.",
    actionHint: "Valuta caso per caso.",
  },
];

export function groupIdForFinding(finding: {
  type: string;
  title?: string;
  severity?: string;
}): RemediationGroupId {
  const type = finding.type;
  const title = finding.title ?? "";

  if (
    type === "malware" ||
    type === "suspicious_user" ||
    type === "settings_hijack"
  ) {
    // Finding informativi “tutto ok” non sono compromissione
    if (
      finding.severity === "info" &&
      /nessun segnale|nessun problema/i.test(title)
    ) {
      return "other";
    }
    return "compromise";
  }

  if (type === "vulnerability") return "runtime";

  if (
    type === "update_core" ||
    type === "update_plugin" ||
    type === "update_theme"
  ) {
    return "updates";
  }

  if (type === "config") {
    if (/ssl|https|certificat/i.test(title)) return "hardening";
    return "hardening";
  }

  if (type === "broken_link") return "content";

  return "other";
}

export function severityRank(severity: string): number {
  const order = ["critical", "high", "medium", "low", "info"];
  const i = order.indexOf(severity);
  return i === -1 ? 99 : i;
}
