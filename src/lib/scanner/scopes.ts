import type { FindingType } from "@/lib/types";

/** Ambiti di scansione oltre alla completa. */
export const SCAN_SCOPES = [
  "full",
  "ssl",
  "links",
  "php",
  "inventory",
  "updates",
  "integrity",
] as const;

export type ScanScope = (typeof SCAN_SCOPES)[number];

export type ScanModule =
  | "ssl"
  | "links"
  | "php"
  | "api"
  | "sftp"
  | "inventory"
  | "updates";

export type ScanScopeDef = {
  id: ScanScope;
  label: string;
  short: string;
  description: string;
  modules: ScanModule[];
  findingTypes: FindingType[];
  titleMatch?: RegExp;
};

export const SCAN_SCOPE_DEFS: Record<ScanScope, ScanScopeDef> = {
  full: {
    id: "full",
    label: "Scansione completa",
    short: "Completa",
    description: "SSL, link, PHP, inventario, update e integrity",
    modules: ["ssl", "links", "php", "api", "sftp", "inventory", "updates"],
    findingTypes: [],
  },
  ssl: {
    id: "ssl",
    label: "SSL / HTTPS",
    short: "SSL",
    description: "Certificato e configurazione HTTPS",
    modules: ["ssl"],
    findingTypes: ["config"],
    titleMatch: /ssl|https|certificat/i,
  },
  links: {
    id: "links",
    label: "Link rotti",
    short: "Link",
    description: "Crawl pagine e verifica URL 4xx/5xx",
    modules: ["links"],
    findingTypes: ["broken_link"],
  },
  php: {
    id: "php",
    label: "PHP / vulnerabilità",
    short: "PHP",
    description: "Versione runtime e bollettini ACN / php.net",
    modules: ["php", "sftp"],
    findingTypes: ["vulnerability"],
    titleMatch: /php/i,
  },
  inventory: {
    id: "inventory",
    label: "Inventario CMS",
    short: "Inventario",
    description: "Core, estensioni, plugin e template",
    modules: ["php", "api", "sftp", "inventory"],
    findingTypes: [],
  },
  updates: {
    id: "updates",
    label: "Aggiornamenti",
    short: "Update",
    description: "Core, componenti e runtime PHP",
    modules: ["php", "api", "sftp", "inventory", "updates"],
    findingTypes: ["update_core", "update_plugin", "update_theme", "vulnerability"],
  },
  integrity: {
    id: "integrity",
    label: "Integrity / malware",
    short: "Integrity",
    description: "File sospetti, utenti e segnali di compromissione",
    modules: ["php", "api", "sftp", "inventory"],
    findingTypes: [
      "malware",
      "suspicious_user",
      "settings_hijack",
      "vulnerability",
    ],
  },
};

export function parseScanScope(value: unknown): ScanScope {
  if (
    typeof value === "string" &&
    (SCAN_SCOPES as readonly string[]).includes(value)
  ) {
    return value as ScanScope;
  }
  return "full";
}

export function scopeHas(scope: ScanScope, module: ScanModule): boolean {
  return SCAN_SCOPE_DEFS[scope].modules.includes(module);
}

export function progressStepsForScope(scope: ScanScope) {
  const mods = new Set(SCAN_SCOPE_DEFS[scope].modules);
  const all = [
    { id: "start", label: "Avvio scansione" },
    { id: "ssl", label: "Controllo HTTPS / SSL" },
    { id: "links", label: "Analisi link del sito" },
    { id: "php", label: "Runtime PHP e advisory" },
    { id: "api", label: "Check API CMS" },
    { id: "sftp", label: "Connessione SFTP" },
    { id: "inventory", label: "Inventario estensioni" },
    { id: "updates", label: "Aggiornamenti sistema" },
    { id: "save", label: "Salvataggio finding" },
    { id: "done", label: "Completato" },
  ] as const;

  if (scope === "full") return all.map((s) => ({ ...s }));

  return all.filter(
    (s) =>
      s.id === "start" ||
      s.id === "save" ||
      s.id === "done" ||
      mods.has(s.id as ScanModule),
  );
}

export function findingMatchesScope(
  finding: { type: string; title: string },
  scope: ScanScope,
): boolean {
  if (scope === "full") return true;
  const def = SCAN_SCOPE_DEFS[scope];
  if (def.findingTypes.length === 0) return false;
  if (!def.findingTypes.includes(finding.type as FindingType)) return false;
  if (def.titleMatch && (finding.type === "config" || finding.type === "vulnerability")) {
    if (finding.type === "vulnerability" && scope === "php") return true;
    if (finding.type === "config") return def.titleMatch.test(finding.title);
  }
  return true;
}
