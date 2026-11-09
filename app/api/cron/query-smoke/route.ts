// Cron — Đợt 20a: tự chạy thử các hàm đọc thật (Google Ads / Meta, 1 ngày). Chỉ đọc. Lỗi MỚI / đã hết lỗi → Teams kênh IT.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runSmoke } from "@/lib/smoke/run"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/query_smoke")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("query_smoke", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runSmoke()
    const bad = r.run.results.filter((x) => !x.ok)
    const ok = r.run.results.filter((x) => x.ok && !x.skipped).length, skipped = r.run.results.filter((x) => x.skipped).length
    const summary = `${ok} chạy được · ${bad.length} hỏng (${r.broken} mới) · ${skipped} bỏ qua${bad.length ? ` — ${bad.map((x) => `${x.company} ${x.label}: ${x.detail}`).join(" | ")}` : ""} · Teams ${r.sent ? "đã gửi" : r.notConfigured ? "chưa cấu hình" : "không cần gửi"}`
    await guard.finish(bad.length ? "failure" : "success", summary.slice(0, 1000), bad.length ? new Error(summary.slice(0, 1000)) : undefined)
    return NextResponse.json({ success: !bad.length, result: summary, run: r.run })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
