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
import {
  SCAN_SCOPE_DEFS,
  findingMatchesScope,
  parseScanScope,
  progressStepsForScope,
  scopeHas,
  type ScanScope,
} from "./scopes";

export async function runSiteScan(
  siteId: string,
  scanId: string,
  scopeInput: ScanScope | string = "full",
) {
  const scope = parseScanScope(scopeInput);
  const scopeDef = SCAN_SCOPE_DEFS[scope];

  initScanProgress(scanId, siteId, {
    scope,
    steps: progressStepsForScope(scope),
  });
  const progress = createProgressReporter(scanId);

  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  await prisma.scan.update({
    where: { id: scanId },
    data: { status: "running", startedAt: new Date(), error: null },
  });

  progress.start(
    "start",
    scope === "full"
      ? `Analisi completa di ${site.url}`
      : `${scopeDef.label} · ${site.url}`,
  );

  try {
    const useDemo = process.env.DEMO_SCAN === "true" && !site.secretsEnc;

    let rawFindings: ScanFinding[];
    let inventory: SiteInventory | null = null;

    if (useDemo) {
      progress.done("start");
      for (const id of ["ssl", "links", "api", "sftp", "inventory", "updates"] as const) {
        if (scopeHas(scope, id) || scope === "full") {
          progress.skip(id, "Modalità demo");
        }
      }
      progress.start("inventory", "Inventario demo");
      rawFindings = buildDemoFindings(site.url);
      if (scope !== "full") {
        rawFindings = rawFindings.filter((f) => findingMatchesScope(f, scope));
      }
      inventory = {
        collectedAt: new Date().toISOString(),
        cms: site.cms,
        coreVersion: "demo",
        extensions: [],
        themes: [{ name: "Demo Theme", type: "theme", version: "1.0" }],
        plugins: [
          { name: "Demo Plugin", type: "plugin", version: "1.0", enabled: true },
        ],
        notes: [`Inventario demo · scope ${scope}`],
        source: ["public"],
      };
      progress.done("inventory");
      progress.skip("updates", "Demo");
    } else {
      progress.done("start", "Credenziali e target pronti");
      const live = await collectLive(
        {
          id: site.id,
          url: site.url,
          cms: site.cms,
          secretsEnc: site.secretsEnc,
          inventoryJson: site.inventoryJson,
        },
        progress,
        scope,
      );
      rawFindings = live.findings;
      inventory = live.inventory;
    }

    progress.start("save", `Salvataggio di ${rawFindings.length} finding…`);

    if (scope === "full") {
      await prisma.finding.updateMany({
        where: { siteId, status: "open" },
        data: { status: "resolved" },
      });
    } else if (scopeDef.findingTypes.length > 0) {
      const open = await prisma.finding.findMany({
        where: { siteId, status: "open" },
        select: { id: true, type: true, title: true },
      });
      const toResolve = open
        .filter((f) => findingMatchesScope(f, scope))
        .map((f) => f.id);
      if (toResolve.length > 0) {
        await prisma.finding.updateMany({
          where: { id: { in: toResolve } },
          data: { status: "resolved" },
        });
      }
    }

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
        ((f.type === "config" && /nessun problema/i.test(f.title)) ||
          (f.type === "broken_link" && /nessun url rotto/i.test(f.title)) ||
          (f.type === "malware" && /nessun segnale di compromissione/i.test(f.title)));

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
              scope,
            }),
          },
        });
      }
    }

    const extCount =
      (inventory?.plugins.length ?? 0) +
      (inventory?.extensions.length ?? 0) +
      (inventory?.modules?.length ?? 0);
    const scopeLabel = scope === "full" ? "completa" : scopeDef.short;
    const summary = `${rawFindings.length} finding · ${scopeLabel}${
      useDemo ? " · demo" : " · live"
    }${
      inventory?.coreVersion ? ` · ${inventory.cms} ${inventory.coreVersion}` : ""
    }${extCount ? ` · ${extCount} estensioni` : ""}`;

    const inventoryPayload =
      inventory &&
      (scope === "full" ||
        scope === "ssl" ||
        scope === "integrity" ||
        scope === "links" ||
        scopeHas(scope, "inventory") ||
        scopeHas(scope, "php") ||
        scopeHas(scope, "updates"))
        ? await mergeInventory(site.inventoryJson, inventory, scope)
        : undefined;

    await prisma.site.update({
      where: { id: siteId },
      data: {
        status: "connected",
        lastScanAt: new Date(),
        ...(inventoryPayload
          ? { inventoryJson: JSON.stringify(inventoryPayload) }
          : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        siteId,
        event: "scan.completed",
        detail: JSON.stringify({
          scanId,
          summary,
          scope,
          demo: useDemo,
          coreVersion: inventory?.coreVersion ?? null,
        }),
      },
    });

    // Progress must be finished before DB status=completed, otherwise the
    // client stops polling with "save" still active.
    progress.done("save", summary);
    progress.start("done");
    progress.done("done", summary);
    finishScanProgress(scanId, { ok: true, summary });

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "completed", finishedAt: new Date(), summary },
    });

    return { ok: true as const, summary, count: rawFindings.length, inventory, scope };
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
        detail: JSON.stringify({ scanId, scope, error: message }),
      },
    });
    throw err;
  }
}

async function mergeInventory(
  existingJson: string | null,
  next: SiteInventory,
  scope: ScanScope,
): Promise<SiteInventory> {
  const { dedupeInventoryNotes } = await import("./inventory/types");
  if (scope === "full" || !existingJson) {
    return {
      ...next,
      notes: dedupeInventoryNotes(next.notes ?? []),
    };
  }
  try {
    const prev = JSON.parse(existingJson) as SiteInventory;
    const mergedNotes = dedupeInventoryNotes([
      ...(prev.notes ?? []),
      ...(next.notes ?? []),
    ]).slice(-12);
    return {
      ...prev,
      ...next,
      ssl: next.ssl ?? prev.ssl,
      brokenLinks: next.brokenLinks ?? prev.brokenLinks,
      phpVersion: next.phpVersion ?? prev.phpVersion,
      phpSource: next.phpSource ?? prev.phpSource,
      phpAdvisories: next.phpAdvisories ?? prev.phpAdvisories,
      plugins: next.plugins?.length ? next.plugins : prev.plugins,
      themes: next.themes?.length ? next.themes : prev.themes,
      extensions: next.extensions?.length ? next.extensions : prev.extensions,
      modules: next.modules?.length ? next.modules : prev.modules,
      notes: mergedNotes,
      source: Array.from(new Set([...(prev.source ?? []), ...(next.source ?? [])])),
      collectedAt: next.collectedAt || prev.collectedAt,
    };
  } catch {
    return {
      ...next,
      notes: dedupeInventoryNotes(next.notes ?? []),
    };
  }
}

async function collectLive(
  site: {
    id: string;
    url: string;
    cms: string;
    secretsEnc: string | null;
    inventoryJson?: string | null;
  },
  progress: ProgressReporter,
  scope: ScanScope,
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

  // Seed from previous inventory when doing updates-only style work
  if (
    site.inventoryJson &&
    (scope === "updates" ||
      scope === "inventory" ||
      scope === "integrity" ||
      scope === "php")
  ) {
    try {
      const { dedupeInventoryNotes } = await import("./inventory/types");
      const prev = JSON.parse(site.inventoryJson) as SiteInventory;
      Object.assign(inventory, prev, {
        collectedAt: new Date().toISOString(),
        notes: dedupeInventoryNotes(prev.notes ?? []),
      });
    } catch {
      /* ignore */
    }
  }

  let sslEv: { daysLeft?: number; validTo?: string } | undefined;
  const https = site.url.startsWith("https:");

  // SSL: sempre in scope "ssl"/full; altrimenti probe se manca in inventario
  // (evita "No HTTPS" falso dopo scan inventory/integrity).
  const shouldCheckSsl = scopeHas(scope, "ssl") || !inventory.ssl;
  if (shouldCheckSsl) {
    if (scopeHas(scope, "ssl")) {
      progress.start("ssl", "Verifica certificato…");
    }
    const sslResult = await checkSsl(site.url);
    inventory.ssl = sslResult.ssl;
    if (scopeHas(scope, "ssl")) {
      findings.push(...sslResult.findings);
    } else {
      // Probe silenzioso: solo scadenze critiche/alte
      findings.push(
        ...sslResult.findings.filter(
          (f) => f.severity === "critical" || f.severity === "high",
        ),
      );
    }
    sslEv =
      sslResult.ssl.daysLeft != null || sslResult.ssl.validTo
        ? {
            daysLeft: sslResult.ssl.daysLeft,
            validTo: sslResult.ssl.validTo,
          }
        : undefined;
    if (scopeHas(scope, "ssl")) {
      progress.done(
        "ssl",
        sslEv?.daysLeft != null
          ? `HTTPS · ${sslEv.daysLeft} giorni residui${
              sslEv.validTo
                ? ` · scade ${sslEv.validTo.slice(0, 10)}`
                : ""
            }`
          : inventory.ssl.https
            ? "HTTPS attivo"
            : "Senza HTTPS",
      );
    }
  }

  if (scopeHas(scope, "links")) {
    progress.start("links", "Crawl pagine, link e anti-hack…");
    const { checkBrokenLinks } = await import("./checks/broken-links");
    const linkReport = await checkBrokenLinks(site.url);
    findings.push(...linkReport.findings);
    inventory.brokenLinks = {
      pagesScanned: linkReport.pagesScanned,
      linksChecked: linkReport.linksChecked,
      brokenCount: linkReport.brokenCount,
      items: linkReport.items.map((b) => ({
        url: b.url,
        status: b.status,
        from: b.from,
        error: b.error ?? null,
      })),
    };

    progress.setCurrent("Crawl compromissione (HTML / cloaking / path)…");
    const { crawlCompromiseSignals } = await import(
      "./checks/compromise-crawl"
    );
    const compromise = await crawlCompromiseSignals(site.url);
    // In scope "links" salva solo malware con severity > info, oppure tutto in full/integrity
    const compromiseFindings =
      scope === "links"
        ? compromise.findings.filter(
            (f) => f.type === "malware" && f.severity !== "info",
          )
        : compromise.findings;
    findings.push(...compromiseFindings);
    inventory.notes?.push(
      compromise.signals > 0
        ? `Anti-hack crawl: ${compromise.signals} segnali · score ${compromise.score} (${compromise.pagesScanned} pagine)`
        : `Anti-hack crawl OK: ${compromise.pagesScanned} pagine senza segnali forti`,
    );

    inventory.notes?.push(
      linkReport.brokenCount > 0
        ? `${linkReport.brokenCount} URL rotti su ${linkReport.linksChecked} controllati (${linkReport.pagesScanned} pagine)`
        : `URL check OK: ${linkReport.linksChecked} link su ${linkReport.pagesScanned} pagine`,
    );
    progress.done(
      "links",
      `${linkReport.linksChecked} URL · ${linkReport.brokenCount} rotti · hack score ${compromise.score}`,
    );
  }

  // PHP: header subito; se c'è SFTP/FTP non chiudere lo step — il probe raffina dopo
  let phpFinalized = false;
  if (scopeHas(scope, "php")) {
    progress.start("php", "Rilevamento versione PHP…");
    const phpFindings = await runPhpAdvisoryCheck(site.url, inventory, {
      deferMissingNote: Boolean(site.secretsEnc),
    });
    findings.push(...phpFindings);
    if (inventory.phpVersion) {
      progress.done(
        "php",
        `PHP ${inventory.phpVersion}${
          inventory.phpAdvisories?.length
            ? ` · ${inventory.phpAdvisories.length} advisory`
            : " · ok"
        }`,
      );
      phpFinalized = true;
    } else if (!site.secretsEnc) {
      progress.done("php", "Versione PHP non esposta (header nascosti)");
      phpFinalized = true;
    } else {
      progress.setCurrent("Header nascosti — attendo probe FTP/SFTP…");
    }
  }

  const needsCreds =
    scopeHas(scope, "api") ||
    scopeHas(scope, "sftp") ||
    scopeHas(scope, "inventory") ||
    scopeHas(scope, "updates");

  if (needsCreds && !site.secretsEnc) {
    if (scopeHas(scope, "api")) progress.skip("api", "Nessuna credenziale");
    if (scopeHas(scope, "sftp")) progress.skip("sftp", "Nessuna credenziale");
    if (scopeHas(scope, "inventory")) progress.skip("inventory", "Scan parziale");
    if (scopeHas(scope, "updates")) progress.skip("updates", "Scan parziale");
    if (
      scope === "full" ||
      scope === "inventory" ||
      scope === "updates" ||
      scope === "integrity"
    ) {
      findings.push({
        type: "config",
        severity: "medium",
        title: "Nessuna credenziale: scan parziale",
        description:
          "Eseguiti i check pubblici disponibili. Configura SFTP/API per inventario e integrity.",
        evidence: { scope },
        proposedPlan: {
          summary: "Aggiungere accessi SFTP e/o API",
          steps: ["Tab Accessi", "Salva", "Testa connessione", "Rescan"],
          risk: "medium",
          requiresBackup: false,
        },
      });
    }
    return { findings, inventory };
  }

  const secrets = site.secretsEnc ? decryptSecrets(site.secretsEnc) : null;

  if (secrets && scopeHas(scope, "api")) {
    if (site.cms === "wordpress" && secrets.api) {
      progress.start("api", "WordPress REST…");
      const apiFindings = await runWordpressApiChecks(site.url, secrets.api);
      findings.push(
        ...(scope === "integrity" || scope === "full"
          ? apiFindings
          : scope === "updates"
            ? apiFindings.filter((f) =>
                ["update_core", "update_plugin", "update_theme"].includes(f.type),
              )
            : apiFindings.filter((f) => f.type === "config")),
      );
      progress.done("api", "API WordPress OK");
    } else if (site.cms === "joomla" && secrets.api) {
      progress.start("api", "Joomla Web Services…");
      findings.push(...(await runJoomlaApiChecks(site.url, secrets.api)));
      progress.done("api", "API Joomla OK");
    } else {
      progress.skip("api", "API non configurata");
    }
  }

  const runSftpBlock =
    secrets &&
    (scopeHas(scope, "sftp") ||
      scopeHas(scope, "inventory") ||
      scopeHas(scope, "updates") ||
      scope === "integrity");

  // Sessione FTP dedicata solo al PHP: un put fallito non deve chiudere
  // la sessione usata poi per inventario/integrity.
  if (secrets?.sftp && scopeHas(scope, "php") && !inventory.phpVersion) {
    const { withSftp } = await import("../sftp/client");
    try {
      progress.setCurrent("Rilevamento PHP via FTP (sessione dedicata)…");
      await withSftp(secrets.sftp, async (client, root) => {
        const hit = await detectPhpOverFs(client, root, site.url, site.cms);
        if (!hit) return;
        await applyPhpHit(inventory, findings, hit);
        const detail = `PHP ${hit.version} via ${hit.source}${
          inventory.phpAdvisories?.length
            ? ` · ${inventory.phpAdvisories.length} advisory`
            : " · ok"
        }`;
        progress.done("php", detail);
        phpFinalized = true;
      });
    } catch (err) {
      inventory.notes?.push(
        `PHP probe: sessione FTP interrotta (${
          err instanceof Error ? err.message.slice(0, 120) : "errore"
        })`,
      );
    }
    // Se fallisce, non chiudere lo step: retry nella sessione inventario sotto.
  }

  if (secrets?.sftp && runSftpBlock) {
    const transferProto = (secrets.sftp.protocol ?? "sftp").toUpperCase();
    progress.start("sftp", `${transferProto} ${secrets.sftp.host}…`);
    const { withSftp } = await import("../sftp/client");
    await withSftp(secrets.sftp, async (client, root) => {
      // Riposiziona automaticamente sulla docroot CMS se la root salvata è genitore/errata
      let effectiveRoot = root;
      try {
        progress.setCurrent("Ricerca docroot CMS…");
        if (site.cms === "joomla") {
          const { findJoomlaRoot } = await import("../sftp/paths");
          const found = await findJoomlaRoot(client, root);
          if (found && found.score >= 3) {
            effectiveRoot = found.root;
            inventory.fsRoot = found.root;
            if (found.root !== root) {
              inventory.notes?.push(
                `Docroot riposizionata: ${root} → ${found.root}`,
              );
            }
          }
        } else if (site.cms === "wordpress") {
          const { findWordpressRoot } = await import("../sftp/paths");
          const found = await findWordpressRoot(client, root);
          if (found && found.score >= 3) {
            effectiveRoot = found.root;
            inventory.fsRoot = found.root;
            if (found.root !== root) {
              inventory.notes?.push(
                `Docroot riposizionata: ${root} → ${found.root}`,
              );
            }
          }
        }
      } catch {
        /* keep root */
      }

      progress.done(
        "sftp",
        `${transferProto} · root ${effectiveRoot}${
          secrets.sftp!.port ? ` · :${secrets.sftp!.port}` : ""
        }`,
      );

      // Fallback PHP se la sessione dedicata non ha trovato nulla
      if (scopeHas(scope, "php") && !inventory.phpVersion) {
        progress.setCurrent("Retry PHP su docroot CMS…");
        const hit = await detectPhpOverFs(
          client,
          effectiveRoot,
          site.url,
          site.cms,
        );
        if (hit) {
          await applyPhpHit(inventory, findings, hit);
          progress.done(
            "php",
            `PHP ${hit.version} via ${hit.source}`,
          );
          phpFinalized = true;
        } else if (!phpFinalized) {
          progress.done("php", "PHP non rilevato");
          phpFinalized = true;
        }
      } else if (scopeHas(scope, "php") && !phpFinalized) {
        progress.done(
          "php",
          inventory.phpVersion
            ? `PHP ${inventory.phpVersion}`
            : "PHP non rilevato",
        );
        phpFinalized = true;
      }

      if (scopeHas(scope, "inventory") || scope === "integrity" || scope === "updates") {
        progress.start("inventory", "Lettura filesystem CMS…");
      }

      if (site.cms === "wordpress") {
        if (scope === "full" || scope === "integrity" || scope === "updates") {
          const { runWordpressSftpChecks } = await import(
            "./checks/sftp-wordpress"
          );
          progress.setCurrent("Check integrity WordPress…");
          const sftpFindings = await runWordpressSftpChecks(
            client,
            effectiveRoot,
          );
          findings.push(
            ...(scope === "updates"
              ? sftpFindings.filter((f) => f.type === "update_core")
              : scope === "integrity"
                ? sftpFindings.filter((f) =>
                    ["malware", "config"].includes(f.type),
                  )
                : sftpFindings),
          );
        }

        if (scopeHas(scope, "inventory") || scope === "updates" || scope === "integrity") {
          const { collectWordpressInventory } = await import(
            "./inventory/wordpress"
          );
          progress.setCurrent("Inventario plugin e temi…");
          const inv = await collectWordpressInventory({
            siteUrl: site.url,
            api: secrets.api,
            sftp: { client, root: effectiveRoot },
          });
          Object.assign(inventory, inv);
          inventory.ssl = inventory.ssl ?? { https };
          if (sslEv?.daysLeft != null) inventory.ssl.daysLeft = sslEv.daysLeft;
          if (sslEv?.validTo) inventory.ssl.validTo = sslEv.validTo;
          if (inventory.fsRoot) effectiveRoot = inventory.fsRoot;
        }
      } else {
        if (scope === "full" || scope === "integrity") {
          const { runJoomlaSftpChecks } = await import("./checks/sftp-joomla");
          progress.setCurrent("Check integrity Joomla…");
          findings.push(
            ...(await runJoomlaSftpChecks(client, effectiveRoot)),
          );
        }

        if (scopeHas(scope, "inventory") || scope === "updates" || scope === "integrity") {
          progress.setCurrent("Inventario componenti / plugin / moduli…");
          const { collectJoomlaInventory } = await import("./inventory/joomla");
          const inv = await collectJoomlaInventory({
            siteUrl: site.url,
            api: secrets.api,
            sftp: { client, root: effectiveRoot },
          });
          Object.assign(inventory, inv);
          inventory.ssl = inventory.ssl ?? { https };
          if (sslEv?.daysLeft != null) inventory.ssl.daysLeft = sslEv.daysLeft;
          if (sslEv?.validTo) inventory.ssl.validTo = sslEv.validTo;
          if (inventory.fsRoot) effectiveRoot = inventory.fsRoot;
        }
      }

      // Persisti root corretta se diversa da quella salvata
      if (
        inventory.fsRoot &&
        secrets.sftp &&
        inventory.fsRoot !== secrets.sftp.rootPath
      ) {
        try {
          const { encryptSecrets } = await import("../crypto");
          const nextSecrets = {
            ...secrets,
            sftp: { ...secrets.sftp, rootPath: inventory.fsRoot },
          };
          await prisma.site.update({
            where: { id: site.id },
            data: { secretsEnc: encryptSecrets(nextSecrets) },
          });
          secrets.sftp.rootPath = inventory.fsRoot;
          inventory.notes?.push(
            `RootPath salvata aggiornata → ${inventory.fsRoot}`,
          );
        } catch {
          /* non bloccare lo scan */
        }
      }

      if (scopeHas(scope, "inventory") || scope === "updates" || scope === "integrity") {
        const extCount =
          inventory.plugins.length +
          inventory.extensions.length +
          inventory.themes.length +
          (inventory.modules?.length ?? 0);
        progress.done(
          "inventory",
          inventory.coreVersion
            ? `${inventory.cms} ${inventory.coreVersion} · ${extCount} elementi`
            : `${extCount} elementi · root ${inventory.fsRoot ?? "—"}`,
        );
      }
    });
  }

  if (scopeHas(scope, "php") && !phpFinalized) {
    if (!inventory.phpVersion) {
      inventory.notes = (inventory.notes ?? []).filter((n) => !/^PHP[: ]/i.test(n));
      inventory.notes?.push(
        "PHP: versione non rilevata dopo header e tentativo FTP/SFTP.",
      );
    }
    progress.done(
      "php",
      inventory.phpVersion
        ? `PHP ${inventory.phpVersion}`
        : "PHP non rilevato",
    );
    phpFinalized = true;
  }

  if (
    secrets?.api &&
    !secrets.sftp &&
    (scopeHas(scope, "inventory") || scope === "updates")
  ) {
    if (scopeHas(scope, "sftp")) progress.skip("sftp", "Solo API");
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
  } else if (needsCreds && secrets && !secrets.sftp) {
    if (scopeHas(scope, "sftp")) progress.skip("sftp", "SFTP non configurato");
    if (scopeHas(scope, "inventory") && !secrets.api) {
      progress.skip("inventory", "Nessuna fonte inventario");
    }
  }

  if (scopeHas(scope, "updates")) {
    progress.start("updates", "Confronto versioni ufficiali…");
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

  if (findings.length === 0 && scope === "full") {
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

function uniqueProbeRoots(...roots: string[]): string[] {
  const out: string[] = [];
  for (const r of roots) {
    const v = (r || ".").replace(/\/$/, "") || ".";
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

async function runPhpAdvisoryCheck(
  siteUrl: string,
  inventory: SiteInventory,
  opts?: { deferMissingNote?: boolean },
): Promise<ScanFinding[]> {
  const {
    detectPhpFromHttp,
    matchPhpAdvisories,
    findingsFromPhpHits,
  } = await import("./advisories/php");

  const hit =
    (await detectPhpFromHttp(siteUrl)) ??
    (inventory.phpVersion
      ? {
          version: inventory.phpVersion,
          source: (inventory.phpSource ?? "unknown") as
            | "header"
            | "sftp"
            | "composer"
            | "probe"
            | "unknown",
        }
      : null);

  if (!hit) {
    if (!opts?.deferMissingNote) {
      inventory.notes?.push(
        "PHP: versione non rilevata (header X-Powered-By assente). Prova SFTP o abilita esposizione controllata in staging.",
      );
    }
    return [];
  }

  inventory.phpVersion = hit.version;
  inventory.phpSource = hit.source;
  const hits = matchPhpAdvisories(hit.version);
  inventory.phpAdvisories = hits.map((h) => ({
    id: h.advisory.id,
    title: h.advisory.title,
    severity: h.advisory.severity,
    cves: h.advisory.cves,
    fixedIn: h.fixedIn,
    eol: h.eol,
    sources: h.advisory.sources,
  }));

  if (hits.length === 0) {
    inventory.notes?.push(
      `PHP ${hit.version} · nessun advisory critico noto nel catalogo SiteGuard (ACN/php.net)`,
    );
    return [];
  }

  return findingsFromPhpHits(hits, hit.version);
}

type PhpHit = {
  version: string;
  source: "header" | "sftp" | "composer" | "probe" | "unknown";
};

async function detectPhpOverFs(
  client: import("../sftp/remote-fs").RemoteFsClient,
  root: string,
  siteUrl: string,
  _cms: string,
): Promise<PhpHit | null> {
  const { detectPhpViaRemoteProbe } = await import("./advisories/php");
  const { canListDir } = await import("../sftp/paths");

  // PRIMA il probe upload: su FTP passivo le molte GET di detectPhpFromSftp
  // (selector/composer) possono lasciare il data-socket morto e far fallire
  // i put successivi. Il probe su tmp/ è il metodo affidabile.
  return detectPhpViaRemoteProbe({
    siteUrl,
    root,
    put: (path, data) => client.put(path, data),
    del: (path) => client.delete(path),
    canList: (path) => canListDir(client, path),
    tryDocroot: false,
  });
}

async function applyPhpHit(
  inventory: SiteInventory,
  findings: ScanFinding[],
  hit: PhpHit,
) {
  const { matchPhpAdvisories, findingsFromPhpHits } = await import(
    "./advisories/php"
  );
  inventory.phpVersion = hit.version;
  inventory.phpSource = hit.source;
  inventory.notes = (inventory.notes ?? []).filter((n) => !/^PHP[: ]/i.test(n));
  inventory.notes?.push(`PHP ${hit.version} rilevato via ${hit.source}`);
  const hits = matchPhpAdvisories(hit.version);
  inventory.phpAdvisories = hits.map((h) => ({
    id: h.advisory.id,
    title: h.advisory.title,
    severity: h.advisory.severity,
    cves: h.advisory.cves,
    fixedIn: h.fixedIn,
    eol: h.eol,
    sources: h.advisory.sources,
  }));
  const existing = new Set(
    findings
      .filter((f) => f.type === "vulnerability")
      .map((f) =>
        String((f.evidence as { advisoryId?: string })?.advisoryId ?? ""),
      ),
  );
  for (const f of findingsFromPhpHits(hits, hit.version)) {
    const id = String(
      (f.evidence as { advisoryId?: string })?.advisoryId ?? "",
    );
    if (!existing.has(id)) findings.push(f);
  }
}
