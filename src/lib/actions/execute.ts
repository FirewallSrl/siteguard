import { prisma } from "../db";
import { decryptSecrets } from "../crypto";
import {
  deleteWpUser,
  updateWpPlugin,
  updateWpSettings,
} from "../cms/wordpress";

/**
 * Esegue un'azione approvata (human-in-the-loop).
 * In DEMO_SCAN=true simula senza side-effect.
 */
export async function executeAction(actionId: string) {
  const action = await prisma.action.findUniqueOrThrow({
    where: { id: actionId },
    include: { finding: true, site: true },
  });

  if (action.status !== "approved") {
    throw new Error("L'azione deve essere approved prima dell'esecuzione");
  }

  await prisma.action.update({
    where: { id: actionId },
    data: { status: "running" },
  });

  try {
    const payload = JSON.parse(action.payload || "{}") as {
      findingType?: string;
      plan?: { steps?: string[] };
      evidence?: Record<string, unknown>;
    };

    const demo = process.env.DEMO_SCAN === "true";
    let result: Record<string, unknown>;

    if (demo) {
      result = {
        executed: true,
        simulated: true,
        findingType: payload.findingType ?? null,
        note: "DEMO_SCAN=true — nessuna modifica remota",
      };
    } else {
      result = await applyLive(action.site, payload);
    }

    await prisma.action.update({
      where: { id: actionId },
      data: {
        status: "completed",
        executedAt: new Date(),
        result: JSON.stringify(result),
      },
    });

    if (action.findingId) {
      await prisma.finding.update({
        where: { id: action.findingId },
        data: { status: "resolved" },
      });
    }

    await prisma.auditLog.create({
      data: {
        siteId: action.siteId,
        event: "action.completed",
        detail: JSON.stringify({
          actionId,
          findingType: payload.findingType,
          simulated: demo,
        }),
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Esecuzione fallita";
    await prisma.action.update({
      where: { id: actionId },
      data: { status: "failed", error: message },
    });
    throw err;
  }
}

async function applyLive(
  site: { id: string; url: string; cms: string; secretsEnc: string | null },
  payload: {
    findingType?: string;
    evidence?: Record<string, unknown>;
  },
) {
  if (!site.secretsEnc) {
    throw new Error("Nessuna credenziale per eseguire l'azione");
  }
  const secrets = decryptSecrets(site.secretsEnc);
  const type = payload.findingType ?? "";
  const evidence = payload.evidence ?? {};

  if (type === "update_plugin" && secrets.api && site.cms === "wordpress") {
    const plugin = String(evidence.plugin ?? "");
    if (!plugin) throw new Error("Plugin file mancante nell'evidence");
    await updateWpPlugin(site.url, secrets.api, plugin);
    return { executed: true, action: "update_plugin", plugin };
  }

  if (type === "settings_hijack" && secrets.api && site.cms === "wordpress") {
    await updateWpSettings(site.url, secrets.api, { url: site.url });
    return { executed: true, action: "fix_siteurl", url: site.url };
  }

  if (type === "suspicious_user" && secrets.api && site.cms === "wordpress") {
    const id = Number(evidence.id);
    if (!id) {
      return {
        executed: false,
        action: "delete_user",
        note: "Specifica user id nell'evidence o elimina manualmente",
      };
    }
    await deleteWpUser(site.url, secrets.api, id);
    return { executed: true, action: "delete_user", userId: id };
  }

  if (type === "malware" && secrets.sftp) {
    const filePath = String(evidence.filePath ?? "");
    if (!filePath) throw new Error("filePath mancante");
    const { withSftp } = await import("../sftp/client");
    await withSftp(secrets.sftp, async (client) => {
      const quarantine = `${filePath}.quarantine-${Date.now()}`;
      try {
        await client.rename(filePath, quarantine);
      } catch {
        await client.delete(filePath);
      }
    });
    return { executed: true, action: "quarantine_file", filePath };
  }

  return {
    executed: false,
    action: "noop",
    note: `Nessun handler automatico per tipo "${type}" — usa checklist manuale`,
    findingType: type,
  };
}
