import { PrismaClient } from "@prisma/client";
import { decryptSecrets } from "../src/lib/crypto";
import { connectFtp } from "../src/lib/sftp/ftp-client";
import { readTextFile, listRecursive } from "../src/lib/sftp/client";
import { listEntries } from "../src/lib/sftp/paths";

async function main() {
  const prisma = new PrismaClient();
  const site = await prisma.site.findFirst({
    where: { url: { contains: "edilmetal" } },
  });
  if (!site?.secretsEnc) process.exit(1);
  const s = decryptSecrets(site.secretsEnc).sftp!;
  const client = await connectFtp({
    host: s.host,
    port: s.port ?? 21,
    username: s.username,
    password: s.password!,
    secure: false,
    timeoutMs: 25_000,
  });

  try {
    for (const dir of [".cl.selector", ".cagefs", "cgi-bin", "tmp"]) {
      const list = await listEntries(client, dir);
      console.log("DIR", dir, list.map((e) => `${e.name}:${e.type}`).slice(0, 40));
    }

    const candidates = [
      ".cl.selector/defaults.cfg",
      ".cl.selector/defaults.cfg.json",
      ".cl.selector/config.json",
      ".php-version",
      "php.ini",
      ".user.ini",
      "test.php",
      "../.cl.selector/defaults.cfg",
      "../etc/php.ini",
      ".cagefs/.enabled",
    ];
    for (const p of candidates) {
      try {
        const t = await readTextFile(client, p);
        console.log("FILE", p, "len", t.length, "head", t.slice(0, 300).replace(/\n/g, "\\n"));
      } catch {
        console.log("FILE miss", p);
      }
    }

    // cerca file che citano php version nel selector
    try {
      const files = await listRecursive(client, ".cl.selector", 80);
      console.log("cl.selector recursive", files);
      for (const f of files.slice(0, 30)) {
        try {
          const t = await readTextFile(client, f);
          if (/php|version|8\.\d/i.test(t)) {
            console.log("HIT", f, t.slice(0, 400).replace(/\n/g, "\\n"));
          }
        } catch {
          /* skip */
        }
      }
    } catch (e) {
      console.log("recursive fail", e);
    }
  } finally {
    await client.end();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
