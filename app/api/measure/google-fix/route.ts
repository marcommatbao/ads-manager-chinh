// POST /api/measure/google-fix {company, fixIds[], validateOnly, confirmText?, acknowledgeNoSignal?}
// Sửa mục tiêu đặt giá / hành động chính trên Google (user chốt 27/09). Cần can_edit + quyền công ty.
// validateOnly=true: Google chỉ kiểm, KHÔNG ghi. Ghi thật cần confirmText "XAC NHAN".
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { tagDoctor } from "@/lib/measure/tag-doctor"
import { GoalFixError, needsNoSignalAck, runGoalFix } from "@/lib/measure/google-goal-fix"
import { friendlyError } from "@/lib/not-configured";
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; fixIds?: unknown; validateOnly?: boolean; confirmText?: string; acknowledgeNoSignal?: boolean }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  const fixIds = Array.isArray(b.fixIds) ? b.fixIds.filter((x): x is string => typeof x === "string") : []
  const t = await getT()
  try {
    const report = await tagDoctor(co.value, {}, t)
    const exec = await runGoalFix({
      company: co.value, report, fixIds, actor: actorOf(u.value), validateOnly: b.validateOnly !== false,
      confirmText: b.confirmText, acknowledgeNoSignal: !!b.acknowledgeNoSignal,
    }, t)
    if (exec.mode === "write") await tagDoctor(co.value, { force: true }, t).catch(() => null) // số mới cho lần mở sau
    return NextResponse.json({ success: true, execution: exec, needsAck: needsNoSignalAck(report, report.fixes.filter((f) => fixIds.includes(f.id))) })
  } catch (err) {
    if (err instanceof GoalFixError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err)
  }
}
