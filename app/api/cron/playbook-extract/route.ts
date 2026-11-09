// Cron — Sổ kinh nghiệm (Đợt 7). CHỈ ĐỌC nền tảng; ghi data/playbook/.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { startJobRun } from "@/lib/jobs/cron-guard"
import { runPlaybookExtract } from "@/lib/playbook/run"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/playbook_extract")
  if (!auth.ok) return auth.response
  const triggeredBy = request.headers.get("x-manual-trigger") ? `manual:${request.headers.get("x-manual-trigger")}` : "cron"
  const guard = await startJobRun("playbook_extract", triggeredBy)
  if (guard.blocked) return guard.response
  try {
    const r = await runPlaybookExtract()
    await guard.finish("success", r.summary)
    return NextResponse.json({ success: true, result: r })
  } catch (err) {
    await guard.finish("failure", null, err)
    return NextResponse.json({ success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") }, { status: 500 })
  }
}
