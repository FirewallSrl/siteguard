export type CmsType = "wordpress" | "joomla";
export type SiteStatus = "pending" | "connected" | "error";
export type ScanStatus = "queued" | "running" | "completed" | "failed";

export type FindingType =
  | "update_core"
  | "update_plugin"
  | "update_theme"
  | "malware"
  | "suspicious_user"
  | "settings_hijack"
  | "vulnerability"
  | "broken_link"
  | "config";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "resolved" | "ignored";
export type ActionMode = "ai" | "manual";
export type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "running"
  | "completed"
  | "failed";

export type SftpCredentials = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  /** Path assoluto alla root del sito (es. /public_html) */
  rootPath: string;
};

export type ApiCredentials = {
  username: string;
  /** Application Password (WP) o API token (Joomla) */
  appPassword: string;
};

export type SiteSecrets = {
  sftp?: SftpCredentials;
  api?: ApiCredentials;
};

export type ProposedPlan = {
  summary: string;
  steps: string[];
  risk: Severity;
  requiresBackup: boolean;
};
