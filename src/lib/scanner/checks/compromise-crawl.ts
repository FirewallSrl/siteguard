import type { ScanFinding } from "../types";

/**
 * Crawl HTTP live: SEO spam, cloaking, script/iframe iniettati, webshell esposti.
 * Usa scoring multi-segnale per ridurre i falsi positivi.
 */

const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 SiteGuard/2.0";
const UA_GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const MAX_PAGES = 18;
const TIMEOUT_MS = 12_000;
const MAX_HTML = 700_000;

type Signal = {
  id: string;
  weight: number;
  severity: "medium" | "high" | "critical";
  title: string;
  detail: string;
  page: string;
};

type PageSnapshot = {
  url: string;
  html: string;
  finalUrl: string;
};

export type CompromiseReport = {
  findings: ScanFinding[];
  pagesScanned: number;
  signals: number;
  score: number;
};

export async function crawlCompromiseSignals(
  siteUrl: string,
): Promise<CompromiseReport> {
  let origin: string;
  let start: string;
  try {
    const u = new URL(siteUrl);
    origin = u.origin;
    start = u.href;
  } catch {
    return { findings: [], pagesScanned: 0, signals: 0, score: 0 };
  }

  const queue = [normalizeUrl(start)];
  const visited = new Set<string>();
  const pages: PageSnapshot[] = [];
  const signals: Signal[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const page = queue.shift()!;
    if (visited.has(page)) continue;
    visited.add(page);

    const snap = await fetchPage(page, UA_BROWSER);
    if (!snap) continue;
    pages.push(snap);

    signals.push(...analyzePage(snap, origin));

    for (const href of extractHrefs(snap.html)) {
      const abs = resolveHref(snap.finalUrl || page, href);
      if (!abs) continue;
      let parsed: URL;
      try {
        parsed = new URL(abs);
      } catch {
        continue;
      }
      if (parsed.origin !== origin) continue;
      if (!looksLikeHtmlPath(parsed.pathname)) continue;
      const key = normalizeUrl(parsed.href);
      if (!visited.has(key) && queue.length + visited.size < MAX_PAGES) {
        queue.push(key);
      }
    }
  }

  // Cloaking: homepage con UA Googlebot vs browser
  const home = pages[0];
  if (home) {
    const bot = await fetchPage(home.url, UA_GOOGLEBOT);
    if (bot) {
      signals.push(...compareCloaking(home, bot, origin));
    }
  }

  // Probe path noti di webshell / backdoor
  signals.push(...(await probeSuspiciousPaths(origin)));

  const findings = signalsToFindings(signals, pages.length);
  const score = signals.reduce((a, s) => a + s.weight, 0);

  return {
    findings,
    pagesScanned: pages.length,
    signals: signals.length,
    score,
  };
}

function analyzePage(page: PageSnapshot, origin: string): Signal[] {
  const html = page.html;
  const lower = html.toLowerCase();
  const out: Signal[] = [];
  const pageUrl = page.url;

  // --- SEO spam / pharma / gambling ---
  const spamHits = countMatches(
    lower,
    [
      /viagra|cialis|levitra|tramadol|xanax|phentermine/g,
      /casino|slots?\b|poker online|roulette|betting odds/g,
      /cheap\s+meds|online\s+pharmacy|buy\s+pills/g,
      /crypto\s*casino|forex\s*robot|binary\s*option/g,
    ],
  );
  if (spamHits >= 6) {
    out.push({
      id: "seo_spam",
      weight: 8,
      severity: "critical",
      title: "SEO spam / pharma-gambling nel HTML",
      detail: `${spamHits} occorrenze tipiche di spam SEO su ${shortPath(pageUrl)}`,
      page: pageUrl,
    });
  } else if (spamHits >= 3) {
    out.push({
      id: "seo_spam_soft",
      weight: 4,
      severity: "high",
      title: "Possibile SEO spam nel contenuto",
      detail: `${spamHits} keyword sospette su ${shortPath(pageUrl)}`,
      page: pageUrl,
    });
  }

  // Link nascosti (font-size:0, display:none, visibility:hidden)
  const hiddenBlock =
    /<(?:div|span|p|a)[^>]*(?:style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0)[^"']*["'])[^>]*>[\s\S]{0,2500}?<\/(?:div|span|p|a)>/gi;
  let hiddenLinks = 0;
  let m: RegExpExecArray | null;
  while ((m = hiddenBlock.exec(html))) {
    const block = m[0];
    const links = (block.match(/https?:\/\//gi) ?? []).length;
    const anchors = (block.match(/<a\s/gi) ?? []).length;
    if (links + anchors >= 2) hiddenLinks += links + anchors;
  }
  if (hiddenLinks >= 4) {
    out.push({
      id: "hidden_links",
      weight: 7,
      severity: "critical",
      title: "Link nascosti nel DOM",
      detail: `${hiddenLinks} link in blocchi nascosti su ${shortPath(pageUrl)} — tipico SEO spam`,
      page: pageUrl,
    });
  } else if (hiddenLinks >= 2) {
    out.push({
      id: "hidden_links_soft",
      weight: 3,
      severity: "high",
      title: "Elementi nascosti con link esterni",
      detail: `${hiddenLinks} link in contenitori nascosti`,
      page: pageUrl,
    });
  }

  // Iframe esterni sospetti
  const iframes = [...html.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi)];
  for (const im of iframes) {
    const src = im[1]!;
    if (isExternal(src, origin) && !isTrustedCdn(src)) {
      out.push({
        id: "ext_iframe",
        weight: 6,
        severity: "high",
        title: "Iframe verso dominio esterno",
        detail: src.slice(0, 180),
        page: pageUrl,
      });
    }
  }

  // Script esterni non trusted / miner
  const scripts = [
    ...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi),
  ];
  for (const sm of scripts) {
    const src = sm[1]!;
    if (/coinhive|cryptoloot|miner\.|webmine|jsecoin|ppoi\.org/i.test(src)) {
      out.push({
        id: "crypto_miner",
        weight: 10,
        severity: "critical",
        title: "Script crypto-miner rilevato",
        detail: src.slice(0, 180),
        page: pageUrl,
      });
    } else if (
      isExternal(src, origin) &&
      !isTrustedCdn(src) &&
      /\.(tk|ml|ga|cf|gq|buzz|top|xyz|pw)\b/i.test(src)
    ) {
      out.push({
        id: "risky_script_tld",
        weight: 5,
        severity: "high",
        title: "Script da TLD ad alto rischio",
        detail: src.slice(0, 180),
        page: pageUrl,
      });
    }
  }

  // JS obfuscato inline
  const inlineScripts = [
    ...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const block of inlineScripts) {
    const body = block[1] ?? "";
    if (body.length < 40) continue;
    if (
      /eval\s*\(\s*(?:atob|unescape|String\.fromCharCode)/i.test(body) ||
      /document\.write\s*\(\s*unescape\s*\(/i.test(body) ||
      (/fromCharCode/.test(body) && body.length > 800)
    ) {
      out.push({
        id: "obfuscated_js",
        weight: 7,
        severity: "critical",
        title: "JavaScript ofuscato / eval inline",
        detail: `Script inline sospetto su ${shortPath(pageUrl)} (${body.length} char)`,
        page: pageUrl,
      });
      break;
    }
    if (/atob\s*\(\s*['"][A-Za-z0-9+/=]{120,}/i.test(body)) {
      out.push({
        id: "atob_payload",
        weight: 5,
        severity: "high",
        title: "Payload base64 in JavaScript",
        detail: shortPath(pageUrl),
        page: pageUrl,
      });
      break;
    }
  }

  // Meta refresh / JS redirect fuori origin
  const metaRefresh = html.match(
    /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]+content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/i,
  );
  if (metaRefresh?.[1] && isExternal(metaRefresh[1], origin)) {
    out.push({
      id: "meta_redirect",
      weight: 8,
      severity: "critical",
      title: "Meta refresh verso dominio esterno",
      detail: metaRefresh[1].slice(0, 180),
      page: pageUrl,
    });
  }
  if (
    /(?:window|document|top|self)\.location(?:\.href)?\s*=\s*["']https?:\/\//i.test(
      html,
    )
  ) {
    const loc = html.match(
      /(?:window|document|top|self)\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)/i,
    );
    if (loc?.[1] && isExternal(loc[1], origin)) {
      out.push({
        id: "js_redirect",
        weight: 7,
        severity: "critical",
        title: "Redirect JavaScript verso esterno",
        detail: loc[1].slice(0, 180),
        page: pageUrl,
      });
    }
  }

  // Riferimenti a PHP in uploads / media (backdoor tipica)
  const uploadPhp = [
    ...html.matchAll(
      /(?:href|src|action)\s*=\s*["']([^"']*(?:uploads|wp-content\/uploads|images\/|tmp\/)[^"']*\.php[^"']*)["']/gi,
    ),
  ];
  if (uploadPhp.length > 0) {
    out.push({
      id: "php_in_uploads_ref",
      weight: 9,
      severity: "critical",
      title: "Riferimento a PHP in cartella uploads/media",
      detail: uploadPhp
        .slice(0, 3)
        .map((x) => x[1])
        .join(", "),
      page: pageUrl,
    });
  }

  // Doorway / charset spam (caratteri CJK densi in homepage europea tipica)
  const cjk = (html.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
  if (cjk > 400 && !/lang\s*=\s*["']?(ja|zh|ko)/i.test(html.slice(0, 2000))) {
    out.push({
      id: "cjk_spam",
      weight: 5,
      severity: "high",
      title: "Contenuto CJK anomalo (possibile doorway)",
      detail: `${cjk} caratteri CJK su ${shortPath(pageUrl)}`,
      page: pageUrl,
    });
  }

  // Condizionali tipici di malware PHP lasciati in HTML commentato
  if (
    /@include\s*\(\s*["']\/tmp\/|FilesMan|WSO\s*[\d.]+|b374k|c99shell/i.test(
      html,
    )
  ) {
    out.push({
      id: "webshell_marker_html",
      weight: 10,
      severity: "critical",
      title: "Marker di web shell nel HTML",
      detail: shortPath(pageUrl),
      page: pageUrl,
    });
  }

  return out;
}

function compareCloaking(
  browser: PageSnapshot,
  bot: PageSnapshot,
  origin: string,
): Signal[] {
  const out: Signal[] = [];
  const a = stripNoise(browser.html);
  const b = stripNoise(bot.html);
  if (a.length < 200 || b.length < 200) return out;

  const ratio =
    Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1);
  const spamBot = countMatches(b.toLowerCase(), [
    /viagra|cialis|casino|pharmacy|poker/g,
  ]);
  const spamBrowser = countMatches(a.toLowerCase(), [
    /viagra|cialis|casino|pharmacy|poker/g,
  ]);

  if (ratio > 0.45 && (spamBot >= 3 || spamBot > spamBrowser + 2)) {
    out.push({
      id: "cloaking",
      weight: 10,
      severity: "critical",
      title: "Cloaking Googlebot rilevato",
      detail:
        "La homepage restituita a Googlebot differisce fortemente dal browser e contiene spam",
      page: browser.url,
    });
  } else if (ratio > 0.55) {
    out.push({
      id: "cloaking_soft",
      weight: 4,
      severity: "high",
      title: "Differenza anomala browser vs Googlebot",
      detail: `Delta HTML ~${Math.round(ratio * 100)}% — verificare cloaking`,
      page: browser.url,
    });
  }

  // Redirect diverso per bot
  try {
    const bo = new URL(bot.finalUrl).origin;
    const br = new URL(browser.finalUrl).origin;
    if (bo !== br && bo !== origin) {
      out.push({
        id: "bot_redirect",
        weight: 9,
        severity: "critical",
        title: "Redirect diverso per Googlebot",
        detail: `${browser.finalUrl} → bot: ${bot.finalUrl}`,
        page: browser.url,
      });
    }
  } catch {
    /* ignore */
  }

  return out;
}

async function probeSuspiciousPaths(origin: string): Promise<Signal[]> {
  const paths = [
    "/wp-content/uploads/wp-login.php",
    "/wp-content/uploads/shell.php",
    "/wp-content/uploads/x.php",
    "/wp-content/uploads/about.php",
    "/wp-content/uploads/radio.php",
    "/images/stories/admin.php",
    "/tmp/shell.php",
    "/.well-known/acme-challenge/index.php",
    "/.well-known/pki-validation/index.php",
    "/wp-includes/wp-class.php",
    "/wp-includes/css/css.php",
    "/wp-admin/css/colors/index.php",
  ];

  const out: Signal[] = [];
  await mapPool(paths, 6, async (path) => {
    const url = `${origin}${path}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": UA_BROWSER,
          Accept: "text/html,*/*",
        },
        cache: "no-store",
      });
      if (res.status >= 200 && res.status < 400) {
        const ct = res.headers.get("content-type") ?? "";
        const body = (await res.text()).slice(0, 8000);
        const looksPhp =
          /<\?php|eval\s*\(|FilesMan|WSO|b374k|password|Login/i.test(body) ||
          /php/i.test(ct);
        const notSoft404 =
          body.length > 40 &&
          !/not found|404|pagina non trovata/i.test(body.slice(0, 500));
        if (looksPhp && notSoft404) {
          out.push({
            id: "exposed_shell_path",
            weight: 10,
            severity: "critical",
            title: "Path tipico di backdoor raggiungibile",
            detail: `${path} → HTTP ${res.status}`,
            page: url,
          });
        }
      }
    } catch {
      /* skip */
    }
  });
  return out;
}

function signalsToFindings(
  signals: Signal[],
  pagesScanned: number,
): ScanFinding[] {
  if (signals.length === 0) {
    return [
      {
        type: "malware",
        severity: "info",
        title: "Nessun segnale di compromissione nel crawl",
        description: `Analizzate ${pagesScanned} pagine (HTML live, cloaking, path noti). Nessun indicatore forte.`,
        evidence: { pagesScanned, signals: 0, score: 0 },
        proposedPlan: {
          summary: "Nessuna azione richiesta",
          steps: ["Ripeti lo scan integrity dopo modifiche al sito"],
          risk: "info",
          requiresBackup: false,
        },
      },
    ];
  }

  // Aggrega per id
  const byId = new Map<string, Signal[]>();
  for (const s of signals) {
    const list = byId.get(s.id) ?? [];
    list.push(s);
    byId.set(s.id, list);
  }

  const findings: ScanFinding[] = [];
  for (const [id, group] of byId) {
    const top = group.reduce((a, b) => (a.weight >= b.weight ? a : b));
    const pages = [...new Set(group.map((g) => g.page))].slice(0, 6);
    findings.push({
      type: "malware",
      severity: top.severity,
      title: top.title,
      description: `${top.detail}${
        group.length > 1 ? ` · ${group.length} occorrenze` : ""
      }`,
      evidence: {
        signalId: id,
        weight: top.weight,
        count: group.length,
        pages,
        samples: group.slice(0, 5).map((g) => ({
          page: g.page,
          detail: g.detail,
        })),
      },
      proposedPlan: {
        summary: `Analizzare e rimuovere: ${top.title}`,
        steps: [
          "Aprire le pagine indicate nell'evidence",
          "Confrontare con backup pulito / tema ufficiale",
          "Rimuovere iniezioni (HTML, plugin rogue, file PHP)",
          "Rescan integrity + crawl",
        ],
        risk: top.severity,
        requiresBackup: true,
      },
    });
  }

  // Finding riassuntivo se score alto
  const score = signals.reduce((a, s) => a + s.weight, 0);
  if (score >= 15 && findings.length >= 2) {
    findings.unshift({
      type: "malware",
      severity: "critical",
      title: "Compromissione probabile (multi-segnale)",
      description: `Score ${score} su ${pagesScanned} pagine · ${signals.length} segnali correlati. Intervieni prima di altri task.`,
      evidence: {
        score,
        pagesScanned,
        signalIds: [...byId.keys()],
      },
      proposedPlan: {
        summary: "Incident response: isolamento e cleanup",
        steps: [
          "Mettere il sito in manutenzione se possibile",
          "Backup forense del filesystem",
          "Rimuovere backdoor e iniezioni SEO",
          "Ruotare password admin/SFTP/DB",
          "Rescan completo",
        ],
        risk: "critical",
        requiresBackup: true,
      },
    });
  }

  return findings;
}

async function fetchPage(
  url: string,
  ua: string,
): Promise<PageSnapshot | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/html|xml|text\//i.test(ct)) return null;
    const html = (await res.text()).slice(0, MAX_HTML);
    return { url, html, finalUrl: res.url || url };
  } catch {
    return null;
  }
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = m[1]?.trim();
    if (v && !/^(mailto:|tel:|javascript:|data:)/i.test(v)) out.push(v);
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

function isExternal(href: string, origin: string): boolean {
  try {
    const u = new URL(href, origin);
    return u.origin !== origin;
  } catch {
    return false;
  }
}

function isTrustedCdn(src: string): boolean {
  return /(?:googleapis|gstatic|cloudflare|jsdelivr|unpkg|cdnjs|jquery|bootstrapcdn|fontawesome|stripe|paypal|google-analytics|googletagmanager|facebook\.net|hotjar|clarity\.ms|cookiebot|iubenda|youtube|vimeo|maps\.google)/i.test(
    src,
  );
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) n += m.length;
  }
  return n;
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
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
