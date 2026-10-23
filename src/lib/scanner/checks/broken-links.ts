import type { ScanFinding } from "../types";

type BrokenHit = {
  url: string;
  status: number | null;
  from: string;
  error?: string;
};

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|#)/i;
const MAX_PAGES = 10;
const MAX_LINKS_TO_CHECK = 100;
const CONCURRENCY = 3;
const TIMEOUT_MS = 20_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type BrokenLinksReport = {
  findings: ScanFinding[];
  pagesScanned: number;
  linksChecked: number;
  brokenCount: number;
  items: BrokenHit[];
};

/**
 * Crawl homepage + pagine same-origin: estrae href/src e verifica 4xx/5xx.
 * Timeout / errori di rete NON contano come URL rotti (evita falsi positivi).
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
    return emptyReport();
  }

  const pagesToVisit = [normalizeUrl(start)];
  const visitedPages = new Set<string>();
  const linkMap = new Map<string, string>();

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

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;

      const key = normalizeUrl(parsed.href);
      if (!linkMap.has(key)) linkMap.set(key, page);

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
  let unverifiable = 0;

  await mapPool(targets, CONCURRENCY, async (url) => {
    const result = await probeUrl(url);
    if (result.ok) return;
    if (result.status == null) {
      // Timeout / rete: non segnalare come "rotto"
      unverifiable += 1;
      return;
    }
    broken.push({
      url,
      status: result.status,
      from: linkMap.get(url) ?? start,
      error: result.error,
    });
  });

  const sample = broken.slice(0, 15);
  const status404 = broken.filter((b) => b.status === 404).length;

  if (broken.length === 0) {
    const note =
      unverifiable > 0
        ? ` ${unverifiable} link non verificati per timeout/rete (ignorati).`
        : "";
    return {
      pagesScanned: visitedPages.size,
      linksChecked: targets.length,
      brokenCount: 0,
      items: [],
      findings: [
        {
          type: "broken_link",
          severity: "info",
          title: "Nessun URL rotto rilevato",
          description: `Controllati ${targets.length} link su ${visitedPages.size} pagine. Nessun 4xx/5xx.${note}`,
          evidence: {
            pagesScanned: visitedPages.size,
            linksChecked: targets.length,
            broken: 0,
            unverifiable,
            items: [],
          },
          proposedPlan: {
            summary: "Nessuna azione richiesta",
            steps: ["Ripeti lo scan dopo modifiche a menu o contenuti"],
            risk: "info",
            requiresBackup: false,
          },
        },
      ],
    };
  }

  const severity =
    broken.length >= 10 ? "high" : broken.length >= 3 ? "medium" : "low";

  return {
    pagesScanned: visitedPages.size,
    linksChecked: targets.length,
    brokenCount: broken.length,
    items: sample,
    findings: [
      {
        type: "broken_link",
        severity,
        title: `${broken.length} URL rotti rilevati`,
        description:
          status404 > 0
            ? `${status404} con HTTP 404 su ${targets.length} link controllati (${visitedPages.size} pagine).`
            : `${broken.length} URL con HTTP 4xx/5xx su ${targets.length} controllati.`,
        evidence: {
          pagesScanned: visitedPages.size,
          linksChecked: targets.length,
          broken: broken.length,
          unverifiable,
          items: sample.map((b) => ({
            url: b.url,
            status: b.status,
            from: b.from,
            error: b.error ?? null,
          })),
        },
        proposedPlan: {
          summary: "Correggere o rimuovere gli URL non validi",
          steps: [
            "Aprire gli URL elencati nel finding",
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

function emptyReport(): BrokenLinksReport {
  return {
    findings: [],
    pagesScanned: 0,
    linksChecked: 0,
    brokenCount: 0,
    items: [],
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

async function fetchHtml(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS + attempt * 8_000),
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (ct && !/html|xml|text\//i.test(ct)) return null;
      return (await res.text()).slice(0, 600_000);
    } catch {
      /* retry once su timeout */
    }
  }
  return null;
}

async function fetchOnce(
  url: string,
  method: "HEAD" | "GET",
  timeoutMs = TIMEOUT_MS,
): Promise<{ ok: true; status: number } | { ok: false; status: number | null; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
      },
      cache: "no-store",
    });
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

async function probeUrl(
  url: string,
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  // 1) HEAD veloce
  const head = await fetchOnce(url, "HEAD");
  if (head.ok) return head;

  // 2) Sempre GET di conferma (molti WP/WAF rompono HEAD o lo fanno scadere)
  const get = await fetchOnce(url, "GET");
  if (get.ok) return get;

  // 3) Un retry GET più paziente su errori di rete
  if (get.status == null) {
    const retry = await fetchOnce(url, "GET", TIMEOUT_MS + 8_000);
    if (retry.ok) return retry;
    return retry;
  }

  // HEAD 404 + GET 200 (già coperto) / HEAD 4xx con GET diverso
  if (head.status != null && head.status !== get.status && get.status != null) {
    return get.status < 400
      ? { ok: true, status: get.status }
      : { ok: false, status: get.status, error: get.error };
  }

  return get;
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
