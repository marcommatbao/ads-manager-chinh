// ============================================================
// Cron — Alert Engine scan
// GET /api/cron/alert-scan (every 30 min, manual-only until live-verified)
//
// Gathers real per-campaign metrics (spend, CPL, spend-spike, zero-conv,
// creative fatigue) and runs them through ALERT_RULES (lib/alert-rules.ts)
// via runAlertEngine(). Read-only against ad platforms — never mutates a
// campaign. Fixes a real gap: runAlertEngine had zero callers anywhere in
// this codebase before this route existed, so CPL/fatigue/spend-spike
// alerts were built but never actually fired. budget_low/budget_depleted
// are not part of this scan — lib/budget-monitor.ts already owns those.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { gatherAlertMetrics } from "@/lib/alert-metrics-gather";
import { runAlertEngine } from "@/lib/alert-engine";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/alert_scan");
  if (!auth.ok) return auth.response;

  const triggeredBy = request.headers.get("x-manual-trigger")
    ? `manual:${request.headers.get("x-manual-trigger")}`
    : "cron";

  const guard = await startJobRun("alert_scan", triggeredBy);
  if (guard.blocked) return guard.response;

  const startMs = Date.now();

  try {
    const metrics = await gatherAlertMetrics();
    const newAlerts = await runAlertEngine(metrics);

    const summary = `${metrics.length} campaigns scanned, ${newAlerts.length} new alerts`;
    await guard.finish("success", summary);

    return NextResponse.json({
      success: true,
      campaignsScanned: metrics.length,
      newAlerts: newAlerts.length,
      data: newAlerts,
      duration: Date.now() - startMs,
    });
  } catch (err) {
    await guard.finish("failure", null, err);
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
