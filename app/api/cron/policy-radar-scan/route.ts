// ============================================================
// Cron — Policy Radar automated scan
// GET /api/cron/policy-radar-scan (Mon + Thu)
//
// Fetches the auto-fetchable sources (lib/policy-radar/source-registry.ts),
// diffs against the last snapshot, drafts + files a PolicyRadarItem on
// change, and sends a Telegram alert. Read-only against Google's pages —
// never mutates anything outside this app's own data files.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startJobRun } from "@/lib/jobs/cron-guard";
import { scanAllAutoFetchableSources } from "@/lib/policy-radar/scanner";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/policy_radar_scan");
  if (!auth.ok) return auth.response;

  const guard = await startJobRun("policy_radar_scan", request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron");
  if (guard.blocked) return guard.response;

  try {
    const results = await scanAllAutoFetchableSources();
    const changed = results.filter((r) => r.status === "changed").length;
    const errors = results.filter((r) => r.status === "error").length;

    const summary = `${results.length} sources scanned, ${changed} changed, ${errors} errors`;
    await guard.finish(errors === results.length && results.length > 0 ? "failure" : "success", summary);

    return NextResponse.json({ success: true, results });
  } catch (err) {
    await guard.finish("failure", null, err);
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
