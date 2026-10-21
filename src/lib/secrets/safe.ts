import type { ApiCredentials, SiteSecrets, SftpCredentials } from "../types";

/** Metadati sicuri da esporre al browser — mai password/chiavi */
export type SecretsMeta = {
  hasSftp: boolean;
  hasApi: boolean;
  sftp: {
    host: string;
    port: number;
    username: string;
    rootPath: string;
    auth: "password" | "key" | "none";
  } | null;
  api: {
    username: string;
  } | null;
};

export function toSecretsMeta(secrets: SiteSecrets | null): SecretsMeta {
  if (!secrets) {
    return { hasSftp: false, hasApi: false, sftp: null, api: null };
  }

  const sftp = secrets.sftp
    ? {
        host: secrets.sftp.host,
        port: secrets.sftp.port ?? 22,
        username: secrets.sftp.username,
        rootPath: secrets.sftp.rootPath,
        auth: secrets.sftp.privateKey
          ? ("key" as const)
          : secrets.sftp.password
            ? ("password" as const)
            : ("none" as const),
      }
    : null;

  const api = secrets.api
    ? { username: secrets.api.username }
    : null;

  return {
    hasSftp: Boolean(secrets.sftp),
    hasApi: Boolean(secrets.api),
    sftp,
    api,
  };
}

/** Messaggi di errore senza host interni/path sensibili eccessivi */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/password[=:].*/gi, "[redacted]")
    .replace(/private[_-]?key[=:].*/gi, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

type SftpPatch = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  rootPath?: string;
  /** true = rimuovi del tutto il canale SFTP */
  clear?: boolean;
};

type ApiPatch = {
  username?: string;
  appPassword?: string;
  clear?: boolean;
};

/**
 * Unisce patch con secret esistenti.
 * Password/chiave vuote = mantieni il valore già salvato.
 */
export function mergeSecrets(
  current: SiteSecrets | null,
  patch: { sftp?: SftpPatch; api?: ApiPatch },
): SiteSecrets {
  const next: SiteSecrets = { ...(current ?? {}) };

  if (patch.sftp?.clear) {
    delete next.sftp;
  } else if (patch.sftp) {
    const prev = current?.sftp;
    const host = (patch.sftp.host ?? prev?.host ?? "").trim();
    const username = (patch.sftp.username ?? prev?.username ?? "").trim();
    const rootPath = (patch.sftp.rootPath ?? prev?.rootPath ?? "/public_html").trim();
    const port = patch.sftp.port ?? prev?.port ?? 22;

    const password =
      patch.sftp.password && patch.sftp.password.length > 0
        ? patch.sftp.password
        : prev?.password;
    const privateKey =
      patch.sftp.privateKey && patch.sftp.privateKey.length > 0
        ? patch.sftp.privateKey
        : prev?.privateKey;

    if (!host || !username) {
      throw new Error("SFTP: host e username obbligatori");
    }

    const sftp: SftpCredentials = {
      host,
      port,
      username,
      rootPath,
      password,
      privateKey,
    };
    next.sftp = sftp;
  }

  if (patch.api?.clear) {
    delete next.api;
  } else if (patch.api) {
    const prev = current?.api;
    const username = (patch.api.username ?? prev?.username ?? "").trim();
    const appPassword =
      patch.api.appPassword && patch.api.appPassword.length > 0
        ? patch.api.appPassword
        : prev?.appPassword;

    if (!username || !appPassword) {
      throw new Error("API: username e password/token obbligatori");
    }

    const api: ApiCredentials = { username, appPassword };
    next.api = api;
  }

  return next;
}
