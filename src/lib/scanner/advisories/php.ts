import { compareSemver, normalizeVersion } from "../version";
import type { ScanFinding } from "../types";

/**
 * Catalogo advisory PHP curato (ACN + php.net).
 * Aggiornato a mano quando escono bollettini critici; opzionalmente
 * arricchito a runtime da php.net (best-effort).
 */
export type PhpAdvisory = {
  id: string;
  title: string;
  summary: string;
  severity: "critical" | "high" | "medium";
  cves: string[];
  publishedAt: string;
  sources: Array<{ label: string; url: string }>;
  /** Versione minima patchata per branch (es. "8.3" → "8.3.36"). */
  fixedIn: Record<string, string>;
  /** Branch EOL senza patch upstream (es. 8.1, 7.4). */
  eolBranches?: string[];
};

/** PHP2Shell — ACN 21/10/2026 + advisory php.net */
export const PHP_ADVISORIES: PhpAdvisory[] = [
  {
    id: "php2shell-2026-10",
    title: "PHP2Shell: RCE critiche in php-src",
    summary:
      "Due vulnerabilità Use-After-Free (CVE-2026-109618, CVE-2026-109619) consentono RCE remota non autenticata sul worker PHP. Impatto ACN: alto.",
    severity: "critical",
    cves: ["CVE-2026-109618", "CVE-2026-109619"],
    publishedAt: "2026-10-21",
    sources: [
      {
        label: "ACN — PHP2Shell",
        url: "https://www.acn.gov.it/portale/w/php2shell-sanate-vulnerabilita-critiche-in-php",
      },
      {
        label: "php.net — Security advisory",
        url: "https://www.php.net/archive/2026.php#2026-10-21-5",
      },
      {
        label: "GHSA-w8hw-w9fx-j79w",
        url: "https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w",
      },
      {
        label: "GHSA-6wmf-4rv5-p3rp",
        url: "https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp",
      },
    ],
    fixedIn: {
      "8.5": "8.5.12",
      "8.4": "8.4.27",
      "8.3": "8.3.36",
      "8.2": "8.2.35",
    },
    eolBranches: ["8.1", "8.0", "7.4", "7.3", "7.2", "7.1", "7.0", "5"],
  },
];

export type PhpVersionHit = {
  version: string;
  source: "header" | "sftp" | "composer" | "probe" | "unknown";
};

export type PhpAdvisoryHit = {
  advisory: PhpAdvisory;
  current: string;
  fixedIn?: string;
  eol: boolean;
};

export function branchOf(version: string): string {
  const n = normalizeVersion(version);
  const parts = n.split(".");
  if (parts[0] === "5") return "5";
  return `${parts[0]}.${parts[1] ?? "0"}`;
}

export function matchPhpAdvisories(phpVersion: string): PhpAdvisoryHit[] {
  const branch = branchOf(phpVersion);
  const hits: PhpAdvisoryHit[] = [];

  for (const advisory of PHP_ADVISORIES) {
    if (advisory.eolBranches?.some((b) => branch === b || branch.startsWith(b))) {
      hits.push({ advisory, current: phpVersion, eol: true });
      continue;
    }
    const fixed = advisory.fixedIn[branch];
    if (!fixed) continue;
    if (compareSemver(phpVersion, fixed) < 0) {
      hits.push({ advisory, current: phpVersion, fixedIn: fixed, eol: false });
    }
  }
  return hits;
}

export function findingsFromPhpHits(
  hits: PhpAdvisoryHit[],
  phpVersion: string,
): ScanFinding[] {
  return hits.map((hit) => {
    const { advisory, fixedIn, eol } = hit;
    const sources = advisory.sources.map((s) => s.url).join(" · ");
    return {
      type: "vulnerability" as const,
      severity: advisory.severity,
      title: eol
        ? `PHP ${phpVersion} EOL — esposto a ${advisory.id}`
        : `PHP ${phpVersion} vulnerabile — aggiornare a ${fixedIn}`,
      description: eol
        ? `PHP ${phpVersion} (branch ${branchOf(phpVersion)}) non riceve più patch upstream. ${advisory.summary} Fonti: ${sources}`
        : `Rilevato PHP ${phpVersion}; la patch minima per il branch è ${fixedIn}. ${advisory.summary} CVE: ${advisory.cves.join(", ")}. Fonti: ${sources}`,
      evidence: {
        phpVersion,
        advisoryId: advisory.id,
        cves: advisory.cves,
        fixedIn: fixedIn ?? null,
        eol,
        sources: advisory.sources,
        publishedAt: advisory.publishedAt,
      },
      proposedPlan: {
        summary: eol
          ? `Migrare da PHP ${phpVersion} a un branch supportato (≥ 8.2)`
          : `Aggiornare PHP a ${fixedIn} o superiore`,
        steps: eol
          ? [
              "Verificare compatibilità CMS/estensioni con PHP 8.2+",
              "Aggiornare runtime sul hosting",
              "Threat hunting su log (ACN)",
              "Rescan SiteGuard",
            ]
          : [
              `Aggiornare PHP a ${fixedIn}+ (pacchetto distro o build)`,
              "Riavviare php-fpm / worker",
              "Verificare ACN/php.net per workaround temporanei se necessario",
              "Rescan SiteGuard",
            ],
        risk: advisory.severity,
        requiresBackup: true,
      },
    };
  });
}

/** Rileva versione PHP da header HTTP pubblici (homepage + endpoint tipici). */
export async function detectPhpFromHttp(
  siteUrl: string,
): Promise<PhpVersionHit | null> {
  const base = siteUrl.replace(/\/$/, "");
  const urls = [
    base,
    `${base}/index.php`,
    `${base}/administrator/index.php`,
    `${base}/wp-login.php`,
    `${base}/api/index.php`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "SiteGuard/0.2 (+php-version-check)",
          Accept: "text/html,*/*",
        },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const fromHeaders = versionFromHeaders(res.headers);
      if (fromHeaders) return { version: fromHeaders, source: "header" };

      // Alcuni reverse-proxy lasciano la versione solo su 404 PHP
      if (res.status >= 400) {
        const again = versionFromHeaders(res.headers);
        if (again) return { version: again, source: "header" };
      }
    } catch {
      /* next */
    }
  }
  return null;
}

function versionFromHeaders(headers: Headers): string | null {
  const powered = headers.get("x-powered-by") ?? "";
  const server = headers.get("server") ?? "";
  const via = headers.get("via") ?? "";
  const blob = `${powered}\n${server}\n${via}`;
  return blob.match(/PHP\/(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? null;
}

function parsePhpVersion(text: string): string | null {
  return text.trim().match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
}

function joinRoot(root: string, rel: string): string {
  const base = root.replace(/\/$/, "") || ".";
  const leaf = rel.replace(/^\//, "");
  if (!leaf) return base;
  if (base === ".") return leaf;
  return `${base}/${leaf}`;
}

/** Hint da filesystem (composer, .php-version, lock, CloudLinux selector). */
export async function detectPhpFromSftp(
  readText: (path: string) => Promise<string>,
  root: string,
  opts?: { listDir?: (path: string) => Promise<string[]> },
): Promise<PhpVersionHit | null> {
  const rootNorm = root.replace(/\/$/, "") || ".";
  // Evitare ".." e sotto-docroot fantasma: su chroot FTP spezzano spesso la sessione.
  const bases = uniqueStrings([rootNorm]);

  // Scansiona .cl.selector nella sola root corrente
  if (opts?.listDir) {
    try {
      const sel = joinRoot(rootNorm, ".cl.selector");
      const names = await opts.listDir(sel);
      for (const name of names.slice(0, 40)) {
        if (!/\.(cfg|json|conf|ini|txt)$/i.test(name) && name !== "defaults.cfg") {
          continue;
        }
        try {
          const text = await readText(joinRoot(sel, name));
          const v = parseSelectorPhpVersion(text);
          if (v) return { version: v, source: "sftp" };
        } catch {
          /* next file */
        }
      }
    } catch {
      /* no selector */
    }
  }

  const relFiles: Array<{
    rel: string;
    kind: "version-file" | "composer" | "lock" | "ini" | "selector";
  }> = [
    { rel: ".cl.selector/defaults.cfg", kind: "selector" },
    { rel: ".cl.selector/defaults.cfg.json", kind: "selector" },
    { rel: ".cl.selector/config.json", kind: "selector" },
    { rel: ".cl.selector/php.conf", kind: "selector" },
    { rel: ".php-version", kind: "version-file" },
    { rel: ".phpenv/version", kind: "version-file" },
    { rel: "composer.json", kind: "composer" },
    { rel: "composer.lock", kind: "lock" },
    { rel: ".user.ini", kind: "ini" },
    { rel: "php.ini", kind: "ini" },
  ];

  for (const base of bases) {
    for (const item of relFiles) {
      try {
        const text = await readText(joinRoot(base, item.rel));
        if (item.kind === "version-file") {
          const v = parsePhpVersion(text);
          if (v) return { version: v, source: "sftp" };
        }
        if (item.kind === "selector") {
          const v = parseSelectorPhpVersion(text);
          if (v) return { version: v, source: "sftp" };
        }
        if (item.kind === "ini") {
          const v =
            text.match(/^\s*;\s*PHP\s+(\d+\.\d+(?:\.\d+)?)/im)?.[1] ??
            text.match(/php[_-]?version\s*=\s*["']?(\d+\.\d+(?:\.\d+)?)/i)?.[1];
          if (v) return { version: v, source: "sftp" };
        }
        if (item.kind === "composer") {
          const json = JSON.parse(text) as {
            config?: { platform?: { php?: string } };
            require?: { php?: string };
          };
          const platform = json.config?.platform?.php;
          if (platform) {
            const v = parsePhpVersion(platform);
            if (v) return { version: v, source: "composer" };
          }
          const req = json.require?.php;
          if (req) {
            const v = parsePhpVersion(req);
            if (v) return { version: v, source: "composer" };
          }
        }
        if (item.kind === "lock") {
          const json = JSON.parse(text) as {
            platform?: { php?: string };
            "platform-dev"?: { php?: string };
          };
          const platform = json.platform?.php ?? json["platform-dev"]?.php;
          if (platform) {
            const v = parsePhpVersion(platform);
            if (v) return { version: v, source: "composer" };
          }
        }
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/** CloudLinux selector / alt config (cfg, json, ini-like). */
function parseSelectorPhpVersion(text: string): string | null {
  // "php = native" non è una versione — serve probe runtime
  if (/php\s*=\s*native\b/i.test(text) && !/\d+\.\d+/.test(text)) {
    return null;
  }
  const patterns = [
    /(?:^|[\s;[])(?:php[_-]?version|version|selected|interpreter|php)\s*[=:]\s*["']?(\d+\.\d+(?:\.\d+)?)/im,
    /ea-php(\d)(\d)/i, // ea-php81 → 8.1
    /alt-php(\d)(\d)/i,
    /"php"\s*:\s*"(\d+\.\d+(?:\.\d+)?)"/i,
    /php[_-]?(\d)\.(\d+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (m[1] && m[2] && !m[1].includes(".")) {
      return `${m[1]}.${m[2]}`;
    }
    if (m[1] && /^\d+\.\d+/.test(m[1])) return m[1];
  }
  const loose = text.match(/\b([78]\.\d(?:\.\d+)?)\b/);
  return loose?.[1] ?? null;
}

/**
 * Probe sicuro: scrive un PHP monouso in cartelle web-accessibili,
 * lo richiama in HTTP, legge PHP_VERSION e cancella subito.
 *
 * Importante: NON scrivere prima sulla docroot (""): su FTP passivo
 * un put fallito in root può chiudere il data-socket e invalidare
 * tutta la sessione. Preferire tmp/cache/media.
 */
export async function detectPhpViaRemoteProbe(input: {
  siteUrl: string;
  root: string;
  put: (path: string, data: string) => Promise<void>;
  del: (path: string) => Promise<void>;
  canList?: (path: string) => Promise<boolean>;
  /** Se true, tenta anche la docroot per ultima (può far cadere FTP). */
  tryDocroot?: boolean;
}): Promise<PhpVersionHit | null> {
  const token = `sg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `sg-php-${token}.php`;
  const marker = `SGPHP|${token}|`;
  const body =
    "<?php header('Content-Type: text/plain; charset=utf-8');" +
    "header('X-Robots-Tag: noindex, nofollow');" +
    "header('Cache-Control: no-store');" +
    "header('X-SG-PHP: '.PHP_VERSION);" +
    `echo '${marker}'.PHP_VERSION;`;

  const root = input.root.replace(/\/$/, "") || ".";
  const siteBase = input.siteUrl.replace(/\/$/, "");

  // Ordine: cartelle dove l'upload FTP + esecuzione PHP funzionano più spesso
  const dirCandidates = uniqueStrings([
    "tmp",
    "cache",
    "media",
    "images",
    "tmp/regularlabs",
    "httpdocs/tmp",
    "public_html/tmp",
    "administrator/cache",
    "wp-content/uploads",
    "wp-content/cache",
    ...(input.tryDocroot ? [""] : []),
  ]);

  for (const dir of dirCandidates) {
    const remoteDir = dir ? joinRoot(root, dir) : root;
    if (input.canList) {
      const ok = await input.canList(remoteDir).catch(() => false);
      if (!ok) continue;
    }

    const remotePath = joinRoot(remoteDir, fileName);
    try {
      await input.put(remotePath, body);
    } catch {
      // Put fallito: passa oltre senza insistere sulla stessa sessione
      continue;
    }

    try {
      const urlDirs = uniqueStrings([
        dir,
        dir.replace(/^(httpdocs|public_html|www|web|public)\//, ""),
        dir.replace(/^(httpdocs|public_html|www|web|public)$/, ""),
      ]).filter((d) => !/^(httpdocs|public_html|www|web|public)$/i.test(d));

      const urls: string[] = [];
      for (const ud of urlDirs) {
        const path = ud ? `${ud}/${fileName}` : fileName;
        urls.push(`${siteBase}/${path}`);
        urls.push(`${siteBase}/${path}?t=${token}`);
      }
      urls.push(`${siteBase}/tmp/${fileName}`);
      urls.push(`${siteBase}/cache/${fileName}`);
      urls.push(`${siteBase}/media/${fileName}`);
      urls.push(`${siteBase}/images/${fileName}`);

      for (const url of uniqueStrings(urls)) {
        const hit = await fetchProbeVersion(url, marker);
        if (hit) return hit;
      }
    } finally {
      await input.del(remotePath).catch(() => undefined);
    }
  }

  return null;
}

async function fetchProbeVersion(
  url: string,
  marker: string,
): Promise<PhpVersionHit | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "SiteGuard/0.2 (+php-probe)",
        Accept: "text/plain,*/*",
      },
      signal: AbortSignal.timeout(12_000),
    });

    const sgHeader = res.headers.get("x-sg-php");
    if (sgHeader) {
      const v = parsePhpVersion(sgHeader);
      if (v) return { version: v, source: "probe" };
    }

    const fromHeaders = versionFromHeaders(res.headers);
    const text = (await res.text()).trim();

    // Formato atteso: SGPHP|token|8.2.28  oppure SG|8.2.28
    if (text.includes(marker)) {
      const after = text.split(marker)[1] ?? "";
      const v = parsePhpVersion(after.split(/[\s<]/)[0] ?? after);
      if (v) return { version: v, source: "probe" };
    }
    const sgPipe = text.match(/\bSG\|(\d+\.\d+(?:\.\d+)?)\b/);
    if (sgPipe?.[1]) return { version: sgPipe[1], source: "probe" };

    if (res.ok) {
      const v = parsePhpVersion(text);
      if (v && /^[\d.]+$/.test(text.trim())) {
        return { version: v, source: "probe" };
      }
    }

    if (fromHeaders) return { version: fromHeaders, source: "probe" };
  } catch {
    /* ignore */
  }
  return null;
}

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const v = item.replace(/^\/+|\/+$/g, "");
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Best-effort: conferma da php.net che le release patchate esistono.
 * Non sostituisce il catalogo curato; fallisce in silenzio.
 */
export async function refreshPatchedHints(): Promise<
  Partial<Record<string, string>> | null
> {
  try {
    const res = await fetch("https://www.php.net/releases/index.php?json&version=8&max=20", {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { version?: string } | string
    >;
    const out: Partial<Record<string, string>> = {};
    for (const [key, val] of Object.entries(data)) {
      const ver =
        typeof val === "string"
          ? val
          : typeof val === "object" && val?.version
            ? val.version
            : key;
      const n = normalizeVersion(String(ver));
      const branch = branchOf(n);
      if (!out[branch] || compareSemver(n, out[branch]!) > 0) {
        out[branch] = n;
      }
    }
    return out;
  } catch {
    return null;
  }
}
