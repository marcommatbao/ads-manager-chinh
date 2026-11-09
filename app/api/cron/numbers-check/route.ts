// Cron — ĐỐI CHIẾU SỐ hằng tuần (Đợt 14d): trang tool vs truy vấn gốc Google/Meta, lệch > 5% báo Teams IT. CHỈ ĐỌC.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runNumbersCheckJob } from "@/lib/jobs/numbers-check"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/numbers_check")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("numbers_check", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runNumbersCheckJob()
    const bad = r.result.checks.filter((c) => c.status !== "ok")
    const summary = bad.length ? `${bad.length}/${r.result.checks.length} chỗ lệch/không đọc được${r.alerted ? " · đã báo Teams" : " · KHÔNG gửi được cảnh báo"}` : `${r.result.checks.length}/${r.result.checks.length} khớp`
    await guard.finish("success", summary)
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
