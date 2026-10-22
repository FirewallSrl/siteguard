export type InventoryExtension = {
  name: string;
  type: string;
  version?: string;
  enabled?: boolean;
  folder?: string;
  /** URL update server (Joomla) o flag da API (WP) */
  updateUrl?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
};

export type SiteInventory = {
  collectedAt: string;
  cms: "wordpress" | "joomla" | string;
  coreVersion?: string;
  coreLatest?: string;
  coreUpdateAvailable?: boolean;
  /** Quanti elementi (core + estensioni) hanno un update disponibile */
  updatesPending?: number;
  phpVersion?: string;
  phpSource?: "header" | "sftp" | "composer" | "probe" | "unknown";
  /** Advisory PHP aperti (ACN / php.net) rispetto alla versione rilevata */
  phpAdvisories?: Array<{
    id: string;
    title: string;
    severity: string;
    cves: string[];
    fixedIn?: string;
    eol?: boolean;
    sources?: Array<{ label: string; url: string }>;
  }>;
  database?: string;
  ssl?: {
    https: boolean;
    validTo?: string;
    daysLeft?: number;
  };
  extensions: InventoryExtension[];
  themes: InventoryExtension[];
  plugins: InventoryExtension[];
  modules?: InventoryExtension[];
  users?: {
    total?: number;
    admins?: number;
  };
  /** Esito check URL / link rotti */
  brokenLinks?: {
    pagesScanned: number;
    linksChecked: number;
    brokenCount: number;
    items?: Array<{
      url: string;
      status: number | null;
      from?: string;
      error?: string | null;
    }>;
  };
  notes?: string[];
  source: Array<"sftp" | "api" | "public">;
  /** Docroot CMS effettivamente usata (può differire da rootPath salvata) */
  fsRoot?: string;
};

/** Evita note duplicate tra scan parziali (stesso testo o stessa categoria). */
export function dedupeInventoryNotes(notes: string[]): string[] {
  const categoryOf = (n: string): string | null => {
    if (/^Root Joomla /i.test(n)) return "joomla-root";
    if (/^RootPath salvata/i.test(n)) return "rootpath";
    if (/^PHP[: ]/i.test(n)) return "php";
    if (/^Versione Joomla /i.test(n)) return "joomla-version";
    if (/^Retry inventario/i.test(n)) return "retry-root";
    if (/^Nessuna estensione/i.test(n)) return "no-ext";
    if (/link|url rotto|Anti-hack|hack score/i.test(n)) return "links-hack";
    return null;
  };

  const seenExact = new Set<string>();
  const seenCat = new Set<string>();
  const out: string[] = [];

  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]?.trim();
    if (!n || seenExact.has(n)) continue;
    const cat = categoryOf(n);
    if (cat) {
      if (seenCat.has(cat)) continue;
      seenCat.add(cat);
    }
    seenExact.add(n);
    out.push(n);
  }

  return out.reverse();
}
