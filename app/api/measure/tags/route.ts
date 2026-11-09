// GET /api/measure/tags?company=MBI&force=1 — Chẩn đoán gắn thẻ (CHỈ ĐỌC) + lịch sử sửa Google.
import { NextRequest, NextResponse } from "next/server"
import { MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { tagDoctor } from "@/lib/measure/tag-doctor"
import { CONFIRM_TEXT, listGoalFixes, needsNoSignalAck } from "@/lib/measure/google-goal-fix"
import { GTM_CONFIRM_TEXT, MAX_GTM_FIXES, listGtmFixes } from "@/lib/measure/gtm-fix"
import { gtmApiConfigured, gtmServiceEmail } from "@/lib/measure/gtm-api"
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"))
  if (!co.ok) return co.response
  let range: { from: string; to: string } | undefined
  if (sp.get("from") || sp.get("to")) {
    const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: 30, maxDays: MAX_RANGE_DAYS })
    if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
    range = pr.range
  }
  try {
    const report = await tagDoctor(co.value, { force: sp.get("force") === "1", range }, await getT())
    // Cờ cho giao diện: chọn riêng việc bật Mua hàng thì có cần xác nhận "mất tín hiệu" không.
    const ackIfAlone = Object.fromEntries(report.fixes.map((f) => [f.id, needsNoSignalAck(report, [f])]))
    // Tên trường "gtmFix" (không phải "gtm") — `report.gtm` (GtmContainer[], mục 2 "Thẻ Facebook Pixel
    // trong GTM") đã chiếm khoá "gtm" qua `...report`; đặt trùng tên sẽ bị object literal ghi đè mất mảng đó.
    return NextResponse.json({ success: true, ...report, ackIfAlone, confirmText: CONFIRM_TEXT, history: listGoalFixes(co.value).slice(0, 20),
      gtmFix: { apiConfigured: gtmApiConfigured(), serviceEmail: gtmServiceEmail(), confirmText: GTM_CONFIRM_TEXT, maxFixes: MAX_GTM_FIXES, history: listGtmFixes(co.value).slice(0, 20) } })
  } catch (err) {
    return fail(err)
  }
}
