// ============================================================
// POST /api/cron/decision-memory-eval
//
// Daily cron (3AM) — closes overdue evaluation windows,
// rolls up final outcomes, ages out expired learning signals.
//
// Auth: CRON_SECRET (Authorization: Bearer <secret> header only in production)
// Risk: low — read/write to data/decision-memory.json only
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { checkAllPendingWindows } from "@/lib/decision-memory/evaluator";
import { friendlyError } from "@/lib/not-configured";

export const dynamic  = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const cronAuth = checkCronAuth(request, "cron/decision_memory_eval");
  if (!cronAuth.ok) return cronAuth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";
  const jobGuard = await startJobRun("decision_memory_eval", triggeredBy);
  if (jobGuard.blocked) return jobGuard.response;

  try {
    const result = await checkAllPendingWindows();
    await jobGuard.finish("success", `checked=${result.checked}, updated=${result.updated}`);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await jobGuard.finish("failure", null, err);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
