import net from "net";
import type { CmsType, SftpCredentials } from "../types";
import { connectFtp } from "./ftp-client";
import type { RemoteFsClient } from "./remote-fs";
import { connectSftp } from "./sftp-compat";

/** Porte SFTP tipiche (hosting / Plesk / custom) */
export const SFTP_PORT_CANDIDATES = [
  22, 2222, 2200, 22222, 22022, 8022, 222, 220, 10022, 2022,
] as const;

/** Porte FTP / FTPS tipiche */
export const FTP_PORT_CANDIDATES = [
  21, 2121, 990, 989, 8021, 21234, 20021,
] as const;

export const ROOT_CANDIDATES = [
  ".",
  "httpdocs",
  "public_html",
  "www",
  "web",
  "htdocs",
  "public",
  "httpdocs/public",
  "domains",
] as const;

export type DiscoveredCms = CmsType | "unknown";
export type TransferProtocol = "sftp" | "ftp" | "ftps";

export type SftpDiscoveryResult = {
  protocol: TransferProtocol;
  port: number;
  rootPath: string;
  cms: DiscoveredCms;
  score: number;
  triedPorts: number[];
  attempts: string[];
  homeListing?: string[];
};

type SoftCreds = {
  host: string;
  username: string;
  password?: string;
  privateKey?: string;
  port?: number;
  rootPath?: string;
  protocol?: TransferProtocol;
};

type Attempt =
  | { kind: "sftp"; port: number }
  | { kind: "ftp"; port: number; secure: false | true | "implicit" };

function uniqueNums(
  preferred: number | undefined,
  pool: readonly number[],
): number[] {
  const out: number[] = [];
  const push = (p?: number) => {
    if (!p || !Number.isFinite(p) || p <= 0) return;
    if (!out.includes(p)) out.push(p);
  };
  push(preferred);
  for (const p of pool) push(p);
  return out;
}

function uniqueRoots(preferred?: string): string[] {
  const raw = (preferred ?? "").trim().replace(/\/+$/, "");
  const out: string[] = [];
  const push = (p: string) => {
    const v = p.trim().replace(/\/+$/, "") || ".";
    if (!out.includes(v)) out.push(v);
  };
  if (raw) {
    push(raw);
    push(raw.replace(/^\//, ""));
  }
  for (const p of ROOT_CANDIDATES) push(p);
  return out;
}

/** Probe TCP rapido: scarta porte chiuse prima dell'handshake. */
function probeTcp(
  host: string,
  port: number,
  timeoutMs = 2500,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function filterOpenPorts(
  host: string,
  ports: number[],
): Promise<{ open: number[]; closed: number[] }> {
  const open: number[] = [];
  const closed: number[] = [];
  // Parallelismo moderato
  const chunk = 6;
  for (let i = 0; i < ports.length; i += chunk) {
    const slice = ports.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map(async (port) => ({ port, ok: await probeTcp(host, port) })),
    );
    for (const r of results) {
      if (r.ok) open.push(r.port);
      else closed.push(r.port);
    }
  }
  return { open, closed };
}

function scoreCmsMarkers(names: Set<string>): {
  score: number;
  cms: DiscoveredCms;
} {
  let wp = 0;
  let joomla = 0;

  if (names.has("wp-config.php")) wp += 6;
  if (names.has("wp-includes")) wp += 4;
  if (names.has("wp-content")) wp += 3;
  if (names.has("wp-admin")) wp += 2;
  if (names.has("wp-login.php")) wp += 2;

  if (names.has("configuration.php")) joomla += 6;
  if (names.has("libraries")) joomla += 3;
  if (names.has("administrator")) joomla += 3;
  if (names.has("components")) joomla += 2;
  if (names.has("modules")) joomla += 1;
  if (names.has("templates")) joomla += 1;

  if (wp === 0 && joomla === 0) return { score: 0, cms: "unknown" };
  if (wp >= joomla) return { score: wp, cms: "wordpress" };
  return { score: joomla, cms: "joomla" };
}

async function probeRoots(
  client: RemoteFsClient,
  preferredRoot?: string,
): Promise<{
  rootPath: string;
  cms: DiscoveredCms;
  score: number;
  homeListing: string[];
}> {
  let homeListing: string[] = [];
  try {
    const home = await client.list(".");
    homeListing = home.map((e) => e.name).slice(0, 40);
  } catch {
    homeListing = [];
  }

  const dynamicRoots: string[] = [];
  for (const name of homeListing) {
    if (/^httpdocs$|^public_html$|^www$|^web$|^htdocs$/i.test(name)) {
      dynamicRoots.push(name);
    }
  }

  const roots = uniqueRoots(preferredRoot);
  for (const r of dynamicRoots) {
    if (!roots.includes(r)) roots.unshift(r);
  }

  let best: { rootPath: string; cms: DiscoveredCms; score: number } | null =
    null;
  let fallback: string | null = null;

  for (const path of roots) {
    try {
      const list = await client.list(path);
      if (!list || list.length === 0) continue;
      const names = new Set(list.map((e) => e.name));
      const { score: rawScore, cms } = scoreCmsMarkers(names);
      // Evita backup/OLD come docroot se esiste una cartella "viva"
      const score = /(?:^|\/|-)(old|bak|backup|copy|deprecated)(?:\/|$)/i.test(
        path,
      )
        ? Math.max(0, rawScore - 5)
        : rawScore;
      if (!fallback) fallback = path;
      if (score > (best?.score ?? 0)) best = { rootPath: path, cms, score };
      // Non stoppare troppo presto su path "OLD": continua a cercare httpdocs vivo
      if (score >= 6 && !/(?:^|\/|-)(old|bak|backup)/i.test(path)) break;

      // Un livello più in profondità (FTP home ≠ docroot)
      if (score < 6 || /(?:^|\/|-)(old|bak|backup)/i.test(path)) {
        for (const child of list
          .filter((e) => e.type === "d" || e.type === "l" || !/\.[a-z0-9]{1,8}$/i.test(e.name))
          .filter((e) => !e.name.startsWith("."))
          .slice(0, 15)) {
          const childPath =
            path === "." ? child.name : `${path}/${child.name}`;
          try {
            const childList = await client.list(childPath);
            const childNames = new Set(childList.map((e) => e.name));
            const childScore = scoreCmsMarkers(childNames);
            let childPts = childScore.score;
            if (/(?:^|\/|-)(old|bak|backup|copy|deprecated)(?:\/|$)/i.test(childPath)) {
              childPts = Math.max(0, childPts - 5);
            }
            if (childPts > (best?.score ?? 0)) {
              best = {
                rootPath: childPath,
                cms: childScore.cms,
                score: childPts,
              };
            }
            if (childPts >= 6 && !/(?:^|\/|-)(old|bak|backup)/i.test(childPath))
              break;
          } catch {
            /* next child */
          }
        }
        if (
          (best?.score ?? 0) >= 6 &&
          best &&
          !/(?:^|\/|-)(old|bak|backup)/i.test(best.rootPath)
        )
          break;
      }
    } catch {
      /* next */
    }
  }

  if ((!best || best.score < 3) && homeListing.includes("domains")) {
    try {
      const domains = await client.list("domains");
      for (const d of domains.filter((e) => e.type === "d").slice(0, 12)) {
        for (const leaf of ["httpdocs", "public_html", "www"]) {
          const path = `domains/${d.name}/${leaf}`;
          try {
            const list = await client.list(path);
            const names = new Set(list.map((e) => e.name));
            const { score, cms } = scoreCmsMarkers(names);
            if (score > (best?.score ?? 0)) {
              best = { rootPath: path, cms, score };
            }
          } catch {
            /* next */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (best) return { ...best, homeListing };

  // Preferisci "." (spesso = httpdocs in chroot FTP) invece di "httpdocs" vuoto
  return {
    rootPath: fallback ?? (preferredRoot?.replace(/\/+$/, "") || "."),
    cms: "unknown",
    score: 0,
    homeListing,
  };
}

function buildAttempts(creds: SoftCreds, openPorts: number[]): Attempt[] {
  const open = new Set(openPorts);
  const attempts: Attempt[] = [];
  const seen = new Set<string>();

  const add = (a: Attempt) => {
    const key =
      a.kind === "sftp"
        ? `sftp:${a.port}`
        : `ftp:${a.port}:${a.secure === false ? "plain" : a.secure === true ? "explicit" : "implicit"}`;
    if (seen.has(key)) return;
    if (!open.has(a.port)) return;
    seen.add(key);
    attempts.push(a);
  };

  // Preferenza salvata
  if (creds.port && open.has(creds.port)) {
    if (creds.protocol === "ftp") {
      add({ kind: "ftp", port: creds.port, secure: false });
      add({ kind: "ftp", port: creds.port, secure: true });
    } else if (creds.protocol === "ftps") {
      add({
        kind: "ftp",
        port: creds.port,
        secure: creds.port === 990 || creds.port === 989 ? "implicit" : true,
      });
      add({ kind: "ftp", port: creds.port, secure: false });
    } else {
      add({ kind: "sftp", port: creds.port });
    }
  }

  for (const port of uniqueNums(creds.port, SFTP_PORT_CANDIDATES)) {
    add({ kind: "sftp", port });
  }

  for (const port of uniqueNums(
    creds.protocol === "ftp" || creds.protocol === "ftps"
      ? creds.port
      : undefined,
    FTP_PORT_CANDIDATES,
  )) {
    // Ordine: plain → FTPS esplicito → FTPS implicito (soprattutto 990/989)
    add({ kind: "ftp", port, secure: false });
    add({ kind: "ftp", port, secure: true });
    if (port === 990 || port === 989 || port === 21) {
      add({ kind: "ftp", port, secure: "implicit" });
    }
  }

  return attempts;
}

/**
 * Prova tutte le connessioni plausibili: SFTP, FTP, FTPS (esplicito/implicito)
 * su porte aperte. Individua docroot e CMS.
 */
export async function discoverSftp(
  creds: SoftCreds,
): Promise<SftpDiscoveryResult> {
  if (!creds.password && !creds.privateKey) {
    throw new Error("Trasferimento file: manca password o chiave privata");
  }

  const allPorts = uniqueNums(creds.port, [
    ...SFTP_PORT_CANDIDATES,
    ...FTP_PORT_CANDIDATES,
  ]);

  const { open, closed } = await filterOpenPorts(creds.host, allPorts);
  const triedPorts = [...open, ...closed];
  const attemptsLog: string[] = [];

  if (open.length === 0) {
    throw new Error(
      `Nessuna porta aperta su ${creds.host} (provate ${allPorts.join(", ")}). Controlla firewall/hosting.`,
    );
  }

  const attempts = buildAttempts(creds, open);
  const errors: string[] = [];

  for (const attempt of attempts) {
    // FTP richiede password
    if (attempt.kind === "ftp" && !creds.password) {
      attemptsLog.push(`skip ftp:${attempt.port} (serve password)`);
      continue;
    }

    let client: RemoteFsClient | null = null;
    const label =
      attempt.kind === "sftp"
        ? `sftp:${attempt.port}`
        : `ftp:${attempt.port}:${attempt.secure === false ? "plain" : attempt.secure === true ? "tls" : "implicit"}`;

    try {
      if (attempt.kind === "sftp") {
        client = await connectSftp({
          host: creds.host,
          port: attempt.port,
          username: creds.username,
          password: creds.password,
          privateKey: creds.privateKey,
          timeoutMs: 10_000,
        });
      } else {
        client = await connectFtp({
          host: creds.host,
          port: attempt.port,
          username: creds.username,
          password: creds.password!,
          secure: attempt.secure,
          timeoutMs: 12_000,
        });
      }

      const probed = await probeRoots(client, creds.rootPath);
      const protocol: TransferProtocol =
        attempt.kind === "sftp"
          ? "sftp"
          : attempt.secure === false
            ? "ftp"
            : "ftps";

      attemptsLog.push(`${label} OK`);
      return {
        protocol,
        port: attempt.port,
        rootPath: probed.rootPath,
        cms: probed.cms,
        score: probed.score,
        triedPorts,
        attempts: attemptsLog,
        homeListing: probed.homeListing,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attemptsLog.push(`${label} fail`);
      errors.push(`${label} ${msg}`);
    } finally {
      if (client) await client.end().catch(() => undefined);
    }
  }

  throw new Error(
    `Nessuna connessione riuscita su ${creds.host}. Porte aperte: ${open.join(", ") || "—"}. ${errors.slice(-4).join(" · ")}`,
  );
}

export function applyDiscovery(
  creds: SoftCreds,
  discovery: SftpDiscoveryResult,
): SftpCredentials {
  return {
    host: creds.host,
    username: creds.username,
    password: creds.password,
    privateKey:
      discovery.protocol === "sftp" ? creds.privateKey : undefined,
    port: discovery.port,
    rootPath: discovery.rootPath,
    protocol: discovery.protocol,
  };
}
