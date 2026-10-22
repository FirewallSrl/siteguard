import type { ApiCredentials } from "../../types";
import {
  fetchWpPlugins,
  fetchWpThemes,
  fetchWpUsers,
} from "../../cms/wordpress";
import { readTextFile, type RemoteFsClient } from "../../sftp/client";
import type { InventoryExtension, SiteInventory } from "./types";

function emptyInventory(): SiteInventory {
  return {
    collectedAt: new Date().toISOString(),
    cms: "wordpress",
    extensions: [],
    themes: [],
    plugins: [],
    notes: [],
    source: [],
  };
}

export async function collectWordpressInventory(input: {
  siteUrl: string;
  api?: ApiCredentials;
  sftp?: { client: RemoteFsClient; root: string };
}): Promise<SiteInventory> {
  const inv = emptyInventory();

  if (input.api) {
    inv.source.push("api");
    await collectFromApi(input.siteUrl, input.api, inv);
  }

  if (input.sftp) {
    inv.source.push("sftp");
    await collectFromSftp(input.sftp.client, input.sftp.root, inv);
  }

  return inv;
}

async function collectFromApi(
  siteUrl: string,
  api: ApiCredentials,
  inv: SiteInventory,
) {
  try {
    const users = await fetchWpUsers(siteUrl, api);
    const admins = users.filter((u) =>
      (u.roles ?? []).some((r) => r === "administrator"),
    );
    inv.users = { total: users.length, admins: admins.length };
  } catch {
    inv.notes?.push("API utenti WP non disponibile");
  }

  try {
    const plugins = await fetchWpPlugins(siteUrl, api);
    inv.plugins = plugins.map((p) => ({
      name: p.name,
      type: "plugin",
      version: p.version,
      enabled: p.status === "active",
      folder: p.plugin,
      latestVersion: p.update || undefined,
      updateAvailable: Boolean(
        p.update && p.version && p.update !== p.version,
      ),
    }));
  } catch {
    inv.notes?.push("API plugin WP non disponibile");
  }

  try {
    const themes = await fetchWpThemes(siteUrl, api);
    inv.themes = themes.map((t) => ({
      name: t.name ?? t.stylesheet,
      type: "theme",
      version: t.version,
      enabled: t.status === "active",
      folder: t.stylesheet,
      latestVersion: t.update || undefined,
      updateAvailable: Boolean(
        t.update && t.version && t.update !== t.version,
      ),
    }));
  } catch {
    inv.notes?.push("API temi WP non disponibile");
  }
}

async function collectFromSftp(
  client: RemoteFsClient,
  root: string,
  inv: SiteInventory,
) {
  const base = root.replace(/\/$/, "");

  if (!inv.coreVersion) {
    try {
      const versionPhp = await readTextFile(
        client,
        `${base}/wp-includes/version.php`,
      );
      const match = versionPhp.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
      if (match?.[1]) inv.coreVersion = match[1];
    } catch {
      inv.notes?.push("version.php non leggibile via SFTP");
    }
  }

  // Plugins from filesystem if API empty
  if (inv.plugins.length === 0) {
    try {
      const dirs = await client.list(`${base}/wp-content/plugins`);
      for (const d of dirs) {
        if (d.type !== "d" || d.name.startsWith(".")) continue;
        const folder = `${base}/wp-content/plugins/${d.name}`;
        try {
          const files = await client.list(folder);
          const main =
            files.find(
              (f) =>
                f.type === "-" &&
                f.name.toLowerCase() === `${d.name.toLowerCase()}.php`,
            ) ?? files.find((f) => f.type === "-" && f.name.endsWith(".php"));
          if (!main || main.type !== "-") {
            inv.plugins.push({ name: d.name, type: "plugin", folder: d.name });
            continue;
          }
          const content = await readTextFile(client, `${folder}/${main.name}`);
          const name =
            content.match(/Plugin Name:\s*(.+)/i)?.[1]?.trim() ?? d.name;
          const version = content.match(/Version:\s*(.+)/i)?.[1]?.trim();
          inv.plugins.push({
            name,
            type: "plugin",
            version,
            folder: d.name,
            enabled: true,
          });
        } catch {
          inv.plugins.push({ name: d.name, type: "plugin", folder: d.name });
        }
      }
    } catch {
      /* skip */
    }
  }

  if (inv.themes.length === 0) {
    try {
      const dirs = await client.list(`${base}/wp-content/themes`);
      for (const d of dirs) {
        if (d.type !== "d" || d.name.startsWith(".")) continue;
        try {
          const style = await readTextFile(
            client,
            `${base}/wp-content/themes/${d.name}/style.css`,
          );
          const name = style.match(/Theme Name:\s*(.+)/i)?.[1]?.trim() ?? d.name;
          const version = style.match(/Version:\s*(.+)/i)?.[1]?.trim();
          inv.themes.push({
            name,
            type: "theme",
            version,
            folder: d.name,
          });
        } catch {
          inv.themes.push({ name: d.name, type: "theme", folder: d.name });
        }
      }
    } catch {
      /* skip */
    }
  }
}

// keep type import used
export type { InventoryExtension };
