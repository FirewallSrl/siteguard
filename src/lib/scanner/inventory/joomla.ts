import type SftpClient from "ssh2-sftp-client";
import type { ApiCredentials } from "../../types";
import { fetchJoomlaExtensions, fetchJoomlaUsers } from "../../cms/joomla";
import { readTextFile } from "../../sftp/client";
import type { InventoryExtension, SiteInventory } from "./types";
import { extractUpdateServerUrl } from "./updates";

function emptyInventory(): SiteInventory {
  return {
    collectedAt: new Date().toISOString(),
    cms: "joomla",
    extensions: [],
    themes: [],
    plugins: [],
    modules: [],
    notes: [],
    source: [],
  };
}

export async function collectJoomlaInventory(input: {
  siteUrl: string;
  api?: ApiCredentials;
  sftp?: { client: SftpClient; root: string };
}): Promise<SiteInventory> {
  const inv = emptyInventory();

  if (input.sftp) {
    inv.source.push("sftp");
    await collectFromSftp(input.sftp.client, input.sftp.root, inv);
  }

  if (input.api) {
    inv.source.push("api");
    await collectFromApi(input.siteUrl, input.api, inv);
  }

  if (!inv.coreVersion) {
    inv.notes?.push("Versione Joomla non rilevata — verifica root path SFTP");
  }

  return inv;
}

async function collectFromSftp(
  client: SftpClient,
  root: string,
  inv: SiteInventory,
) {
  let base = root.replace(/\/$/, "");

  // Se la root non contiene Joomla, prova a scoprire la cartella corretta
  base = await resolveJoomlaRoot(client, base, inv);

  // Version — Joomla 3/4/5
  const versionCandidates = [
    `${base}/libraries/src/Version.php`,
    `${base}/libraries/src/Version/Version.php`,
    `${base}/libraries/cms/version/version.php`,
    `${base}/administrator/manifests/files/joomla.xml`,
    `${base}/administrator/manifests/files/joomla.xml`,
  ];

  for (const path of versionCandidates) {
    try {
      const content = await readTextFile(client, path);
      const major = content.match(/const\s+MAJOR_VERSION\s*=\s*(\d+)/)?.[1];
      const minor = content.match(/const\s+MINOR_VERSION\s*=\s*(\d+)/)?.[1];
      const patch = content.match(/const\s+PATCH_VERSION\s*=\s*(\d+)/)?.[1];
      const v =
        major && minor && patch
          ? `${major}.${minor}.${patch}`
          : content.match(/<version>([^<]+)<\/version>/)?.[1] ??
            content.match(/\$RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1] ??
            content.match(/public\s+\$RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1];
      if (v) {
        inv.coreVersion = v.trim();
        break;
      }
    } catch {
      /* try next */
    }
  }

  // PHP / DB hints from configuration.php
  try {
    const cfg = await readTextFile(client, `${base}/configuration.php`);
    const dbtype = cfg.match(/public\s+\$dbtype\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (dbtype) inv.database = dbtype;
  } catch {
    /* skip */
  }

  // Components
  for (const side of ["components", "administrator/components"]) {
    await scanXmlDir(client, `${base}/${side}`, "component", inv.extensions);
  }

  inv.modules = inv.modules ?? [];
  for (const side of ["modules", "administrator/modules"]) {
    await scanXmlDir(client, `${base}/${side}`, "module", inv.modules);
  }

  // Plugins
  await scanPluginTree(client, `${base}/plugins`, inv.plugins);

  // Templates
  for (const side of ["templates", "administrator/templates"]) {
    await scanXmlDir(client, `${base}/${side}`, "template", inv.themes);
  }
}

async function scanXmlDir(
  client: SftpClient,
  dir: string,
  type: string,
  target: InventoryExtension[],
) {
  let entries: Array<{ name: string; type: string }> = [];
  try {
    entries = (await client.list(dir)) as Array<{ name: string; type: string }>;
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.type !== "d" || entry.name.startsWith(".")) continue;
    const folder = `${dir}/${entry.name}`;
    try {
      const files = await client.list(folder);
      const xml = files.find(
        (f) =>
          f.type === "-" &&
          f.name.toLowerCase().endsWith(".xml") &&
          !f.name.toLowerCase().includes("config"),
      );
      // Prefer {folder}.xml
      const preferred =
        files.find(
          (f) =>
            f.type === "-" &&
            f.name.toLowerCase() === `${entry.name.toLowerCase()}.xml`,
        ) ?? xml;
      if (!preferred || preferred.type !== "-") continue;

      const content = await readTextFile(client, `${folder}/${preferred.name}`);
      const name =
        content.match(/<name>([^<]+)<\/name>/i)?.[1]?.trim() ?? entry.name;
      const version = content.match(/<version>([^<]+)<\/version>/i)?.[1]?.trim();
      target.push({
        name: decodeXml(name),
        type,
        version,
        folder: entry.name,
        enabled: true,
        updateUrl: extractUpdateServerUrl(content),
      });
    } catch {
      target.push({ name: entry.name, type, folder: entry.name });
    }
  }
}

async function scanPluginTree(
  client: SftpClient,
  pluginsRoot: string,
  target: InventoryExtension[],
) {
  let groups: Array<{ name: string; type: string }> = [];
  try {
    groups = (await client.list(pluginsRoot)) as Array<{
      name: string;
      type: string;
    }>;
  } catch {
    return;
  }

  for (const group of groups) {
    if (group.type !== "d" || group.name.startsWith(".")) continue;
    const groupPath = `${pluginsRoot}/${group.name}`;
    let plugins: Array<{ name: string; type: string }> = [];
    try {
      plugins = (await client.list(groupPath)) as Array<{
        name: string;
        type: string;
      }>;
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      if (plugin.type !== "d" || plugin.name.startsWith(".")) continue;
      const folder = `${groupPath}/${plugin.name}`;
      try {
        const files = await client.list(folder);
        const xml =
          files.find(
            (f) =>
              f.type === "-" &&
              f.name.toLowerCase() === `${plugin.name.toLowerCase()}.xml`,
          ) ??
          files.find(
            (f) => f.type === "-" && f.name.toLowerCase().endsWith(".xml"),
          );
        if (!xml || xml.type !== "-") {
          target.push({
            name: `${group.name}/${plugin.name}`,
            type: "plugin",
            folder: `${group.name}/${plugin.name}`,
          });
          continue;
        }
        const content = await readTextFile(client, `${folder}/${xml.name}`);
        const name =
          content.match(/<name>([^<]+)<\/name>/i)?.[1]?.trim() ??
          `${group.name}/${plugin.name}`;
        const version = content
          .match(/<version>([^<]+)<\/version>/i)?.[1]
          ?.trim();
        target.push({
          name: decodeXml(name),
          type: "plugin",
          version,
          folder: `${group.name}/${plugin.name}`,
          enabled: true,
          updateUrl: extractUpdateServerUrl(content),
        });
      } catch {
        target.push({
          name: `${group.name}/${plugin.name}`,
          type: "plugin",
          folder: `${group.name}/${plugin.name}`,
        });
      }
    }
  }
}

async function resolveJoomlaRoot(
  client: SftpClient,
  base: string,
  inv: SiteInventory,
): Promise<string> {
  const looksLikeJoomla = async (dir: string) => {
    try {
      await client.stat(`${dir}/configuration.php`);
      return true;
    } catch {
      try {
        await client.stat(`${dir}/libraries`);
        return true;
      } catch {
        return false;
      }
    }
  };

  if (await looksLikeJoomla(base)) return base;

  // prova sottocartelle comuni
  const candidates = ["public", "httpdocs", "www", "web", "public_html", "joomla"];
  try {
    const entries = await client.list(base);
    for (const e of entries) {
      if (e.type !== "d") continue;
      if (candidates.includes(e.name) || e.name === "administrator") {
        const next = `${base}/${e.name}`.replace(/\/administrator$/, "");
        // se siamo finiti in administrator, sali di uno
        const probe =
          e.name === "administrator" ? base : `${base}/${e.name}`;
        if (await looksLikeJoomla(probe)) {
          inv.notes?.push(`Root Joomla rilevata: ${probe}`);
          return probe;
        }
        void next;
      }
    }
    // qualsiasi sottocartella con configuration.php
    for (const e of entries) {
      if (e.type !== "d" || e.name.startsWith(".")) continue;
      const probe = `${base}/${e.name}`;
      if (await looksLikeJoomla(probe)) {
        inv.notes?.push(`Root Joomla rilevata: ${probe}`);
        return probe;
      }
    }
  } catch {
    /* keep base */
  }

  return base;
}

async function collectFromApi(
  siteUrl: string,
  api: ApiCredentials,
  inv: SiteInventory,
) {
  try {
    const users = await fetchJoomlaUsers(siteUrl, api);
    const list = Array.isArray(users.data) ? users.data : [];
    inv.users = { total: list.length };
  } catch {
    inv.notes?.push("API utenti Joomla non disponibile");
  }

  try {
    const ext = await fetchJoomlaExtensions(siteUrl, api);
    const list = Array.isArray(ext.data) ? ext.data : [];
    for (const item of list) {
      const row = item as {
        attributes?: {
          name?: string;
          type?: string;
          version?: string;
          enabled?: number | boolean;
          element?: string;
        };
      };
      const a = row.attributes;
      if (!a) continue;
      const entry: InventoryExtension = {
        name: a.name ?? a.element ?? "unknown",
        type: a.type ?? "extension",
        version: a.version,
        enabled: a.enabled === 1 || a.enabled === true,
        folder: a.element,
      };
      if (/template/i.test(entry.type)) inv.themes.push(entry);
      else if (/plugin/i.test(entry.type)) inv.plugins.push(entry);
      else if (/module/i.test(entry.type)) inv.modules?.push(entry);
      else inv.extensions.push(entry);
    }
  } catch {
    inv.notes?.push("API estensioni Joomla non disponibile");
  }
}

function decodeXml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
