import type { RemoteFsClient } from "../../sftp/client";
import type { ApiCredentials } from "../../types";
import { fetchJoomlaExtensions, fetchJoomlaUsers } from "../../cms/joomla";
import { readTextFile } from "../../sftp/client";
import {
  canListDir,
  findJoomlaRoot,
  isDirEntry,
  joinPath,
  listEntries,
} from "../../sftp/paths";
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
  sftp?: { client: RemoteFsClient; root: string };
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

  // Fallback pubblico: meta generator / language XML
  if (!inv.coreVersion) {
    const publicVer = await detectJoomlaVersionHttp(input.siteUrl);
    if (publicVer) {
      inv.coreVersion = publicVer;
      inv.source.push("public");
      inv.notes?.push(`Versione Joomla da HTML pubblico: ${publicVer}`);
    }
  }

  if (!inv.coreVersion) {
    inv.notes?.push(
      "Versione Joomla non rilevata — root path o layout non standard",
    );
  }

  const extCount =
    inv.extensions.length +
    inv.themes.length +
    inv.plugins.length +
    (inv.modules?.length ?? 0);
  if (extCount === 0 && inv.source.includes("sftp")) {
    inv.notes?.push(
      "Nessuna estensione/template via filesystem — possibili cartelle FTP non tipizzate o root incompleta",
    );
  }

  return inv;
}

async function collectFromSftp(
  client: RemoteFsClient,
  root: string,
  inv: SiteInventory,
) {
  const start = root.replace(/\/$/, "") || ".";
  const found = await findJoomlaRoot(client, start);
  const base = found?.root ?? start;
  inv.fsRoot = base;

  if (found && found.root !== start) {
    inv.notes?.push(
      `Root Joomla riposizionata: ${start} → ${found.root} (score ${found.score})`,
    );
  } else if (found) {
    const chrootHint =
      found.root === "."
        ? " · home FTP = docroot (httpdocs chroot)"
        : "";
    inv.notes?.push(
      `Root Joomla confermata: ${found.root} (score ${found.score})${chrootHint}`,
    );
  } else {
    inv.notes?.push(
      `Root Joomla non confermata da ${start} — uso path corrente e percorsi alternativi`,
    );
  }

  // Candidate roots se score basso: prova anche start e figli tipici
  const rootsToTry = uniqueRoots([
    base,
    start,
    joinPath(start, "httpdocs"),
    joinPath(start, "public_html"),
    joinPath(start, "www"),
    joinPath(start, "web"),
    joinPath(start, "public"),
  ]);

  let versionRoot = base;
  for (const candidate of rootsToTry) {
    const ver = await readJoomlaVersion(client, candidate);
    if (ver) {
      inv.coreVersion = ver;
      versionRoot = candidate;
      inv.fsRoot = candidate;
      break;
    }
  }

  // configuration.php → DB
  for (const candidate of [versionRoot, ...rootsToTry]) {
    try {
      const cfg = await readTextFile(
        client,
        joinPath(candidate, "configuration.php"),
      );
      const dbtype = cfg.match(/public\s+\$dbtype\s*=\s*['"]([^'"]+)['"]/)?.[1];
      if (dbtype) {
        inv.database = dbtype;
        inv.fsRoot = candidate;
        versionRoot = candidate;
        break;
      }
    } catch {
      /* next */
    }
  }

  const scanRoot = inv.fsRoot ?? versionRoot;

  // Components
  for (const side of ["components", "administrator/components"]) {
    await scanXmlDir(
      client,
      joinPath(scanRoot, side),
      "component",
      inv.extensions,
    );
  }

  inv.modules = inv.modules ?? [];
  for (const side of ["modules", "administrator/modules"]) {
    await scanXmlDir(client, joinPath(scanRoot, side), "module", inv.modules);
  }

  await scanPluginTree(client, joinPath(scanRoot, "plugins"), inv.plugins);

  for (const side of ["templates", "administrator/templates"]) {
    await scanXmlDir(client, joinPath(scanRoot, side), "template", inv.themes);
  }

  // Se ancora vuoto, seconda passata su roots alternative
  const empty =
    inv.extensions.length +
      inv.themes.length +
      inv.plugins.length +
      (inv.modules?.length ?? 0) ===
    0;
  if (empty) {
    for (const alt of rootsToTry) {
      if (alt === scanRoot) continue;
      if (!(await canListDir(client, joinPath(alt, "templates")))) continue;
      inv.notes?.push(`Retry inventario su root alternativa: ${alt}`);
      inv.fsRoot = alt;
      for (const side of ["components", "administrator/components"]) {
        await scanXmlDir(
          client,
          joinPath(alt, side),
          "component",
          inv.extensions,
        );
      }
      for (const side of ["modules", "administrator/modules"]) {
        await scanXmlDir(client, joinPath(alt, side), "module", inv.modules!);
      }
      await scanPluginTree(client, joinPath(alt, "plugins"), inv.plugins);
      for (const side of ["templates", "administrator/templates"]) {
        await scanXmlDir(client, joinPath(alt, side), "template", inv.themes);
      }
      if (
        inv.extensions.length +
          inv.themes.length +
          inv.plugins.length +
          (inv.modules?.length ?? 0) >
        0
      ) {
        const ver = await readJoomlaVersion(client, alt);
        if (ver) inv.coreVersion = ver;
        break;
      }
    }
  }
}

async function readJoomlaVersion(
  client: RemoteFsClient,
  base: string,
): Promise<string | null> {
  const versionCandidates = [
    joinPath(base, "libraries/src/Version.php"),
    joinPath(base, "libraries/src/Version/Version.php"),
    joinPath(base, "libraries/cms/version/version.php"),
    joinPath(base, "libraries/cms/version.php"),
    joinPath(base, "administrator/manifests/files/joomla.xml"),
    joinPath(base, "administrator/manifests/files/joomla.xml"),
    joinPath(base, "includes/version.php"),
  ];

  for (const path of versionCandidates) {
    try {
      const content = await readTextFile(client, path);
      const parsed = parseJoomlaVersionContent(content);
      if (parsed) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

function parseJoomlaVersionContent(content: string): string | null {
  const major = content.match(/const\s+MAJOR_VERSION\s*=\s*(\d+)/)?.[1];
  const minor = content.match(/const\s+MINOR_VERSION\s*=\s*(\d+)/)?.[1];
  const patch = content.match(/const\s+PATCH_VERSION\s*=\s*(\d+)/)?.[1];
  if (major && minor && patch) return `${major}.${minor}.${patch}`;

  const xml = content.match(/<version>([^<]+)<\/version>/i)?.[1];
  if (xml) return xml.trim();

  const release =
    content.match(/\$RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1] ??
    content.match(/public\s+\$RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1] ??
    content.match(/const\s+RELEASE\s*=\s*['"]([^'"]+)['"]/)?.[1];
  return release?.trim() ?? null;
}

async function scanXmlDir(
  client: RemoteFsClient,
  dir: string,
  type: string,
  target: InventoryExtension[],
) {
  const entries = await listEntries(client, dir);
  if (entries.length === 0) return;

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!isDirEntry(entry)) continue;

    const folder = joinPath(dir, entry.name);
    // FTP ambiguo: verifica listabilità
    if (!(await canListDir(client, folder))) continue;

    try {
      const files = await listEntries(client, folder);
      const preferred =
        files.find(
          (f) =>
            f.type !== "d" &&
            f.name.toLowerCase() === `${entry.name.toLowerCase()}.xml`,
        ) ??
        files.find(
          (f) =>
            f.type !== "d" &&
            f.name.toLowerCase().endsWith(".xml") &&
            !f.name.toLowerCase().includes("config"),
        );

      if (!preferred) {
        // Cartella presente senza XML manifesto → registra almeno il nome
        if (type === "template" || type === "component") {
          target.push({
            name: entry.name,
            type,
            folder: entry.name,
            enabled: true,
          });
        }
        continue;
      }

      const content = await readTextFile(
        client,
        joinPath(folder, preferred.name),
      );
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
  client: RemoteFsClient,
  pluginsRoot: string,
  target: InventoryExtension[],
) {
  const groups = await listEntries(client, pluginsRoot);
  for (const group of groups) {
    if (group.name.startsWith(".") || !isDirEntry(group)) continue;
    const groupPath = joinPath(pluginsRoot, group.name);
    if (!(await canListDir(client, groupPath))) continue;

    const plugins = await listEntries(client, groupPath);
    for (const plugin of plugins) {
      if (plugin.name.startsWith(".") || !isDirEntry(plugin)) continue;
      const folder = joinPath(groupPath, plugin.name);
      if (!(await canListDir(client, folder))) continue;
      try {
        const files = await listEntries(client, folder);
        const xml =
          files.find(
            (f) =>
              f.type !== "d" &&
              f.name.toLowerCase() === `${plugin.name.toLowerCase()}.xml`,
          ) ??
          files.find(
            (f) => f.type !== "d" && f.name.toLowerCase().endsWith(".xml"),
          );
        if (!xml) {
          target.push({
            name: `${group.name}/${plugin.name}`,
            type: "plugin",
            folder: `${group.name}/${plugin.name}`,
          });
          continue;
        }
        const content = await readTextFile(client, joinPath(folder, xml.name));
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

async function detectJoomlaVersionHttp(
  siteUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(siteUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SiteGuard/2.0; +https://siteguard.local)",
        Accept: "text/html",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    const gen =
      html.match(
        /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']*Joomla[^"']*)["']/i,
      )?.[1] ??
      html.match(
        /content=["']([^"']*Joomla[^"']*)["'][^>]+name=["']generator["']/i,
      )?.[1];
    if (gen) {
      const v = gen.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1];
      if (v) return v;
    }
  } catch {
    /* ignore */
  }

  // language XML pubblico (a volte esposto)
  for (const path of [
    "/administrator/manifests/files/joomla.xml",
    "/language/en-GB/en-GB.xml",
    "/language/it-IT/it-IT.xml",
  ]) {
    try {
      const u = new URL(path, siteUrl).href;
      const res = await fetch(u, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/xml,text/xml,*/*" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const body = (await res.text()).slice(0, 50_000);
      const v = body.match(/<version>([^<]+)<\/version>/i)?.[1]?.trim();
      if (v && /^\d+\.\d+/.test(v)) return v;
    } catch {
      /* next */
    }
  }

  return null;
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

function uniqueRoots(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const v = (p || ".").replace(/\/$/, "") || ".";
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function decodeXml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
