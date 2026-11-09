// POST /api/measure/google-fix/undo {company, id} — hoàn tác một lần sửa Google (chỉ mục còn đúng như lúc tool đặt).
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { GoalFixError, undoGoalFix } from "@/lib/measure/google-goal-fix"
import { friendlyError } from "@/lib/not-configured";
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; id?: string }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  if (!b.id || !/^gfix_[a-z0-9]+$/.test(b.id)) return NextResponse.json({ success: false, error: "Thiếu mã lần ghi" }, { status: 400 })
  try {
    return NextResponse.json({ success: true, report: await undoGoalFix(co.value, b.id, actorOf(u.value), await getT()) })
  } catch (err) {
    if (err instanceof GoalFixError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err)
  }
}
