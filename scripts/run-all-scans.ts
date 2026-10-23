/**
 * Avvia scan complete su tutti i siti connected (o --all).
 * Uso: npx tsx scripts/run-all-scans.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2]!.trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]!] === undefined) process.env[m[1]!] = v;
    }
  } catch {
    /* ignore */
  }
}
loadEnv();

import { PrismaClient } from "@prisma/client";
import { runSiteScan } from "../src/lib/scanner/run-scan";
import { initScanProgress } from "../src/lib/scanner/progress";
import { progressStepsForScope } from "../src/lib/scanner/scopes";

const CONCURRENCY = 2;
const includeAll = process.argv.includes("--all");

async function main() {
  const prisma = new PrismaClient();
  try {
    const sites = await prisma.site.findMany({
      where: includeAll ? undefined : { status: "connected" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, url: true, status: true },
    });

    console.log(
      `Scan full su ${sites.length} siti (concurrency=${CONCURRENCY})…`,
    );

    const results: Array<{
      name: string;
      status: string;
      scanId?: string;
      error?: string;
      findings?: number;
    }> = [];

    let i = 0;
    async function worker() {
      while (i < sites.length) {
        const idx = i++;
        const site = sites[idx]!;
        const scan = await prisma.scan.create({
          data: { siteId: site.id, status: "queued" },
        });
        initScanProgress(scan.id, site.id, {
          scope: "full",
          steps: progressStepsForScope("full"),
        });
        console.log(`→ [${idx + 1}/${sites.length}] ${site.name}`);
        try {
          await runSiteScan(site.id, scan.id, "full");
          const done = await prisma.scan.findUnique({ where: { id: scan.id } });
          const findings = await prisma.finding.count({
            where: { siteId: site.id, status: "open", scanId: scan.id },
          });
          console.log(
            `  ✓ ${site.name} · ${done?.status} · ${done?.summary ?? ""} · finding scan=${findings}`,
          );
          results.push({
            name: site.name,
            status: done?.status ?? "?",
            scanId: scan.id,
            findings,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  ✗ ${site.name}: ${msg}`);
          results.push({
            name: site.name,
            status: "failed",
            scanId: scan.id,
            error: msg,
          });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, sites.length) }, () =>
        worker(),
      ),
    );

    console.log("\n=== Riepilogo ===");
    for (const r of results) {
      console.log(
        `${r.status.padEnd(10)} ${r.name}${r.findings != null ? ` · ${r.findings} finding` : ""}${r.error ? ` · ${r.error}` : ""}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
