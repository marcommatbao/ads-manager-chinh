// Cron — canh đường lead (Đợt 9 · 1). CHỈ ĐỌC pixel + Odoo; ghi data/lead-flows.json; báo Teams kênh IT.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runLeadFlowWatch } from "@/lib/monitor/lead-flow"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/lead_flow_watch")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("lead_flow_watch", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runLeadFlowWatch()
    const summary = r.statuses.map((s) => `${s.flow.id}: ${s.status}`).join(" · ") + (r.alerts.length ? ` · báo: ${r.alerts.join(", ")}` : "")
    await guard.finish("success", summary)
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
