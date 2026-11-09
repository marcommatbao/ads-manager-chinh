// Cron — Đợt 18f/g: tự đo bản tách Search theo mốc 7/14 ngày + nhắc bản tách bị bỏ dở. Chỉ đọc Google Ads.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runSplitTracking } from "@/lib/search/split-tracking"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/split_tracking")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("split_tracking", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runSplitTracking()
    const summary = `đo ${r.measured.length} mốc (${r.measured.filter((m) => m.verdict === "dung").length} nên hoàn tác) · nhắc ${r.reminders.length} · Teams ${r.sent ? "đã gửi" : r.notConfigured ? "chưa cấu hình" : "không có gì để gửi"}${r.errors.length ? ` · lỗi: ${r.errors.join("; ")}` : ""}`
    await guard.finish(r.errors.length ? "failure" : "success", summary.slice(0, 500), r.errors.length ? new Error(summary) : undefined)
    return NextResponse.json({ success: !r.errors.length, result: summary })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
