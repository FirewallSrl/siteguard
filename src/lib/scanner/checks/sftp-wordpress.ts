import type { RemoteFsClient } from "../../sftp/client";
import type { ScanFinding } from "../types";
import { isRiskyPath, scanTextContent } from "../malware-patterns";
import { listRecursive, readTextFile } from "../../sftp/client";

function planDelete(filePath: string, risk: ScanFinding["proposedPlan"]["risk"]): ScanFinding["proposedPlan"] {
  return {
    summary: `Quarantena e rimozione di ${filePath}`,
    steps: ["Backup forense", "Eliminare via SFTP", "Rescan"],
    risk,
    requiresBackup: true,
  };
}

export async function runWordpressSftpChecks(
  client: RemoteFsClient,
  root: string,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const base = root.replace(/\/$/, "");

  // --- Core version ---
  try {
    const versionPhp = await readTextFile(
      client,
      `${base}/wp-includes/version.php`,
    );
    const match = versionPhp.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) {
      const current = match[1];
      const latest = await fetchLatestWpCore().catch(() => null);
      if (latest && compareSemver(current, latest) < 0) {
        findings.push({
          type: "update_core",
          severity: "high",
          title: "WordPress core non aggiornato",
          description: `${current} → disponibile ${latest}`,
          evidence: { current, latest },
          proposedPlan: {
            summary: `Aggiornare WordPress core a ${latest}`,
            steps: [
              "Backup completo",
              "Aggiornare core (wp-admin / WP-CLI / API)",
              "Verificare sito e admin",
            ],
            risk: "high",
            requiresBackup: true,
          },
        });
      }
    }
  } catch {
    /* non WP o path errato */
  }

  // --- wp-config hardening ---
  try {
    const config = await readTextFile(client, `${base}/wp-config.php`);
    if (/WP_DEBUG\s*,\s*true/i.test(config)) {
      findings.push({
        type: "config",
        severity: "medium",
        title: "WP_DEBUG attivo in produzione",
        description: "Il debug espone errori e path interni.",
        evidence: { flag: "WP_DEBUG" },
        proposedPlan: {
          summary: "Disabilitare WP_DEBUG",
          steps: ["Impostare WP_DEBUG a false", "Rimuovere display_errors"],
          risk: "medium",
          requiresBackup: true,
        },
      });
    }
    if (!/DISALLOW_FILE_EDIT\s*,\s*true/i.test(config)) {
      findings.push({
        type: "config",
        severity: "low",
        title: "DISALLOW_FILE_EDIT non attivo",
        description:
          "Consigliato bloccare l'editor file da wp-admin per ridurre persistenza.",
        evidence: { flag: "DISALLOW_FILE_EDIT" },
        proposedPlan: {
          summary: "Aggiungere DISALLOW_FILE_EDIT true in wp-config",
          steps: ["Backup wp-config", "Aggiungere define", "Verificare admin"],
          risk: "low",
          requiresBackup: true,
        },
      });
    }
    if (/FORCE_SSL_ADMIN\s*,\s*false/i.test(config)) {
      findings.push({
        type: "config",
        severity: "medium",
        title: "FORCE_SSL_ADMIN disabilitato",
        description: "L'admin dovrebbe forzare HTTPS.",
        evidence: { flag: "FORCE_SSL_ADMIN" },
        proposedPlan: {
          summary: "Abilitare FORCE_SSL_ADMIN",
          steps: ["define('FORCE_SSL_ADMIN', true);"],
          risk: "medium",
          requiresBackup: true,
        },
      });
    }
  } catch {
    /* config non leggibile */
  }

  // --- .htaccess ---
  try {
    const ht = await readTextFile(client, `${base}/.htaccess`);
    const hits = scanTextContent(ht, `${base}/.htaccess`, {
      riskyLocation: true,
    });
    for (const hit of hits) {
      findings.push({
        type: "malware",
        severity: hit.severity,
        title: ".htaccess sospetto",
        description: hit.description,
        evidence: {
          filePath: hit.filePath,
          patternId: hit.patternId,
          weight: hit.weight,
        },
        proposedPlan: planDelete(hit.filePath, hit.severity),
      });
    }
    if (/RewriteRule[\s\S]{0,120}https?:\/\/(?!www\.)[^\s]+/i.test(ht)) {
      findings.push({
        type: "malware",
        severity: "high",
        title: "Redirect sospetto in .htaccess",
        description: "Possibile redirect verso dominio esterno.",
        evidence: { filePath: `${base}/.htaccess` },
        proposedPlan: {
          summary: "Revisionare regole RewriteRule in .htaccess",
          steps: ["Backup .htaccess", "Rimuovere redirect non autorizzati"],
          risk: "high",
          requiresBackup: true,
        },
      });
    }
  } catch {
    /* assente */
  }

  // --- PHP in path rischiosi ---
  const scanDirs = [
    `${base}/wp-content/uploads`,
    `${base}/wp-content/cache`,
    `${base}/wp-content/upgrade`,
    `${base}/wp-content/mu-plugins`,
    `${base}/.well-known`,
  ];

  for (const dir of scanDirs) {
    let files: string[] = [];
    try {
      files = await listRecursive(client, dir, 1200);
    } catch {
      continue;
    }
    const phpFiles = files.filter((f) => /\.php$/i.test(f));
    const inUploads = /\/uploads/i.test(dir);

    if (inUploads && phpFiles.length > 0) {
      findings.push({
        type: "malware",
        severity: "high",
        title: `${phpFiles.length} file PHP in uploads`,
        description:
          "In uploads non dovrebbero esserci PHP eseguibili (spesso backdoor).",
        evidence: { sample: phpFiles.slice(0, 20), count: phpFiles.length },
        proposedPlan: {
          summary: "Rimuovere PHP da uploads dopo analisi",
          steps: [
            "Scaricare copia forense",
            "Eliminare file PHP via SFTP",
            "Bloccare esecuzione PHP in uploads via .htaccess",
          ],
          risk: "high",
          requiresBackup: true,
        },
      });
    }

    for (const file of phpFiles.slice(0, 150)) {
      try {
        const content = await readTextFile(client, file);
        const hits = scanTextContent(content, file, {
          riskyLocation: isRiskyPath(file) || inUploads,
        });
        for (const hit of hits.filter((h) => h.weight >= 5 || inUploads)) {
          findings.push({
            type: "malware",
            severity: hit.severity,
            title: `File sospetto: ${file.split("/").pop()}`,
            description: hit.description,
            evidence: {
              filePath: file,
              patternId: hit.patternId,
              weight: hit.weight,
            },
            proposedPlan: planDelete(file, hit.severity),
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  // --- Drop-in / PHP in wp-content root ---
  try {
    const entries = await client.list(`${base}/wp-content`);
    for (const entry of entries) {
      if (entry.type !== "-" || !/\.php$/i.test(entry.name)) continue;
      const full = `${base}/wp-content/${entry.name}`;
      try {
        const content = await readTextFile(client, full);
        const hits = scanTextContent(content, full, { riskyLocation: true });
        for (const hit of hits.filter((h) => h.weight >= 5)) {
          findings.push({
            type: "malware",
            severity: hit.severity,
            title: `Drop-in sospetto: ${entry.name}`,
            description: hit.description,
            evidence: {
              filePath: full,
              patternId: hit.patternId,
              weight: hit.weight,
            },
            proposedPlan: planDelete(full, hit.severity),
          });
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }

  // --- Root site: PHP non standard ---
  try {
    const entries = await client.list(base);
    const allowRoot = new Set([
      "index.php",
      "wp-config.php",
      "wp-login.php",
      "wp-settings.php",
      "wp-cron.php",
      "wp-load.php",
      "wp-blog-header.php",
      "wp-comments-post.php",
      "wp-activate.php",
      "wp-signup.php",
      "wp-trackback.php",
      "xmlrpc.php",
    ]);
    for (const entry of entries) {
      if (entry.type !== "-" || !/\.php$/i.test(entry.name)) continue;
      if (allowRoot.has(entry.name)) continue;
      const full = `${base}/${entry.name}`;
      findings.push({
        type: "malware",
        severity: "high",
        title: `PHP non standard in root: ${entry.name}`,
        description:
          "File PHP inatteso nella root WordPress — verificare se legittimo.",
        evidence: { filePath: full },
        proposedPlan: planDelete(full, "high"),
      });
      try {
        const content = await readTextFile(client, full);
        for (const hit of scanTextContent(content, full, {
          riskyLocation: true,
        })) {
          findings.push({
            type: "malware",
            severity: hit.severity,
            title: `Root sospetta: ${entry.name}`,
            description: hit.description,
            evidence: {
              filePath: full,
              patternId: hit.patternId,
              weight: hit.weight,
            },
            proposedPlan: planDelete(full, hit.severity),
          });
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }

  // --- Integrità core (sample ampliato) ---
  try {
    const versionPhp = await readTextFile(
      client,
      `${base}/wp-includes/version.php`,
    );
    const match = versionPhp.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) {
      const checksums = await fetchCoreChecksums(match[1]).catch(() => null);
      if (checksums) {
        const samples = [
          "wp-includes/version.php",
          "wp-login.php",
          "wp-settings.php",
          "wp-load.php",
          "wp-includes/functions.php",
          "wp-includes/class-wp.php",
          "wp-admin/admin.php",
          "wp-admin/includes/file.php",
        ];
        let mismatches = 0;
        const evidenceFiles: Array<Record<string, string>> = [];
        for (const rel of samples) {
          const expected = checksums[rel];
          if (!expected) continue;
          try {
            const buf = (await client.get(`${base}/${rel}`)) as Buffer;
            const crypto = await import("crypto");
            const actual = crypto.createHash("md5").update(buf).digest("hex");
            if (actual !== expected) {
              mismatches += 1;
              evidenceFiles.push({ file: rel, expected, actual });
              findings.push({
                type: "malware",
                severity: "critical",
                title: `Integrità core alterata: ${rel}`,
                description:
                  "Checksum MD5 diverso da WordPress.org — possibile tampolamento.",
                evidence: { file: rel, expected, actual, version: match[1] },
                proposedPlan: {
                  summary: `Ripristinare ${rel} dal core ufficiale`,
                  steps: [
                    "Backup file corrente",
                    "Sostituire con file ufficiale WP",
                    "Rescan integrity",
                  ],
                  risk: "critical",
                  requiresBackup: true,
                },
              });
            }
          } catch {
            /* skip file */
          }
        }
        if (mismatches >= 2) {
          findings.push({
            type: "malware",
            severity: "critical",
            title: `Core WordPress compromesso (${mismatches} file)`,
            description:
              "Più file core non corrispondono ai checksum ufficiali — ripristino core consigliato.",
            evidence: { version: match[1], mismatches, files: evidenceFiles },
            proposedPlan: {
              summary: "Reinstallare i file core da WordPress.org",
              steps: [
                "Backup completo",
                "Sostituire wp-admin e wp-includes da pacchetto ufficiale",
                "Non sovrascrivere wp-config.php / wp-content",
                "Rescan integrity",
              ],
              risk: "critical",
              requiresBackup: true,
            },
          });
        }
      }
    }
  } catch {
    /* skip */
  }

  return findings;
}

async function fetchLatestWpCore(): Promise<string | null> {
  const res = await fetch("https://api.wordpress.org/core/version-check/1.7/", {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    offers?: Array<{ version?: string; response?: string }>;
  };
  const offer = data.offers?.find((o) => o.response === "upgrade" || o.version);
  return offer?.version ?? data.offers?.[0]?.version ?? null;
}

async function fetchCoreChecksums(
  version: string,
): Promise<Record<string, string> | null> {
  const res = await fetch(
    `https://api.wordpress.org/core/checksums/1.0/?version=${encodeURIComponent(version)}&locale=en_US`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    checksums?: Record<string, string>;
  };
  return data.checksums ?? null;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
