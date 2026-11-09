// Cron — dựng hộp "Việc nên làm hôm nay" (Đợt 15a). CHỈ ĐỌC tài khoản quảng cáo.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { buildInbox } from "@/lib/inbox/job"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/inbox_build")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("inbox_build", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const snap = await buildInbox()
    const summary = `${snap.items.length} việc${snap.errors.length ? ` · ${snap.errors.length} nguồn không đọc được (${snap.errors.map((e) => `${e.company}/${e.source}`).join(", ")})` : ""}`
    // Hỏng hết mọi nguồn = lỗi thật; hỏng một phần vẫn là chạy xong (có ghi rõ).
    await guard.finish(snap.items.length === 0 && snap.errors.length > 0 ? "failure" : "success", summary, snap.items.length === 0 && snap.errors.length ? new Error(summary) : undefined)
    return NextResponse.json({ success: true, items: snap.items.length, errors: snap.errors })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
