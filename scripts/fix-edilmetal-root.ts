/**
 * Imposta rootPath FTP edilmetal su "." (home = httpdocs chroot)
 * e rilancia un inventario locale di verifica.
 */
import { PrismaClient } from "@prisma/client";
import { decryptSecrets, encryptSecrets } from "../src/lib/crypto";
import { withSftp, readTextFile } from "../src/lib/sftp/client";
import { collectJoomlaInventory } from "../src/lib/scanner/inventory/joomla";
import {
  detectPhpFromSftp,
  detectPhpViaRemoteProbe,
} from "../src/lib/scanner/advisories/php";
import { canListDir } from "../src/lib/sftp/paths";

async function main() {
  const prisma = new PrismaClient();
  const site = await prisma.site.findFirst({
    where: { url: { contains: "edilmetal" } },
  });
  if (!site?.secretsEnc) throw new Error("sito non trovato");

  const secrets = decryptSecrets(site.secretsEnc);
  if (!secrets.sftp) throw new Error("no sftp");

  secrets.sftp.rootPath = ".";
  secrets.sftp.protocol = secrets.sftp.protocol ?? "ftp";
  secrets.sftp.port = secrets.sftp.port ?? 21;

  await prisma.site.update({
    where: { id: site.id },
    data: {
      secretsEnc: encryptSecrets(secrets),
      cms: "joomla",
    },
  });
  console.log("credentials rootPath → .");

  await withSftp(secrets.sftp, async (client, root) => {
    console.log("effective root", root);
    const inv = await collectJoomlaInventory({
      siteUrl: site.url,
      sftp: { client, root },
    });
    console.log({
      core: inv.coreVersion,
      fsRoot: inv.fsRoot,
      ext: inv.extensions.length,
      themes: inv.themes.length,
      plugins: inv.plugins.length,
      modules: inv.modules?.length,
      notes: inv.notes,
    });

    const listDir = async (path: string) => {
      try {
        return (await client.list(path)).map((e) => e.name);
      } catch {
        return [];
      }
    };
    const php =
      (await detectPhpFromSftp((p) => readTextFile(client, p), root, {
        listDir,
      })) ??
      (await detectPhpViaRemoteProbe({
        siteUrl: site.url,
        root,
        put: (p, d) => client.put(p, d),
        del: (p) => client.delete(p),
        canList: (p) => canListDir(client, p),
      }));
    console.log("php", php);

    if (inv.coreVersion || inv.extensions.length) {
      await prisma.site.update({
        where: { id: site.id },
        data: {
          inventoryJson: JSON.stringify({
            ...inv,
            phpVersion: php?.version,
            phpSource: php?.source,
            collectedAt: new Date().toISOString(),
          }),
          lastScanAt: new Date(),
        },
      });
      console.log("inventoryJson aggiornato");
    }
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
