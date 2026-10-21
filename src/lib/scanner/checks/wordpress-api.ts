import type { ApiCredentials } from "../../types";
import type { ScanFinding } from "../types";
import {
  fetchWpPlugins,
  fetchWpSettings,
  fetchWpThemes,
  fetchWpUsers,
  type WpPlugin,
  type WpTheme,
  type WpUser,
} from "../../cms/wordpress";

export async function runWordpressApiChecks(
  siteUrl: string,
  creds: ApiCredentials,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  let users: WpUser[] = [];
  let plugins: WpPlugin[] = [];
  let themes: WpTheme[] = [];
  let settings: Awaited<ReturnType<typeof fetchWpSettings>> = {};

  try {
    [users, plugins, settings] = await Promise.all([
      fetchWpUsers(siteUrl, creds),
      fetchWpPlugins(siteUrl, creds),
      fetchWpSettings(siteUrl, creds),
    ]);
  } catch (err) {
    findings.push({
      type: "config",
      severity: "high",
      title: "API WordPress non raggiungibile / permessi insufficienti",
      description: err instanceof Error ? err.message : "Errore API",
      evidence: {},
      proposedPlan: {
        summary: "Verificare Application Password e capability",
        steps: [
          "Testa connessione API",
          "Creare Application Password da utente admin",
          "Abilitare REST API se disabilitata",
        ],
        risk: "high",
        requiresBackup: false,
      },
    });
    return findings;
  }

  try {
    themes = await fetchWpThemes(siteUrl, creds);
  } catch {
    /* endpoint temi non sempre disponibile */
  }

  const admins = users.filter((u) =>
    (u.roles ?? []).some((r) => r === "administrator"),
  );

  if (admins.length > 3) {
    findings.push({
      type: "suspicious_user",
      severity: "medium",
      title: `${admins.length} amministratori rilevati`,
      description:
        "Un numero elevato di admin può indicare account di persistenza.",
      evidence: {
        admins: admins.map((a) => ({ id: a.id, slug: a.slug, name: a.name })),
      },
      proposedPlan: {
        summary: "Revisionare e rimuovere admin non autorizzati",
        steps: [
          "Confrontare con whitelist cliente",
          "Eliminare account sconosciuti via API",
          "Forzare reset password admin legittimi",
        ],
        risk: "high",
        requiresBackup: false,
      },
    });
  }

  const suspiciousSlugs = admins.filter((a) =>
    /^(admin|support|wp_|test|hack|security|manage)/i.test(a.slug),
  );
  for (const u of suspiciousSlugs.slice(0, 5)) {
    if (u.slug === "admin") {
      findings.push({
        type: "suspicious_user",
        severity: "medium",
        title: `Username admin generico: ${u.slug}`,
        description:
          "Username prevedibili facilitano brute force. Preferisci account nominativi.",
        evidence: { id: u.id, slug: u.slug },
        proposedPlan: {
          summary: `Rinominare/sostituire utente ${u.slug}`,
          steps: [
            "Creare nuovo admin nominativo",
            "Migrare contenuti se necessario",
            "Eliminare o declassare lo slug generico",
          ],
          risk: "medium",
          requiresBackup: false,
        },
      });
    }
  }

  const expectedHost = new URL(siteUrl).host;
  if (settings.url) {
    try {
      const settingsHost = new URL(settings.url).host;
      if (settingsHost !== expectedHost) {
        findings.push({
          type: "settings_hijack",
          severity: "critical",
          title: "Possibile hijack di siteurl",
          description: `Settings URL punta a ${settingsHost} invece di ${expectedHost}.`,
          evidence: { settingsUrl: settings.url, expectedHost },
          proposedPlan: {
            summary: "Ripristinare siteurl/home",
            steps: [
              "Impostare URL corrette via API settings",
              "Controllare .htaccess e wp-config",
              "Purgare cache CDN",
            ],
            risk: "critical",
            requiresBackup: true,
          },
        });
      }
    } catch {
      /* ignore */
    }
  }

  for (const plugin of plugins) {
    if (plugin.status === "inactive") continue;
    if (plugin.update && plugin.update !== plugin.version) {
      findings.push({
        type: "update_plugin",
        severity: "medium",
        title: `Plugin da aggiornare: ${plugin.name}`,
        description: `${plugin.version ?? "?"} → ${plugin.update}`,
        evidence: {
          plugin: plugin.plugin,
          from: plugin.version,
          to: plugin.update,
        },
        proposedPlan: {
          summary: `Aggiornare ${plugin.name} a ${plugin.update}`,
          steps: [
            "Backup",
            `Update plugin ${plugin.plugin} via REST`,
            "Verificare sito 200",
          ],
          risk: "medium",
          requiresBackup: true,
        },
      });
    }
  }

  for (const theme of themes) {
    if (theme.status !== "active" && theme.stylesheet) {
      /* inventory only for active + those with updates */
    }
    if (theme.update && theme.update !== theme.version) {
      findings.push({
        type: "update_theme",
        severity: theme.status === "active" ? "high" : "low",
        title: `Tema da aggiornare: ${theme.name ?? theme.stylesheet}`,
        description: `${theme.version ?? "?"} → ${theme.update}`,
        evidence: {
          stylesheet: theme.stylesheet,
          from: theme.version,
          to: theme.update,
          status: theme.status,
        },
        proposedPlan: {
          summary: `Aggiornare tema ${theme.stylesheet}`,
          steps: ["Backup", "Update tema via REST/wp-admin", "Verifica layout"],
          risk: theme.status === "active" ? "high" : "low",
          requiresBackup: true,
        },
      });
    }
  }

  const inactivePlugins = plugins.filter((p) => p.status === "inactive");
  if (inactivePlugins.length >= 5) {
    findings.push({
      type: "config",
      severity: "low",
      title: `${inactivePlugins.length} plugin inattivi`,
      description:
        "Plugin inutilizzati aumentano superficie d'attacco. Rimuovili se non servono.",
      evidence: {
        plugins: inactivePlugins.slice(0, 20).map((p) => p.plugin),
      },
      proposedPlan: {
        summary: "Pulire plugin inattivi",
        steps: ["Confermare con cliente", "Eliminare plugin non usati"],
        risk: "low",
        requiresBackup: true,
      },
    });
  }

  return findings;
}
