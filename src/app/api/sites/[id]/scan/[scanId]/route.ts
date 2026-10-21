import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getScanProgress } from "@/lib/scanner/progress";

type Params = { params: Promise<{ id: string; scanId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id: siteId, scanId } = await params;
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, siteId },
  });
  if (!scan) {
    return NextResponse.json({ error: "Scan non trovato" }, { status: 404 });
  }

  const progress = getScanProgress(scanId);

  return NextResponse.json({
    scanId: scan.id,
    status: scan.status,
    summary: scan.summary,
    error: scan.error,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    progress: progress
      ? {
          percent: progress.percent,
          current: progress.current,
          steps: progress.steps,
          finished:
            progress.finished ??
            (scan.status === "completed" || scan.status === "failed"),
          error: progress.error,
        }
      : null,
  });
}
