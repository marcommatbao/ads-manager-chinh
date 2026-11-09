// Cron — Sổ kinh nghiệm (Đợt 7). CHỈ ĐỌC nền tảng; ghi data/playbook/.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { syncMetaChunks } from "@/lib/playbook/meta-chunks"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/playbook_meta_sync")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("playbook_meta_sync", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await syncMetaChunks({ backfill: 1 })
    await guard.finish(r.errors.length ? "failure" : "success", `tải ${r.fetched.length} khoảng, có ${r.have}/12, ${r.calls} lượt gọi${r.errors.length ? `, lỗi: ${r.errors[0]}` : ""}`)
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
