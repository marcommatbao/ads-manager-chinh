import { startJobRun } from "./cron-guard"
import { companyIds } from "@/lib/companies/registry"
import { snapshotAllConnectors } from "@/lib/connectors/engine"
import { sweepQualityCheckpoints } from "@/lib/inbox/quality-workflow"
import { NextResponse } from "next/server"

/** No provider reads or sends. Gate precedes snapshot/workflow access. */
export async function runQualityCheckpoint(triggeredBy = "cron") {
  const guard = await startJobRun("quality_checkpoint", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const snapshot = snapshotAllConnectors()
    const counts = await sweepQualityCheckpoints(companyIds(), { google_ads: snapshot.google_ads })
    const summary = Object.entries(counts).map(([key, value]) => `${key}=${value}`).join("; ")
    await guard.finish("success", summary)
    return NextResponse.json({ success: true, runId: guard.runId, ...counts })
  } catch {
    // Do not place source payloads, paths or untrusted exception text in history.
    await guard.finish("failure", null, "quality_checkpoint_failed")
    return NextResponse.json({ success: false, error: "quality_checkpoint_failed" }, { status: 503 })
  }
}
