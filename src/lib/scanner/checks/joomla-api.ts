import type { ApiCredentials } from "../../types";
import type { ScanFinding } from "../types";
import {
  fetchJoomlaExtensions,
  fetchJoomlaUsers,
} from "../../cms/joomla";

export async function runJoomlaApiChecks(
  siteUrl: string,
  creds: ApiCredentials,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  try {
    const usersRes = await fetchJoomlaUsers(siteUrl, creds);
    const users = Array.isArray(usersRes.data) ? usersRes.data : [];
    const supers = users.filter((u) => {
      const attrs = (u as { attributes?: { group_names?: string[] } }).attributes;
      const groups = attrs?.group_names ?? [];
      return groups.some((g) => /super/i.test(g));
    });

    if (supers.length > 3) {
      findings.push({
        type: "suspicious_user",
        severity: "medium",
        title: `${supers.length} Super User Joomla`,
        description: "Troppi Super User aumentano il rischio di persistenza.",
        evidence: { count: supers.length },
        proposedPlan: {
          summary: "Revisionare Super User",
          steps: ["Whitelist cliente", "Disattivare account sconosciuti"],
          risk: "high",
          requiresBackup: false,
        },
      });
    }
  } catch (err) {
    findings.push({
      type: "config",
      severity: "high",
      title: "API Joomla utenti non raggiungibile",
      description: err instanceof Error ? err.message : "Errore",
      evidence: {},
      proposedPlan: {
        summary: "Verificare token Web Services",
        steps: ["System → Web Services", "Permessi API", "Test connessione"],
        risk: "high",
        requiresBackup: false,
      },
    });
  }

  try {
    const ext = await fetchJoomlaExtensions(siteUrl, creds);
    const list = Array.isArray(ext.data) ? ext.data : [];
    if (list.length > 0) {
      findings.push({
        type: "config",
        severity: "info",
        title: `${list.length} estensioni inventariate`,
        description:
          "Inventario estensioni OK. Confronta aggiornamenti dal pannello Joomla.",
        evidence: { count: list.length },
        proposedPlan: {
          summary: "Controllare update estensioni in admin",
          steps: ["System → Update", "Aggiornare componenti critici"],
          risk: "info",
          requiresBackup: false,
        },
      });
    }
  } catch {
    /* optional */
  }

  return findings;
}
