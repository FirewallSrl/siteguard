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
