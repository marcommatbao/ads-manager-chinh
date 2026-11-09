// GET /api/google/search/xray?company=&from=&to=&force= — Đợt 11a: X-quang Search (tiền theo ý định trong từng chiến dịch…). CHỈ ĐỌC.
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { fail, requireCompany, requireUser } from "@/lib/case/http"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { searchXray } from "@/lib/search/xray"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const sp = request.nextUrl.searchParams
  const co = requireCompany(u.value, sp.get("company"), t)
  if (!co.ok) return co.response
  const pr = parseRange(sp.get("from"), sp.get("to"), { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  try {
    const { keywords, terms, ...x } = await searchXray(co.value, pr.range, { force: sp.get("force") === "1" }, t)
    // Danh sách từ khoá/lượt tìm đầy đủ rất dài — gửi phần đầu cho giao diện.
    return NextResponse.json({ success: true, ...x, keywords: keywords.sort((a, b) => b.cost - a.cost).slice(0, 300), terms: terms.slice(0, 300) })
  } catch (e) { return fail(e, t) }
}
