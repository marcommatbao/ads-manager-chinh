// Cron — PMax tự động (Đợt 10b): chỉ loại việc người dùng đã bật; Kiểm trước → ghi → đọc lại → báo Teams.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runPmaxAuto } from "@/lib/pmax/auto"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/pmax_auto_controls")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("pmax_auto_controls", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runPmaxAuto()
    await guard.finish("success", r.map((x) => `${x.company}: ${x.applied ? `${x.applied} việc` : x.skipped}`).join(" · "))
    return NextResponse.json({ success: true, result: r.map(({ execution, ...x }) => ({ ...x, status: execution?.status, errors: execution?.errors })) })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
