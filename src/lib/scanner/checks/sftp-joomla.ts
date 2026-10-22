import type { RemoteFsClient } from "../../sftp/client";
import type { ScanFinding } from "../types";
import { isRiskyPath, scanTextContent } from "../malware-patterns";
import {
  listRecursive,
  modifyTimeToIso,
  readTextFile,
} from "../../sftp/client";

function planDelete(
  filePath: string,
  risk: ScanFinding["proposedPlan"]["risk"],
): ScanFinding["proposedPlan"] {
  return {
    summary: `Quarantena e rimozione di ${filePath}`,
    steps: ["Backup forense", "Eliminare via SFTP", "Rescan"],
    risk,
    requiresBackup: true,
  };
}

function fileEvidence(
  filePath: string,
  extra: Record<string, unknown> = {},
  modifyTime?: number,
): Record<string, unknown> {
  const modifiedAt = modifyTimeToIso(modifyTime);
  return {
    filePath,
    ...extra,
    ...(modifiedAt
      ? { modifiedAt, modifiedAtSource: "ftp_mtime" as const }
      : {}),
  };
}

export async function runJoomlaSftpChecks(
  client: RemoteFsClient,
  root: string,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  let base = root.replace(/\/$/, "") || ".";
  try {
    const { findJoomlaRoot } = await import("../../sftp/paths");
    const found = await findJoomlaRoot(client, base);
    if (found && found.score >= 3) base = found.root;
  } catch {
    /* keep */
  }

  const scanDirs = [
    `${base}/images`,
    `${base}/tmp`,
    `${base}/media`,
    `${base}/cache`,
    `${base}/administrator/cache`,
    `${base}/administrator/tmp`,
  ];

  for (const dir of scanDirs) {
    let files: Awaited<ReturnType<typeof listRecursive>> = [];
    try {
      files = await listRecursive(client, dir, 600);
    } catch {
      continue;
    }

    const phpFiles = files.filter((f) => /\.php$/i.test(f.path));
    const inMedia =
      /\/(images|media|tmp|cache)\//i.test(dir) &&
      !/administrator/i.test(dir);

    if (inMedia && phpFiles.length > 0) {
      findings.push({
        type: "malware",
        severity: "high",
        title: `${phpFiles.length} file PHP in ${dir.split("/").slice(-2).join("/")}`,
        description:
          "In images/media/tmp non dovrebbero esserci PHP eseguibili (spesso backdoor).",
        evidence: {
          sample: phpFiles.slice(0, 15).map((f) => ({
            path: f.path,
            modifiedAt: modifyTimeToIso(f.modifyTime) ?? null,
          })),
          count: phpFiles.length,
          dir,
        },
        proposedPlan: {
          summary: "Rimuovere PHP da cartelle media dopo analisi",
          steps: [
            "Scaricare copia forense",
            "Eliminare file PHP via SFTP",
            "Bloccare esecuzione PHP nella cartella",
          ],
          risk: "high",
          requiresBackup: true,
        },
      });
    }

    for (const file of phpFiles.slice(0, 120)) {
      try {
        const content = await readTextFile(client, file.path);
        const hits = scanTextContent(content, file.path, {
          riskyLocation: isRiskyPath(file.path) || inMedia,
        });
        for (const hit of hits.filter((h) => h.weight >= 5)) {
          findings.push({
            type: "malware",
            severity: hit.severity,
            title: `File sospetto: ${file.path.split("/").pop()}`,
            description: hit.description,
            evidence: fileEvidence(
              file.path,
              { patternId: hit.patternId, weight: hit.weight },
              file.modifyTime,
            ),
            proposedPlan: planDelete(file.path, hit.severity),
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  // Root PHP sospetti (non index/configuration)
  try {
    const entries = await client.list(base);
    for (const entry of entries) {
      if (entry.type !== "-" || !/\.php$/i.test(entry.name)) continue;
      if (
        /^(index|configuration|robots|htaccess)\.php$/i.test(entry.name)
      ) {
        continue;
      }
      const full = `${base}/${entry.name}`;
      try {
        const content = await readTextFile(client, full);
        const hits = scanTextContent(content, full, { riskyLocation: true });
        for (const hit of hits.filter((h) => h.weight >= 5)) {
          findings.push({
            type: "malware",
            severity: hit.severity,
            title: `PHP root sospetto: ${entry.name}`,
            description: hit.description,
            evidence: fileEvidence(
              full,
              { patternId: hit.patternId, weight: hit.weight },
              entry.modifyTime,
            ),
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

  // .htaccess
  try {
    const htPath = `${base}/.htaccess`;
    const ht = await readTextFile(client, htPath);
    let htMtime: number | undefined;
    try {
      htMtime = (await client.stat(htPath)).modifyTime;
    } catch {
      /* ignore */
    }
    const hits = scanTextContent(ht, htPath, {
      riskyLocation: true,
    });
    for (const hit of hits) {
      findings.push({
        type: "malware",
        severity: hit.severity,
        title: ".htaccess sospetto",
        description: hit.description,
        evidence: fileEvidence(
          hit.filePath,
          { patternId: hit.patternId },
          htMtime,
        ),
        proposedPlan: planDelete(hit.filePath, hit.severity),
      });
    }
  } catch {
    /* assente */
  }

  return findings;
}
