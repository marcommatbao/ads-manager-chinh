// ============================================================
// Cron — đo lại phiên "Xử lý chiến dịch" tới hạn (mốc 7 và 14 ngày sau khi thực hiện)
// GET /api/cron/case-remeasure — CHỈ ĐỌC Google/Meta; ghi kết quả vào phiên.
// Kèm nhắc Microsoft Teams việc giao người quá 3 ngày (tắt khi chưa có CASE_TASK_TEAMS_WEBHOOK).
// Mốc 14 ngày mà chi phí/đơn không giảm (và chiến dịch còn chạy) → mở lại phiên ở bước 4.
// ============================================================
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runDueRemeasures } from "@/lib/case/service"
import { remindOverdueTasks } from "@/lib/case/board"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/case_remeasure")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("case_remeasure", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runDueRemeasures()
    // Nhắc việc hỏng không được làm hỏng lượt đo lại — ghi vào kết quả, không ném.
    const remind = await remindOverdueTasks().catch((e) => ({ enabled: true, sent: 0, tasks: 0, error: e instanceof Error ? e.message : String(e) }))
    const remindNote = remind.enabled ? `, nhắc ${remind.tasks} việc quá hạn${remind.error ? ` (lỗi: ${remind.error})` : ""}` : ", nhắc việc: tắt"
    await guard.finish(r.errors.length ? "failure" : "success", `đo ${r.checked} phiên, mở lại ${r.reopened}${r.errors.length ? `, lỗi ${r.errors.length}` : ""}${remindNote}`)
    return NextResponse.json({ success: r.errors.length === 0, ...r, remind })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
