import SftpClient from "ssh2-sftp-client";
import type { SftpCredentials } from "../types";

export async function withSftp<T>(
  creds: SftpCredentials,
  fn: (client: SftpClient, root: string) => Promise<T>,
): Promise<T> {
  if (!creds.password && !creds.privateKey) {
    throw new Error("SFTP: manca password o chiave privata");
  }

  const client = new SftpClient();
  try {
    await client.connect({
      host: creds.host,
      port: creds.port ?? 22,
      username: creds.username,
      password: creds.password,
      privateKey: creds.privateKey,
      readyTimeout: 20_000,
      // Preferisci algoritmi moderni; niente log di secret
      algorithms: {
        serverHostKey: [
          "ssh-ed25519",
          "ecdsa-sha2-nistp256",
          "rsa-sha2-512",
          "rsa-sha2-256",
          "ssh-rsa",
        ],
      },
    });
    const root = await resolveRootPath(client, creds.rootPath);
    return await fn(client, root);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Su hosting Plesk/shared `/httpdocs` assoluto spesso è vuoto;
 * la docroot reale è relativa alla home: `httpdocs`.
 */
async function resolveRootPath(
  client: SftpClient,
  raw: string,
): Promise<string> {
  const candidates = [
    raw.replace(/\/$/, "") || ".",
    raw.replace(/^\//, "").replace(/\/$/, "") || ".",
    "httpdocs",
    "public_html",
    "www",
    "web",
    ".",
  ];
  // dedupe
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  for (const path of unique) {
    try {
      const list = await client.list(path);
      if (!list || list.length === 0) continue;
      const names = new Set(list.map((e) => e.name));
      const score =
        (names.has("configuration.php") || names.has("wp-config.php") ? 5 : 0) +
        (names.has("libraries") || names.has("wp-includes") ? 3 : 0) +
        (names.has("administrator") || names.has("wp-content") ? 2 : 0) +
        (names.has("components") || names.has("wp-admin") ? 1 : 0);
      if (score >= 3) return path;
      // almeno non vuota: tieni come fallback
      if (score >= 1) return path;
    } catch {
      /* try next */
    }
  }

  return raw.replace(/\/$/, "") || ".";
}

export async function readTextFile(
  client: SftpClient,
  path: string,
): Promise<string> {
  const buf = (await client.get(path)) as Buffer;
  return buf.toString("utf8");
}

export async function listRecursive(
  client: SftpClient,
  dir: string,
  maxFiles = 2000,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string) {
    if (out.length >= maxFiles) return;
    const entries = await client.list(current);
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const full = `${current}/${entry.name}`.replace(/\/+/g, "/");
      if (entry.type === "d") {
        if ([".", "..", "node_modules", ".git", "cache"].includes(entry.name)) {
          continue;
        }
        await walk(full);
      } else {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out;
}
