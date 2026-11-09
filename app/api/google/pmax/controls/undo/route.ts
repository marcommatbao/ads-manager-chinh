// POST /api/google/pmax/controls/undo {company, id} — hoàn tác một lần áp dụng (gỡ đúng tài nguyên tool tạo).
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { customerIdOf, PmaxControlError, undoControls } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; id?: string }
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  if (!b.id || !/^pmaxc_[a-z0-9]+$/.test(b.id)) return NextResponse.json({ success: false, error: t("libgoogle.rt.noExecId") }, { status: 400 })
  try {
    return NextResponse.json({ success: true, report: await undoControls(co.value, b.id, actorOf(u.value), customerIdOf(co.value), t) })
  } catch (err) {
    if (err instanceof PmaxControlError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err, t)
  }
}
