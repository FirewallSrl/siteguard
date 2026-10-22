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
  if (!site?.secretsEnc) throw new Error("missing");
  const s = decryptSecrets(site.secretsEnc).sftp!;
  const client = await connectFtp({
    host: s.host,
    port: s.port ?? 21,
    username: s.username,
    password: s.password!,
    secure: false,
    timeoutMs: 20_000,
  });
  try {
    for (const dir of [".cl.selector", ".cagefs", "..", "../.cl.selector"]) {
      const list = await listEntries(client, dir);
      console.log(dir, list.slice(0, 50));
    }
    try {
      console.log("test.php", (await readTextFile(client, "test.php")).slice(0, 500));
    } catch (e) {
      console.log("test.php fail", e);
    }
    const files = await listRecursive(client, ".cl.selector", 50).catch(() => []);
    console.log("recursive", files);
    for (const f of files) {
      try {
        const t = await readTextFile(client, f.path);
        console.log("---", f.path, t.slice(0, 500));
      } catch {
        /* */
      }
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
