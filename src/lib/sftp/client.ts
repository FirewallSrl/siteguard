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

  let effective = creds;
  if (
    !creds.protocol ||
    !creds.rootPath ||
    creds.rootPath === "." ||
    creds.rootPath === "/"
  ) {
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
          timeoutMs: 20_000,
        })
      : await connectSftp({
          host: effective.host,
          port: effective.port ?? 22,
          username: effective.username,
          password: effective.password,
          privateKey: effective.privateKey,
          timeoutMs: 20_000,
        });

  try {
    const root = await ensureReadableRoot(client, effective.rootPath);
    return await fn(client, root);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureReadableRoot(
  client: RemoteFsClient,
  raw: string,
): Promise<string> {
  const preferred = raw.replace(/\/$/, "") || ".";
  try {
    const list = await client.list(preferred);
    if (Array.isArray(list)) return preferred;
  } catch {
    /* fall through */
  }

  for (const path of [
    preferred.replace(/^\//, ""),
    "httpdocs",
    "public_html",
    "www",
    "web",
    ".",
  ]) {
    try {
      const list = await client.list(path);
      if (list?.length) return path;
    } catch {
      /* next */
    }
  }
  return preferred;
}

export async function readTextFile(
  client: RemoteFsClient,
  path: string,
): Promise<string> {
  const buf = await client.get(path);
  return buf.toString("utf8");
}

export async function listRecursive(
  client: RemoteFsClient,
  dir: string,
  maxFiles = 2000,
): Promise<string[]> {
  const { isDirEntry } = await import("./paths");
  const out: string[] = [];

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
          out.push(full);
        }
      } else {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out;
}
