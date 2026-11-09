// Cron — gửi Top 5 việc sáng vào Teams kênh Ads (Đợt 15a).
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { sendInboxDigest } from "@/lib/inbox/job"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/inbox_digest")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("inbox_digest", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await sendInboxDigest()
    // Chưa cấu hình kênh = không phải lỗi chạy (việc vẫn ở trang).
    if (r.error && !r.notConfigured) await guard.finish("failure", null, new Error(r.error))
    else await guard.finish("success", r.notConfigured ? `${r.count} việc · chưa cấu hình TEAMS_WEBHOOK_ADS — không gửi` : `đã gửi ${r.count} việc`)
    return NextResponse.json({ success: true, ...r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
