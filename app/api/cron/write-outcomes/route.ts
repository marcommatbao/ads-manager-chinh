// Cron — đo lại mọi lần ghi ở mốc 7/14 ngày (Đợt 15b). CHỈ ĐỌC tài khoản quảng cáo.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runWriteOutcomes } from "@/lib/writes/job"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/write_outcomes")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("write_outcomes", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runWriteOutcomes()
    const v = Object.entries(r.verdicts).map(([k, n]) => `${k}=${n}`).join(" ")
    const summary = `${r.events} lần ghi · đo ${r.measured}${v ? ` (${v})` : ""} · bỏ qua ${r.skipped} · để mai ${r.deferred}${r.bad.length ? ` · ${r.bad.length} XẤU đã báo` : ""}${r.errors.length ? ` · ${r.errors.length} lỗi` : ""}`
    // Lỗi đọc số một phần vẫn là chạy xong (lần sau đo lại); không đo được gì mà có lỗi = hỏng.
    await guard.finish(r.measured === 0 && r.errors.length > 0 ? "failure" : "success", summary, r.measured === 0 && r.errors.length ? new Error(r.errors.slice(0, 3).join("; ")) : undefined)
    return NextResponse.json({ success: true, ...r, bad: r.bad.length })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
