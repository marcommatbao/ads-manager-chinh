// Cron — BÁO SÁNG HỆ THỐNG (Đợt 14b): 08:05 gửi sức khoẻ tool (job, kết nối, lần ghi hôm qua, thí nghiệm). CHỈ ĐỌC.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runSystemMorning } from "@/lib/jobs/morning-system"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/system_morning")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("system_morning", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runSystemMorning()
    const summary = `${r.card.title} · ${r.sent ? `đã gửi (${r.channel})` : `KHÔNG gửi được: ${r.error ?? "chưa cấu hình kênh"}`}`
    // Không gửi được = job THẤT BẠI (hiện đỏ ở trang Jobs) — báo sáng mà không tới ai thì vô nghĩa.
    await guard.finish(r.sent ? "success" : "failure", summary, r.sent ? undefined : new Error(summary))
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
