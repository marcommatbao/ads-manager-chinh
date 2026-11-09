// Cron — báo cáo quản lý tuần (Đợt 15c), thứ Hai 08:30 VN. Dựng + lưu + gửi Teams kênh Ads (thiếu webhook thì chỉ lưu).
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runWeeklyReport } from "@/lib/reports/weekly"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/weekly_report")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("weekly_report", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runWeeklyReport()
    const sent = r.sent?.sent ? "đã gửi Teams" : r.sent?.notConfigured ? "chưa cấu hình TEAMS_WEBHOOK_ADS — chỉ lưu trang" : `gửi Teams lỗi: ${r.sent?.error ?? "?"}`
    const summary = `${r.label} · ${sent}${r.errors.length ? ` · không đọc được: ${r.errors.join("; ")}` : ""}`
    const failed = !!r.sent && !r.sent.sent && !r.sent.notConfigured
    await guard.finish(failed ? "failure" : "success", summary.slice(0, 500), failed ? new Error(summary) : undefined)
    return NextResponse.json({ success: !failed, result: summary })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
