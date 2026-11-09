// ============================================================
// Cron — giám sát đo lường (Đợt 6 · A). CHỈ ĐỌC; ghi data/measure-snapshots/; báo Teams khi có thay đổi.
// ============================================================
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runMonitor } from "@/lib/monitor/measure-monitor"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/measure_monitor")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("measure_monitor", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const run = await runMonitor()
    const bad = run.changes.filter((c) => c.level === "bad").length
    await guard.finish("success", `${run.changes.length} thay đổi (${bad} hỏng mới)${run.teams.sent ? ", đã gửi Teams" : run.teams.skipped ? `, ${run.teams.skipped}` : run.teams.error ? `, Teams lỗi: ${run.teams.error}` : ""}`)
    return NextResponse.json({ success: true, run })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
