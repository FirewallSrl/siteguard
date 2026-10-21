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
  notes?: string[];
  source: Array<"sftp" | "api" | "public">;
};
