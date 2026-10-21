import type { ScanFinding } from "../types";

type BrokenHit = {
  url: string;
  status: number | null;
  from: string;
  error?: string;
};

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|#)/i;
const MAX_PAGES = 6;
const MAX_LINKS_TO_CHECK = 60;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;

export type BrokenLinksReport = {
  findings: ScanFinding[];
  pagesScanned: number;
  linksChecked: number;
  brokenCount: number;
};

/**
 * Crawl leggero della homepage (+ poche pagine same-origin):
 * estrae link e segnala 4xx/5xx/timeout come finding.
 */
export async function checkBrokenLinks(
  siteUrl: string,
): Promise<BrokenLinksReport> {
  let origin: string;
  let start: string;
  try {
    const u = new URL(siteUrl);
    origin = u.origin;
    start = u.href;
  } catch {
    return { findings: [], pagesScanned: 0, linksChecked: 0, brokenCount: 0 };
  }

  const pagesToVisit = [normalizeUrl(start)];
  const visitedPages = new Set<string>();
  const linkMap = new Map<string, string>(); // target -> first page that linked it

  while (pagesToVisit.length > 0 && visitedPages.size < MAX_PAGES) {
    const page = pagesToVisit.shift()!;
    if (visitedPages.has(page)) continue;
    visitedPages.add(page);

    const html = await fetchHtml(page);
    if (!html) continue;

    for (const href of extractLinks(html)) {
      const absolute = resolveHref(page, href);
      if (!absolute) continue;
      if (SKIP_SCHEMES.test(absolute)) continue;

      let parsed: URL;
      try {
        parsed = new URL(absolute);
      } catch {
        continue;
      }

      // Solo http(s)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;

      const key = normalizeUrl(parsed.href);
      if (!linkMap.has(key)) linkMap.set(key, page);

      // Crawl interno: stesse origin, path "pagina"
      if (
        parsed.origin === origin &&
        pagesToVisit.length + visitedPages.size < MAX_PAGES &&
        !visitedPages.has(key) &&
        looksLikeHtmlPath(parsed.pathname)
      ) {
        pagesToVisit.push(key);
      }
    }
  }

  const targets = [...linkMap.keys()].slice(0, MAX_LINKS_TO_CHECK);
  const broken: BrokenHit[] = [];

  await mapPool(targets, CONCURRENCY, async (url) => {
    const result = await probeUrl(url);
    if (result.ok) return;
    broken.push({
      url,
      status: result.status,
      from: linkMap.get(url) ?? start,
      error: result.error,
    });
  });

  if (broken.length === 0) {
    return {
      findings: [],
      pagesScanned: visitedPages.size,
      linksChecked: targets.length,
      brokenCount: 0,
    };
  }

  const sample = broken.slice(0, 12);
  const status404 = broken.filter((b) => b.status === 404).length;
  const severity =
    broken.length >= 10 ? "high" : broken.length >= 3 ? "medium" : "low";

  return {
    pagesScanned: visitedPages.size,
    linksChecked: targets.length,
    brokenCount: broken.length,
    findings: [
      {
        type: "broken_link",
        severity,
        title: `${broken.length} link rotti rilevati`,
        description:
          status404 > 0
            ? `${status404} con HTTP 404. Esempi: ${sample
                .slice(0, 3)
                .map((b) => shortUrl(b.url))
                .join(", ")}`
            : `Errori di raggiungibilità. Esempi: ${sample
                .slice(0, 3)
                .map((b) => shortUrl(b.url))
                .join(", ")}`,
        evidence: {
          pagesScanned: visitedPages.size,
          linksChecked: targets.length,
          broken: broken.length,
          items: sample.map((b) => ({
            url: b.url,
            status: b.status,
            from: b.from,
            error: b.error ?? null,
          })),
        },
        proposedPlan: {
          summary: "Correggere o rimuovere i link non validi",
          steps: [
            "Aprire i URL elencati nel finding",
            "Aggiornare menu, moduli e contenuti che li puntano",
            "Ripetere lo scan per verificare",
          ],
          risk: severity === "high" ? "high" : "medium",
          requiresBackup: false,
        },
      },
    ],
  };
}

function extractLinks(html: string): string[] {
  const out: string[] = [];
  const re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  return out;
}

function resolveHref(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function normalizeUrl(href: string): string {
  try {
    const u = new URL(href);
    u.hash = "";
    // Trailing slash normalizzazione soft
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return href;
  }
}

function looksLikeHtmlPath(pathname: string): boolean {
  if (!pathname || pathname === "/") return true;
  const last = pathname.split("/").pop() ?? "";
  if (!last.includes(".")) return true;
  return /\.(html?|php|aspx?)$/i.test(last);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || u.href;
  } catch {
    return url.slice(0, 80);
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "SiteGuardLinkCheck/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/html|xml|text\/plain/i.test(ct) && ct.length > 0) return null;
    const text = await res.text();
    return text.slice(0, 500_000);
  } catch {
    return null;
  }
}

async function probeUrl(
  url: string,
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  try {
    // HEAD prima; alcuni server non lo supportano → GET
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "SiteGuardLinkCheck/1.0" },
      cache: "no-store",
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "SiteGuardLinkCheck/1.0" },
        cache: "no-store",
      });
    }
    if (res.status >= 400) {
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : "timeout/network",
    };
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      worker(),
    ),
  );
}
