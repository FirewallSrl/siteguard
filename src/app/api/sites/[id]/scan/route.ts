import { after } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { runSiteScan } from "@/lib/scanner/run-scan";
import { initScanProgress } from "@/lib/scanner/progress";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id: siteId } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    return NextResponse.json({ error: "Sito non trovato" }, { status: 404 });
  }

  const scan = await prisma.scan.create({
    data: { siteId, status: "queued" },
  });
  initScanProgress(scan.id, siteId);

  const useInngest = Boolean(process.env.INNGEST_EVENT_KEY);

  if (useInngest) {
    await inngest.send({
      name: "site/scan.requested",
      data: { siteId, scanId: scan.id },
    });
    return NextResponse.json({ scanId: scan.id, mode: "async" });
  }

  // Background: risposta immediata + polling UI sullo stato
  const job = runSiteScan(siteId, scan.id).catch(() => {
    /* errori già persistiti in runSiteScan */
  });
  try {
    after(() => job);
  } catch {
    /* next after non disponibile: il promise resta comunque vivo nel processo */
  }

  return NextResponse.json({ scanId: scan.id, mode: "async" });
}
