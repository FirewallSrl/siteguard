import { prisma } from "../db";
import { decryptSecrets } from "../crypto";
import { runWordpressApiChecks } from "./checks/wordpress-api";
import { runJoomlaApiChecks } from "./checks/joomla-api";
import { checkSsl } from "./checks/ssl";
import { buildDemoFindings } from "./demo-findings";
import type { ScanFinding } from "./types";
import type { SiteInventory } from "./inventory/types";
import {
  createProgressReporter,
  finishScanProgress,
  initScanProgress,
  type ProgressReporter,
} from "./progress";

export async function runSiteScan(siteId: string, scanId: string) {
  initScanProgress(scanId, siteId);
  const progress = createProgressReporter(scanId);

  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  await prisma.scan.update({
    where: { id: scanId },
    data: { status: "running", startedAt: new Date(), error: null },
  });

  progress.start("start", `Analisi di ${site.url}`);

  try {
    const useDemo = process.env.DEMO_SCAN === "true" && !site.secretsEnc;

    let rawFindings: ScanFinding[];
    let inventory: SiteInventory | null = null;

    if (useDemo) {
      progress.done("start");
      progress.skip("ssl", "Modalità demo");
      progress.skip("links", "Modalità demo");
      progress.skip("api", "Modalità demo");
      progress.skip("sftp", "Modalità demo");
      progress.start("inventory", "Inventario demo");
      rawFindings = buildDemoFindings(site.url);
      inventory = {
        collectedAt: new Date().toISOString(),
        cms: site.cms,
        coreVersion: "demo",
        extensions: [],
        themes: [{ name: "Demo Theme", type: "theme", version: "1.0" }],
        plugins: [
          { name: "Demo Plugin", type: "plugin", version: "1.0", enabled: true },
        ],
        notes: ["Inventario demo"],
        source: ["public"],
      };
      progress.done("inventory");
      progress.skip("updates", "Demo");
    } else {
      progress.done("start", "Credenziali e target pronti");
      const live = await collectLive(site, progress);
      rawFindings = live.findings;
      inventory = live.inventory;
    }

    progress.start("save", `Salvataggio di ${rawFindings.length} finding…`);
    await prisma.finding.updateMany({
      where: { siteId, status: "open" },
      data: { status: "resolved" },
    });

    for (const f of rawFindings) {
      const finding = await prisma.finding.create({
        data: {
          siteId,
          scanId,
          type: f.type,
          severity: f.severity,
          title: f.title,
          description: f.description,
          evidence: JSON.stringify(f.evidence ?? {}),
          proposedPlan: JSON.stringify(f.proposedPlan ?? null),
          status: "open",
        },
      });

      const skipAction =
        f.severity === "info" &&
        f.type === "config" &&
        /nessun problema/i.test(f.title);

      if (!skipAction) {
        await prisma.action.create({
          data: {
            siteId,
            findingId: finding.id,
            mode: "ai",
            status: "proposed",
            title: f.proposedPlan?.summary ?? f.title,
            payload: JSON.stringify({
              findingType: f.type,
              plan: f.proposedPlan,
              evidence: f.evidence,
            }),
          },
        });
      }
    }

    const extCount =
      (inventory?.plugins.length ?? 0) +
      (inventory?.extensions.length ?? 0) +
      (inventory?.modules?.length ?? 0);
    const summary = `${rawFindings.length} finding · ${useDemo ? "demo" : "live"}${
      inventory?.coreVersion ? ` · ${inventory.cms} ${inventory.coreVersion}` : ""
    }${extCount ? ` · ${extCount} estensioni` : ""}`;

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "completed", finishedAt: new Date(), summary },
    });

    await prisma.site.update({
      where: { id: siteId },
      data: {
        status: "connected",
        lastScanAt: new Date(),
        inventoryJson: inventory ? JSON.stringify(inventory) : undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        siteId,
        event: "scan.completed",
        detail: JSON.stringify({
          scanId,
          summary,
          demo: useDemo,
          coreVersion: inventory?.coreVersion ?? null,
        }),
      },
    });

    progress.done("save", summary);
    progress.start("done");
    progress.done("done", summary);
    finishScanProgress(scanId, { ok: true, summary });

    return { ok: true as const, summary, count: rawFindings.length, inventory };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan fallito";
    progress.fail("save", message);
    finishScanProgress(scanId, { ok: false, error: message });
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "failed", finishedAt: new Date(), error: message },
    });
    await prisma.site.update({
      where: { id: siteId },
      data: { status: "error" },
    });
    await prisma.auditLog.create({
      data: {
        siteId,
        event: "scan.failed",
        detail: JSON.stringify({ scanId, error: message }),
      },
    });
    throw err;
  }
}

async function collectLive(
  site: {
    id: string;
    url: string;
    cms: string;
    secretsEnc: string | null;
  },
  progress: ProgressReporter,
): Promise<{ findings: ScanFinding[]; inventory: SiteInventory }> {
  const findings: ScanFinding[] = [];
  const inventory: SiteInventory = {
    collectedAt: new Date().toISOString(),
    cms: site.cms,
    extensions: [],
    themes: [],
    plugins: [],
    modules: [],
    notes: [],
    source: ["public"],
  };

  progress.start("ssl", "Verifica certificato…");
  const sslFindings = await checkSsl(site.url);
  findings.push(...sslFindings);
  const https = site.url.startsWith("https:");
  inventory.ssl = { https };
  const sslEv = sslFindings[0]?.evidence as
    | { daysLeft?: number; validTo?: string }
    | undefined;
  if (sslEv?.daysLeft != null) inventory.ssl.daysLeft = sslEv.daysLeft;
  if (sslEv?.validTo) inventory.ssl.validTo = sslEv.validTo;
  progress.done(
    "ssl",
    sslEv?.daysLeft != null
      ? `HTTPS · ${sslEv.daysLeft} giorni residui`
      : https
        ? "HTTPS attivo"
        : "Senza HTTPS",
  );

  progress.start("links", "Crawl pagine e verifica URL…");
  const { checkBrokenLinks } = await import("./checks/broken-links");
  const linkReport = await checkBrokenLinks(site.url);
  findings.push(...linkReport.findings);
  if (linkReport.linksChecked > 0) {
    inventory.notes?.push(
      linkReport.brokenCount > 0
        ? `${linkReport.brokenCount} link rotti su ${linkReport.linksChecked} controllati (${linkReport.pagesScanned} pagine)`
        : `Link check OK: ${linkReport.linksChecked} link su ${linkReport.pagesScanned} pagine`,
    );
  }
  progress.done(
    "links",
    linkReport.linksChecked > 0
      ? `${linkReport.linksChecked} link · ${linkReport.brokenCount} rotti`
      : "Nessun link controllato",
  );

  if (!site.secretsEnc) {
    progress.skip("api", "Nessuna credenziale");
    progress.skip("sftp", "Nessuna credenziale");
    progress.skip("inventory", "Scan parziale");
    progress.skip("updates", "Scan parziale");
    findings.push({
      type: "config",
      severity: "medium",
      title: "Nessuna credenziale: scan parziale",
      description:
        "Eseguiti SSL e link check pubblici. Configura SFTP/API per inventario e integrity.",
      evidence: {},
      proposedPlan: {
        summary: "Aggiungere accessi SFTP e/o API",
        steps: ["Tab Accessi", "Salva", "Testa connessione", "Rescan"],
        risk: "medium",
        requiresBackup: false,
      },
    });
    return { findings, inventory };
  }

  const secrets = decryptSecrets(site.secretsEnc);

  if (site.cms === "wordpress" && secrets.api) {
    progress.start("api", "WordPress REST…");
    findings.push(...(await runWordpressApiChecks(site.url, secrets.api)));
    progress.done("api", "API WordPress OK");
  } else if (site.cms === "joomla" && secrets.api) {
    progress.start("api", "Joomla Web Services…");
    findings.push(...(await runJoomlaApiChecks(site.url, secrets.api)));
    progress.done("api", "API Joomla OK");
  } else {
    progress.skip("api", "API non configurata");
  }

  if (secrets.sftp) {
    progress.start("sftp", `${secrets.sftp.host}…`);
    const { withSftp } = await import("../sftp/client");
    await withSftp(secrets.sftp, async (client, root) => {
      progress.done("sftp", `Connesso · root ${root}`);
      progress.start("inventory", "Lettura filesystem CMS…");

      if (site.cms === "wordpress") {
        const { runWordpressSftpChecks } = await import(
          "./checks/sftp-wordpress"
        );
        progress.setCurrent("Check integrity WordPress…");
        findings.push(...(await runWordpressSftpChecks(client, root)));
        const { collectWordpressInventory } = await import(
          "./inventory/wordpress"
        );
        progress.setCurrent("Inventario plugin e temi…");
        const inv = await collectWordpressInventory({
          siteUrl: site.url,
          api: secrets.api,
          sftp: { client, root },
        });
        Object.assign(inventory, inv);
        inventory.ssl = inventory.ssl ?? { https };
        if (sslEv?.daysLeft != null) inventory.ssl.daysLeft = sslEv.daysLeft;
        if (sslEv?.validTo) inventory.ssl.validTo = sslEv.validTo;
      } else {
        const { listRecursive, readTextFile } = await import("../sftp/client");
        const { scanTextContent } = await import("./malware-patterns");
        progress.setCurrent("Scan malware images/tmp…");
        for (const dir of [`${root}/images`, `${root}/tmp`]) {
          let files: string[] = [];
          try {
            files = await listRecursive(client, dir, 200);
          } catch {
            continue;
          }
          for (const file of files
            .filter((f) => f.toLowerCase().endsWith(".php"))
            .slice(0, 40)) {
            try {
              const content = await readTextFile(client, file);
              for (const hit of scanTextContent(content, file)) {
                findings.push({
                  type: "malware",
                  severity: hit.severity,
                  title: `File sospetto: ${file.split("/").pop()}`,
                  description: hit.description,
                  evidence: { filePath: file, patternId: hit.patternId },
                  proposedPlan: {
                    summary: `Rimuovere ${file}`,
                    steps: ["Backup", "Delete SFTP", "Rescan"],
                    risk: hit.severity as "medium" | "high" | "critical",
                    requiresBackup: true,
                  },
                });
              }
            } catch {
              /* skip */
            }
          }
        }

        progress.setCurrent("Inventario componenti / plugin / moduli…");
        const { collectJoomlaInventory } = await import("./inventory/joomla");
        const inv = await collectJoomlaInventory({
          siteUrl: site.url,
          api: secrets.api,
          sftp: { client, root },
        });
        Object.assign(inventory, inv);
        inventory.ssl = inventory.ssl ?? { https };
        if (sslEv?.daysLeft != null) inventory.ssl.daysLeft = sslEv.daysLeft;
        if (sslEv?.validTo) inventory.ssl.validTo = sslEv.validTo;
      }

      const extCount =
        inventory.plugins.length +
        inventory.extensions.length +
        (inventory.modules?.length ?? 0);
      progress.done(
        "inventory",
        inventory.coreVersion
          ? `${inventory.cms} ${inventory.coreVersion} · ${extCount} estensioni`
          : `${extCount} estensioni`,
      );
    });
  } else if (secrets.api) {
    progress.skip("sftp", "Solo API");
    progress.start("inventory", "Inventario via API…");
    if (site.cms === "wordpress") {
      const { collectWordpressInventory } = await import(
        "./inventory/wordpress"
      );
      const inv = await collectWordpressInventory({
        siteUrl: site.url,
        api: secrets.api,
      });
      Object.assign(inventory, inv);
    } else {
      const { collectJoomlaInventory } = await import("./inventory/joomla");
      const inv = await collectJoomlaInventory({
        siteUrl: site.url,
        api: secrets.api,
      });
      Object.assign(inventory, inv);
    }
    inventory.ssl = inventory.ssl ?? { https };
    progress.done("inventory", "Inventario API completato");
  } else {
    progress.skip("sftp", "SFTP non configurato");
    progress.skip("inventory", "Nessuna fonte inventario");
  }

  progress.start("updates", "Confronto versioni ufficiali…");
  {
    const { enrichInventoryUpdates } = await import("./inventory/updates");
    const updateFindings = await enrichInventoryUpdates(inventory);
    const existingCore = findings.some((f) => f.type === "update_core");
    for (const f of updateFindings) {
      if (f.type === "update_core" && existingCore) continue;
      findings.push(f);
    }
    progress.done(
      "updates",
      inventory.coreUpdateAvailable
        ? `Core → ${inventory.coreLatest}`
        : `${inventory.updatesPending ?? 0} update totali`,
    );
  }

  if (findings.length === 0) {
    findings.push({
      type: "config",
      severity: "info",
      title: "Nessun problema critico rilevato",
      description:
        "Scan completato senza finding prioritari. Vedi la tab Panoramica per l'inventario.",
      evidence: {},
      proposedPlan: {
        summary: "Nessuna azione richiesta",
        steps: ["Consulta inventario", "Ripeti scan periodicamente"],
        risk: "info",
        requiresBackup: false,
      },
    });
  }

  return { findings, inventory };
}
