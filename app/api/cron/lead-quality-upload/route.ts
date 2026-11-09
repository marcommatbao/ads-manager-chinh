// Cron — gửi lại sự kiện chất lượng lead đang chờ / lỗi tạm (Đợt 10c · C3). Tối đa 3 lần mỗi sự kiện.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { uploadPending } from "@/lib/leads/quality"
import { companyIds } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/lead_quality_upload")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("lead_quality_upload", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const out: string[] = []
    for (const co of companyIds()) { const r = await uploadPending(co); out.push(`${co}: gửi ${r.sent}, nhận ${r.uploaded}, lỗi ${r.failed}${r.skippedNoAction ? `, ${r.skippedNoAction} chờ tạo hành động` : ""}`) }
    await guard.finish("success", out.join(" · "))
    return NextResponse.json({ success: true, result: out })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
