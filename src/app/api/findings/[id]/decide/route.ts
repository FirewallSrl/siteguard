import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { executeAction } from "@/lib/actions/execute";

const schema = z.object({
  decision: z.enum(["ai", "manual", "ignore"]),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id: findingId } = await params;

  try {
    const { decision } = schema.parse(await req.json());
    const finding = await prisma.finding.findUnique({
      where: { id: findingId },
      include: {
        actions: {
          where: { status: "proposed" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!finding) {
      return NextResponse.json({ error: "Finding non trovato" }, { status: 404 });
    }

    if (decision === "ignore") {
      await prisma.finding.update({
        where: { id: findingId },
        data: { status: "ignored" },
      });
      if (finding.actions[0]) {
        await prisma.action.update({
          where: { id: finding.actions[0].id },
          data: { status: "rejected" },
        });
      }
      return NextResponse.json({ ok: true, decision: "ignore" });
    }

    if (decision === "manual") {
      const action =
        finding.actions[0] ??
        (await prisma.action.create({
          data: {
            siteId: finding.siteId,
            findingId,
            mode: "manual",
            status: "approved",
            title: `Manuale: ${finding.title}`,
            payload: finding.proposedPlan ?? "{}",
          },
        }));

      await prisma.action.update({
        where: { id: action.id },
        data: { mode: "manual", status: "approved" },
      });

      await prisma.auditLog.create({
        data: {
          siteId: finding.siteId,
          event: "action.manual",
          detail: JSON.stringify({ findingId, actionId: action.id }),
        },
      });

      return NextResponse.json({
        ok: true,
        decision: "manual",
        actionId: action.id,
        checklist: JSON.parse(finding.proposedPlan || "null"),
      });
    }

    // decision === "ai"
    let action = finding.actions[0];
    if (!action) {
      action = await prisma.action.create({
        data: {
          siteId: finding.siteId,
          findingId,
          mode: "ai",
          status: "approved",
          title: finding.title,
          payload: JSON.stringify({
            plan: JSON.parse(finding.proposedPlan || "null"),
            findingType: finding.type,
          }),
        },
      });
    } else {
      action = await prisma.action.update({
        where: { id: action.id },
        data: { mode: "ai", status: "approved" },
      });
    }

    const useInngest = Boolean(process.env.INNGEST_EVENT_KEY);
    if (useInngest) {
      await inngest.send({
        name: "action/apply.requested",
        data: { actionId: action.id },
      });
      return NextResponse.json({
        ok: true,
        decision: "ai",
        actionId: action.id,
        mode: "async",
      });
    }

    const result = await executeAction(action.id);
    return NextResponse.json({
      ok: true,
      decision: "ai",
      actionId: action.id,
      mode: "sync",
      result,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Errore";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
