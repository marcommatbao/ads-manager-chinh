// POST /api/measure/gtm-fix/undo {company, id} — publish lại bản GTM trước khi tool sửa
// (chỉ khi bản live vẫn là bản tool tạo).
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { GtmFixError, undoGtmFix } from "@/lib/measure/gtm-fix"
import { tagDoctor } from "@/lib/measure/tag-doctor"
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
  if (!b.id || !/^gtmfix_[a-z0-9]+$/.test(b.id)) return NextResponse.json({ success: false, error: "Thiếu mã lần publish" }, { status: 400 })
  const t = await getT()
  try {
    const report = await undoGtmFix(co.value, b.id, actorOf(u.value), t)
    await tagDoctor(co.value, { force: true }, t).catch(() => null)
    return NextResponse.json({ success: true, report })
  } catch (err) {
    if (err instanceof GtmFixError) return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: err.status })
    return fail(err)
  }
}
