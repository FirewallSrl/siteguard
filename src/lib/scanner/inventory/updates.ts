import type { ScanFinding } from "../types";
import { compareSemver, isOutdated, normalizeVersion } from "../version";
import type { InventoryExtension, SiteInventory } from "./types";

/**
 * Confronta inventario con versioni pubbliche e genera finding di update.
 * - Joomla core: downloads.joomla.org (branch corrente)
 * - Estensioni Joomla: update server dichiarati nel manifest XML
 * - WordPress: usa già latestVersion da API; controlla solo il core se manca
 */
export async function enrichInventoryUpdates(
  inv: SiteInventory,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const cms = (inv.cms || "").toLowerCase();

  if (cms.includes("joomla")) {
    findings.push(...(await checkJoomlaCore(inv)));
    findings.push(...(await checkExtensionUpdateServers(inv)));
  } else if (cms.includes("wordpress") || cms === "wp") {
    findings.push(...(await checkWordpressCore(inv)));
    markWordpressApiUpdates(inv);
  }

  inv.updatesPending = countPending(inv);
  return findings;
}

async function checkJoomlaCore(inv: SiteInventory): Promise<ScanFinding[]> {
  if (!inv.coreVersion) return [];
  const result = await fetchLatestJoomlaBranch(inv.coreVersion);
  if (!result) {
    inv.notes?.push("Impossibile verificare aggiornamenti core Joomla");
    return [];
  }
  const { latest, source } = result;
  inv.coreLatest = latest;
  if (!isOutdated(inv.coreVersion, latest)) {
    inv.notes?.push(
      `Core Joomla aggiornato (${inv.coreVersion}) · via ${source}`,
    );
    return [];
  }

  inv.coreUpdateAvailable = true;
  inv.notes?.push(
    `Core Joomla ${inv.coreVersion} → ${latest} disponibile · via ${source}`,
  );
  return [
    {
      type: "update_core",
      severity: "high",
      title: `Aggiornamento sistema Joomla: ${inv.coreVersion} → ${latest}`,
      description: `Il core Joomla installato (${inv.coreVersion}) non è all'ultima release stabile del branch ${normalizeVersion(inv.coreVersion).split(".")[0]}.x (${latest}). Fonte: ${source}.`,
      evidence: {
        cms: "joomla",
        current: inv.coreVersion,
        latest,
        source,
        kind: "core",
      },
      proposedPlan: {
        summary: `Aggiornare Joomla a ${latest}`,
        steps: [
          "Backup completo (file + DB)",
          "System → Update → Installa",
          "Verificare estensioni e template dopo l'upgrade",
        ],
        risk: "high",
        requiresBackup: true,
      },
    },
  ];
}

async function checkWordpressCore(inv: SiteInventory): Promise<ScanFinding[]> {
  if (!inv.coreVersion) return [];
  const latest = await fetchLatestWpCore().catch(() => null);
  if (!latest) {
    inv.notes?.push("Impossibile verificare aggiornamenti core WordPress");
    return [];
  }
  inv.coreLatest = latest;
  if (!isOutdated(inv.coreVersion, latest)) {
    inv.notes?.push(`Core WordPress aggiornato (${inv.coreVersion})`);
    return [];
  }

  inv.coreUpdateAvailable = true;
  return [
    {
      type: "update_core",
      severity: "high",
      title: `Aggiornamento sistema WordPress: ${inv.coreVersion} → ${latest}`,
      description: `Il core WordPress installato (${inv.coreVersion}) non è all'ultima release stabile (${latest}).`,
      evidence: {
        cms: "wordpress",
        current: inv.coreVersion,
        latest,
        kind: "core",
      },
      proposedPlan: {
        summary: `Aggiornare WordPress a ${latest}`,
        steps: [
          "Backup completo",
          "Dashboard → Aggiornamenti (o WP-CLI)",
          "Verificare tema e plugin dopo l'upgrade",
        ],
        risk: "high",
        requiresBackup: true,
      },
    },
  ];
}

function markWordpressApiUpdates(inv: SiteInventory) {
  for (const list of [inv.plugins, inv.themes]) {
    for (const row of list) {
      if (row.latestVersion && isOutdated(row.version, row.latestVersion)) {
        row.updateAvailable = true;
      }
    }
  }
}

async function checkExtensionUpdateServers(
  inv: SiteInventory,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const all = allExtensions(inv).filter((e) => e.updateUrl && e.version);

  // Limita parallelismo e volume (site grandi = centinaia di estensioni)
  const batch = all.slice(0, 80);
  const results = await mapPool(batch, 6, async (ext) => {
    const latest = await fetchLatestFromUpdateXml(ext.updateUrl!).catch(
      () => null,
    );
    return { ext, latest };
  });

  for (const { ext, latest } of results) {
    if (!latest) continue;
    ext.latestVersion = latest;
    if (!isOutdated(ext.version, latest)) continue;
    ext.updateAvailable = true;

    const kind =
      ext.type === "plugin"
        ? "update_plugin"
        : ext.type === "template" || ext.type === "theme"
          ? "update_theme"
          : "update_plugin";

    findings.push({
      type: kind,
      severity: ext.enabled === false ? "low" : "medium",
      title: `Da aggiornare: ${ext.name}`,
      description: `${ext.version ?? "?"} → ${latest}`,
      evidence: {
        folder: ext.folder,
        type: ext.type,
        from: ext.version,
        to: latest,
      },
      proposedPlan: {
        summary: `Aggiornare ${ext.name} a ${latest}`,
        steps: [
          "Backup",
          "System → Update (o installazione pacchetto)",
          "Verificare funzionalità estensione",
        ],
        risk: "medium",
        requiresBackup: true,
      },
    });
  }

  return findings;
}

function allExtensions(inv: SiteInventory): InventoryExtension[] {
  return [
    ...inv.extensions,
    ...inv.plugins,
    ...inv.themes,
    ...(inv.modules ?? []),
  ];
}

function countPending(inv: SiteInventory): number {
  let n = inv.coreUpdateAvailable ? 1 : 0;
  for (const e of allExtensions(inv)) {
    if (e.updateAvailable) n += 1;
  }
  return n;
}

/** Ultima stabile nota per branch — usata solo se tutte le fonti remote falliscono. */
const JOOMLA_BRANCH_FALLBACK: Record<string, string> = {
  "3": "3.10.12",
  "4": "4.4.14",
  "5": "5.4.10",
  "6": "6.2.0",
};

type JoomlaLatest = { latest: string; source: string };

async function fetchLatestJoomlaBranch(
  current: string,
): Promise<JoomlaLatest | null> {
  const major = normalizeVersion(current).split(".")[0] ?? "";
  if (!major) return null;

  // update.joomla.org prima: downloads.joomla.org spesso risponde 521
  const sources: Array<[string, () => Promise<string | null>]> = [
    ["update.joomla.org", () => fetchJoomlaFromUpdateXml(major)],
    ["downloads.joomla.org", () => fetchJoomlaFromDownloadsApi(major)],
    ["github.com/joomla", () => fetchJoomlaFromGithub(major)],
  ];

  for (const [source, fn] of sources) {
    try {
      const latest = await fn();
      if (latest) return { latest, source };
    } catch {
      /* prova fonte successiva */
    }
  }

  const fallback = JOOMLA_BRANCH_FALLBACK[major];
  if (fallback) return { latest: fallback, source: "fallback locale" };
  return null;
}

async function fetchJoomlaFromDownloadsApi(
  major: string,
): Promise<string | null> {
  const res = await fetch("https://downloads.joomla.org/api/v1/latest/cms", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "SiteGuard/1.0 (update-check)" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    branches?: Array<{ branch?: string; version?: string }>;
  };
  const match = data.branches?.find((b) => {
    const m = b.branch?.match(/Joomla!?\s*(\d+)/i);
    return m?.[1] === major;
  });
  return match?.version ?? null;
}

/** Canale update ufficiale Joomla. */
async function fetchJoomlaFromUpdateXml(major: string): Promise<string | null> {
  const urls = [
    "https://update.joomla.org/core/list.xml",
    "https://update.joomla.org/core/sts/list_sts.xml",
    major === "4" ? "https://update.joomla.org/core/j4/default.xml" : "",
    major === "5" ? "https://update.joomla.org/core/j5/default.xml" : "",
  ].filter(Boolean);

  let best: string | null = null;
  for (const url of urls) {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "application/xml,text/xml,*/*",
        "User-Agent": "SiteGuard/1.0 (update-check)",
      },
    });
    if (!res.ok) continue;
    const text = await res.text();
    const fromAttrs = [
      ...text.matchAll(/\bversion="(\d+\.\d+\.\d+)"/gi),
    ].map((m) => m[1]!);
    const fromTags = [
      ...text.matchAll(/<version>(\d+\.\d+\.\d+)<\/version>/gi),
    ].map((m) => m[1]!);
    for (const v of [...fromAttrs, ...fromTags]) {
      if (!v.startsWith(`${major}.`)) continue;
      if (!best || compareSemver(v, best) > 0) best = v;
    }
  }
  return best;
}

async function fetchJoomlaFromGithub(major: string): Promise<string | null> {
  const res = await fetch(
    "https://api.github.com/repos/joomla/joomla-cms/tags?per_page=100",
    {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "SiteGuard-UpdateCheck",
      },
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ name?: string }>;
  let best: string | null = null;
  for (const row of data) {
    const tag = (row.name ?? "").replace(/^v/i, "");
    if (/-(rc|alpha|beta|dev)/i.test(tag)) continue;
    if (!/^\d+\.\d+\.\d+$/.test(tag)) continue;
    if (!tag.startsWith(`${major}.`)) continue;
    if (!best || compareSemver(tag, best) > 0) best = tag;
  }
  return best;
}

async function fetchLatestWpCore(): Promise<string | null> {
  const res = await fetch("https://api.wordpress.org/core/version-check/1.7/", {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    offers?: Array<{ version?: string; response?: string }>;
  };
  const upgrade = data.offers?.find((o) => o.response === "upgrade");
  if (upgrade?.version) return upgrade.version;
  const stable = data.offers?.find((o) => o.response === "latest");
  return stable?.version ?? data.offers?.[0]?.version ?? null;
}

async function fetchLatestFromUpdateXml(
  url: string,
  depth = 0,
): Promise<string | null> {
  if (depth > 2) return null;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/xml,text/xml,*/*" },
  });
  if (!res.ok) return null;
  const text = await res.text();

  // Collection: segue location verso extension XML
  const locations = [
    ...text.matchAll(/<location>([^<]+)<\/location>/gi),
  ].map((m) => m[1].trim());
  const hasVersions = /<version>/i.test(text);
  if (locations.length > 0 && !hasVersions) {
    for (const loc of locations.slice(0, 2)) {
      const v = await fetchLatestFromUpdateXml(loc, depth + 1);
      if (v) return v;
    }
    return null;
  }

  const versions = [...text.matchAll(/<version>([^<]+)<\/version>/gi)]
    .map((m) => normalizeVersion(m[1]))
    .filter((v) => /^\d/.test(v));

  if (versions.length === 0) return null;
  return versions.reduce((best, v) =>
    compareSemver(v, best) > 0 ? v : best,
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      worker(),
    ),
  );
  return out;
}

/** Estrae il primo URL di update server da un manifest Joomla XML. */
export function extractUpdateServerUrl(xml: string): string | undefined {
  const servers = xml.match(
    /<updateservers[\s\S]*?<\/updateservers>/i,
  )?.[0];
  if (!servers) return undefined;
  const url =
    servers.match(/<server[^>]*>([^<]+)<\/server>/i)?.[1]?.trim() ??
    servers.match(/>(https?:\/\/[^<]+)</i)?.[1]?.trim();
  return url || undefined;
}
