// GET /api/meta/xray?company=&from=&to=&detail=1&force=1 — Đợt 12 (D): X-quang Meta + việc nên làm. CHỈ ĐỌC.
// Mặc định 2 lượt gọi Meta (nhớ 60 phút); detail=1 thêm 4 lượt (vị trí, thiết bị, tuổi/giới, giờ) — app Meta ~60 lượt/giờ.
import { NextRequest, NextResponse } from "next/server"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { hasPermission } from "@/lib/permissions"
import { metaXray } from "@/lib/meta/xray"
import { recommendMeta } from "@/lib/meta/recommend"
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"))
  if (!co.ok) return co.response
  const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  try {
    const t = await getT()
    const x = await metaXray(co.value, pr.range, { detail: sp.get("detail") === "1", force: sp.get("force") === "1" }, t)
    return NextResponse.json({ success: true, ...x, recommendations: recommendMeta(x, t), canEdit: hasPermission(u.value.role, "can_edit") })
  } catch (e) { return fail(e) }
}
