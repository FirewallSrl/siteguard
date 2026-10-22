import type { SftpCredentials } from "../types";
import { discoverSftp } from "./discover";
import { connectFtp } from "./ftp-client";
import type { RemoteFsClient } from "./remote-fs";
import { connectSftp } from "./sftp-compat";

export type { RemoteFsClient } from "./remote-fs";

export async function withSftp<T>(
  creds: SftpCredentials,
  fn: (client: RemoteFsClient, root: string) => Promise<T>,
): Promise<T> {
  if (!creds.password && !creds.privateKey) {
    throw new Error("Trasferimento file: manca password o chiave privata");
  }

  // Rediscovery solo se manca protocollo/porta, o root sospetta.
  // Con root "." NON forzare rediscovery: su molti hosting (Plesk) la home FTP
  // è già httpdocs chroot — riscoprire può cadere sul fallback "httpdocs" vuoto.
  let effective = creds;
  const needsDiscovery =
    !creds.protocol ||
    !creds.port ||
    !creds.rootPath ||
    creds.rootPath === "/" ||
    creds.rootPath === "";

  if (needsDiscovery) {
    const discovery = await discoverSftp(creds);
    effective = {
      ...creds,
      protocol: discovery.protocol,
      port: discovery.port,
      rootPath: discovery.rootPath,
    };
  }

  const protocol = effective.protocol ?? "sftp";
  const client =
    protocol === "ftp" || protocol === "ftps"
      ? await connectFtp({
          host: effective.host,
          port: effective.port ?? (protocol === "ftps" ? 990 : 21),
          username: effective.username,
          password: effective.password!,
          secure:
            protocol === "ftps"
              ? effective.port === 990 || effective.port === 989
                ? "implicit"
                : true
              : false,
          timeoutMs: 25_000,
        })
      : await connectSftp({
          host: effective.host,
          port: effective.port ?? 22,
          username: effective.username,
          password: effective.password,
          privateKey: effective.privateKey,
          timeoutMs: 25_000,
        });

  try {
    const root = await ensureReadableRoot(client, effective.rootPath ?? ".");
    return await fn(client, root);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** True se la listing sembra una docroot CMS (WP/Joomla). */
function looksLikeCmsDocroot(names: string[]): boolean {
  const set = new Set(names);
  return (
    set.has("configuration.php") ||
    set.has("wp-config.php") ||
    (set.has("libraries") && set.has("administrator")) ||
    (set.has("wp-includes") && set.has("wp-content"))
  );
}

async function ensureReadableRoot(
  client: RemoteFsClient,
  raw: string,
): Promise<string> {
  const preferred = raw.replace(/\/$/, "") || ".";

  // Su Plesk/chroot la home FTP è già httpdocs: la sottocartella "httpdocs" non esiste.
  const candidates = [
    preferred,
    preferred.replace(/^\//, ""),
    ".",
    "httpdocs",
    "public_html",
    "www",
    "web",
    "public",
    "htdocs",
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  let fallbackReadable: string | null = null;

  for (const path of candidates) {
    try {
      const list = await client.list(path);
      if (!list?.length) continue;
      if (!fallbackReadable) fallbackReadable = path;
      if (looksLikeCmsDocroot(list.map((e) => e.name))) {
        return path;
      }
    } catch {
      /* next */
    }
  }

  // Se preferred era httpdocs ma vuoto/inesistente, e "." è leggibile → usa "."
  if (
    /^(httpdocs|public_html|www|web|htdocs)$/i.test(preferred) &&
    fallbackReadable
  ) {
    return fallbackReadable;
  }

  return fallbackReadable ?? preferred;
}

export async function readTextFile(
  client: RemoteFsClient,
  path: string,
): Promise<string> {
  const buf = await client.get(path);
  return buf.toString("utf8");
}

export type RemoteFileEntry = {
  path: string;
  size?: number;
  /** Epoch ms — mtime sul server */
  modifyTime?: number;
};

export async function listRecursive(
  client: RemoteFsClient,
  dir: string,
  maxFiles = 2000,
): Promise<RemoteFileEntry[]> {
  const { isDirEntry } = await import("./paths");
  const out: RemoteFileEntry[] = [];

  async function walk(current: string) {
    if (out.length >= maxFiles) return;
    let entries: Awaited<ReturnType<RemoteFsClient["list"]>> = [];
    try {
      entries = await client.list(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const full = `${current}/${entry.name}`.replace(/\/+/g, "/");
      if (isDirEntry(entry)) {
        if (
          [".", "..", "node_modules", ".git", "cache", "tmp"].includes(
            entry.name,
          )
        ) {
          continue;
        }
        // FTP ambiguo: se list fallisce non è una cartella
        try {
          await client.list(full);
          await walk(full);
        } catch {
          out.push({
            path: full,
            size: entry.size,
            modifyTime: entry.modifyTime,
          });
        }
      } else {
        out.push({
          path: full,
          size: entry.size,
          modifyTime: entry.modifyTime,
        });
      }
    }
  }

  await walk(dir);
  return out;
}

export function modifyTimeToIso(ms?: number): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString();
}
