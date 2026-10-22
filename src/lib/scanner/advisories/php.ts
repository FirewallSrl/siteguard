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
  source: "header" | "sftp" | "composer" | "unknown";
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

/** Rileva versione PHP da header HTTP pubblici. */
export async function detectPhpFromHttp(
  siteUrl: string,
): Promise<PhpVersionHit | null> {
  try {
    const res = await fetch(siteUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "SiteGuard/0.1 (+php-version-check)",
        Accept: "text/html,*/*",
      },
      signal: AbortSignal.timeout(12_000),
    });
    const powered = res.headers.get("x-powered-by") ?? "";
    const server = res.headers.get("server") ?? "";
    const fromPowered = powered.match(/PHP\/(\d+\.\d+(?:\.\d+)?)/i)?.[1];
    if (fromPowered) return { version: fromPowered, source: "header" };
    const fromServer = server.match(/PHP\/(\d+\.\d+(?:\.\d+)?)/i)?.[1];
    if (fromServer) return { version: fromServer, source: "header" };
  } catch {
    /* ignore */
  }
  return null;
}

/** Hint da filesystem (composer.json / .php-version). */
export async function detectPhpFromSftp(
  readText: (path: string) => Promise<string>,
  root: string,
): Promise<PhpVersionHit | null> {
  const candidates = [
    `${root}/.php-version`,
    `${root}/composer.json`,
    `${root}/../composer.json`,
  ];
  for (const path of candidates) {
    try {
      const text = await readText(path);
      if (path.endsWith(".php-version")) {
        const v = text.trim().match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
        if (v) return { version: v, source: "sftp" };
      }
      if (path.endsWith("composer.json")) {
        const json = JSON.parse(text) as {
          config?: { platform?: { php?: string } };
          require?: { php?: string };
        };
        const platform = json.config?.platform?.php;
        if (platform) {
          const v = platform.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
          if (v) return { version: v, source: "composer" };
        }
        const req = json.require?.php;
        if (req) {
          const v = req.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
          if (v) return { version: v, source: "composer" };
        }
      }
    } catch {
      /* next */
    }
  }
  return null;
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
