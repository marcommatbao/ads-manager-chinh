// Cron — BÁO SÁNG đường lead (29/09): 8:00 mỗi ngày gửi tình trạng form → CRM kể cả khi bình thường. CHỈ ĐỌC pixel + Odoo.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runLeadFlowMorning } from "@/lib/monitor/lead-flow"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/lead_flow_morning")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("lead_flow_morning", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runLeadFlowMorning()
    const summary = `${r.report.title} · ${r.sent ? `đã gửi (${r.channel})` : `KHÔNG gửi được: ${r.error ?? "chưa cấu hình kênh"}`}`
    // Không gửi được = job THẤT BẠI (hiện đỏ ở trang Jobs) — báo sáng mà không tới ai thì vô nghĩa.
    await guard.finish(r.sent ? "success" : "failure", summary, r.sent ? undefined : new Error(summary))
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
