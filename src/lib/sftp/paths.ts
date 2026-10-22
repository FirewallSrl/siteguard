import type { RemoteFsClient, RemoteListEntry } from "./remote-fs";

/** True se la entry è (o sembra) una cartella — FTP LIST spesso marca le dir come file. */
export function isDirEntry(entry: RemoteListEntry): boolean {
  if (entry.type === "d" || entry.type === "l") return true;
  if (entry.name === "." || entry.name === "..") return false;
  // Senza estensione tipica di file → probabile cartella su FTP ambiguo
  if (!/\.[a-z0-9]{1,8}$/i.test(entry.name)) return true;
  return false;
}

/** Prova a listare: se riesce, è una cartella utilizzabile. */
export async function canListDir(
  client: RemoteFsClient,
  path: string,
): Promise<boolean> {
  try {
    const list = await client.list(path);
    return Array.isArray(list);
  } catch {
    return false;
  }
}

export async function fileExists(
  client: RemoteFsClient,
  path: string,
): Promise<boolean> {
  try {
    await client.stat(path);
    return true;
  } catch {
    try {
      await client.get(path);
      return true;
    } catch {
      return false;
    }
  }
}

export async function listEntries(
  client: RemoteFsClient,
  path: string,
): Promise<RemoteListEntry[]> {
  try {
    return await client.list(path);
  } catch {
    return [];
  }
}

const JOOMLA_MARKERS = [
  "configuration.php",
  "libraries",
  "administrator",
  "components",
  "templates",
  "modules",
  "plugins",
] as const;

const WP_MARKERS = [
  "wp-config.php",
  "wp-includes",
  "wp-content",
  "wp-admin",
] as const;

export function scoreJoomlaNames(names: Set<string>): number {
  let score = 0;
  if (names.has("configuration.php")) score += 6;
  if (names.has("libraries")) score += 3;
  if (names.has("administrator")) score += 3;
  if (names.has("components")) score += 2;
  if (names.has("modules")) score += 1;
  if (names.has("templates")) score += 1;
  if (names.has("plugins")) score += 1;
  if (names.has("includes")) score += 1;
  return score;
}

export function scoreWordpressNames(names: Set<string>): number {
  let score = 0;
  if (names.has("wp-config.php")) score += 6;
  if (names.has("wp-includes")) score += 4;
  if (names.has("wp-content")) score += 3;
  if (names.has("wp-admin")) score += 2;
  if (names.has("wp-login.php")) score += 2;
  return score;
}

/**
 * Cerca la docroot Joomla partendo da base, con BFS su sottocartelle comuni
 * e fino a depth 3 (hosting Plesk/cPanel/custom).
 */
export async function findJoomlaRoot(
  client: RemoteFsClient,
  startRoot: string,
): Promise<{ root: string; score: number; tried: string[] } | null> {
  const start = (startRoot || ".").replace(/\/$/, "") || ".";
  const tried: string[] = [];
  // Se partiamo da httpdocs e siamo già in chroot, prova subito anche "."
  const seeds = uniqueSeedPaths(start);
  const queue: Array<{ path: string; depth: number }> = seeds.map((path) => ({
    path,
    depth: 0,
  }));
  const seen = new Set<string>();
  let best: { root: string; score: number } | null = null;

  const preferredChild =
    /^(httpdocs|public_html|www|web|htdocs|public|joomla|site|cms|html)$/i;

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    const key = path || ".";
    if (seen.has(key)) continue;
    seen.add(key);
    tried.push(key);
    if (tried.length > 80) break;

    const entries = await listEntries(client, path);
    if (entries.length === 0 && path !== start) continue;

    const names = new Set(entries.map((e) => e.name));
    let score = scoreJoomlaNames(names);

    // Conferma forte: configuration.php leggibile
    if (names.has("configuration.php")) {
      if (await fileExists(client, joinPath(path, "configuration.php"))) {
        score = Math.max(score, 8);
      }
    }
    // libraries/src/Version.php tipico J4/J5
    if (
      score >= 3 &&
      (await fileExists(
        client,
        joinPath(path, "libraries/src/Version.php"),
      ))
    ) {
      score += 3;
    }

    if (score > (best?.score ?? 0)) {
      best = { root: path, score };
    }
    if (score >= 9) break;

    if (depth >= 3) continue;

    // Se siamo dentro administrator, risali al parent
    if (names.has("configuration.php") === false && path.endsWith("/administrator")) {
      const parent = path.replace(/\/administrator$/, "") || ".";
      queue.push({ path: parent, depth: depth + 1 });
    }

    const children = entries
      .filter((e) => isDirEntry(e) && !e.name.startsWith("."))
      .filter(
        (e) =>
          ![
            "node_modules",
            ".git",
            "cache",
            "tmp",
            "logs",
            "log",
            "vendor",
            "node",
            "cgi-bin",
          ].includes(e.name.toLowerCase()),
      )
      .sort((a, b) => {
        const ap = preferredChild.test(a.name) ? 0 : 1;
        const bp = preferredChild.test(b.name) ? 0 : 1;
        return ap - bp || a.name.localeCompare(b.name);
      });

    for (const child of children.slice(0, depth === 0 ? 20 : 12)) {
      const next = joinPath(path, child.name);
      // Verifica che sia listabile (FTP ambiguo)
      if (!(await canListDir(client, next))) continue;
      queue.push({ path: next, depth: depth + 1 });
    }

    // Layout Plesk: domains/<domain>/httpdocs
    if (names.has("domains") && depth === 0) {
      const domains = await listEntries(client, joinPath(path, "domains"));
      for (const d of domains.filter((e) => isDirEntry(e)).slice(0, 15)) {
        for (const leaf of ["httpdocs", "public_html", "www", "web"]) {
          queue.push({
            path: joinPath(path, `domains/${d.name}/${leaf}`),
            depth: depth + 2,
          });
        }
      }
    }
  }

  if (!best || best.score < 3) return null;
  return { root: best.root, score: best.score, tried };
}

function uniqueSeedPaths(start: string): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    const v = (p || ".").replace(/\/$/, "") || ".";
    if (!out.includes(v)) out.push(v);
  };
  push(start);
  push(".");
  // httpdocs richiesto dall'operatore ma spesso = home chroot
  if (/^(httpdocs|public_html|www|web|htdocs)$/i.test(start)) {
    push(".");
  } else {
    push(joinPath(start, "httpdocs"));
    push("httpdocs");
  }
  return out;
}

export async function findWordpressRoot(
  client: RemoteFsClient,
  startRoot: string,
): Promise<{ root: string; score: number; tried: string[] } | null> {
  const start = (startRoot || ".").replace(/\/$/, "") || ".";
  const tried: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: start, depth: 0 }];
  const seen = new Set<string>();
  let best: { root: string; score: number } | null = null;
  const preferredChild =
    /^(httpdocs|public_html|www|web|htdocs|public|wordpress|wp)$/i;

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    const key = path || ".";
    if (seen.has(key)) continue;
    seen.add(key);
    tried.push(key);
    if (tried.length > 80) break;

    const entries = await listEntries(client, path);
    if (entries.length === 0 && path !== start) continue;
    const names = new Set(entries.map((e) => e.name));
    let score = scoreWordpressNames(names);
    if (
      names.has("wp-includes") &&
      (await fileExists(client, joinPath(path, "wp-includes/version.php")))
    ) {
      score += 3;
    }
    if (score > (best?.score ?? 0)) best = { root: path, score };
    if (score >= 9) break;
    if (depth >= 3) continue;

    const children = entries
      .filter((e) => isDirEntry(e) && !e.name.startsWith("."))
      .sort((a, b) => {
        const ap = preferredChild.test(a.name) ? 0 : 1;
        const bp = preferredChild.test(b.name) ? 0 : 1;
        return ap - bp;
      });

    for (const child of children.slice(0, depth === 0 ? 20 : 12)) {
      const next = joinPath(path, child.name);
      if (!(await canListDir(client, next))) continue;
      queue.push({ path: next, depth: depth + 1 });
    }
  }

  if (!best || best.score < 3) return null;
  return { root: best.root, score: best.score, tried };
}

export function joinPath(base: string, child: string): string {
  const b = (base || ".").replace(/\/$/, "");
  const c = child.replace(/^\//, "");
  if (!b || b === ".") return c || ".";
  return `${b}/${c}`.replace(/\/+/g, "/");
}

export { JOOMLA_MARKERS, WP_MARKERS };
