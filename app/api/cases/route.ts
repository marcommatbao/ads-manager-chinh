// GET  /api/cases?company=MBI            — danh sách phiên
// POST /api/cases {company, campaignId, platform?, from?, to?} — mở phiên (hoặc trả phiên đang mở) + kéo bằng chứng
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import { localizeCase } from "@/lib/case/localize"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { listCases, openCase } from "@/lib/case/service"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, MIN_CASE_DAYS, parseRange } from "@/lib/case/dates"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"), t)
  if (!co.ok) return co.response
  const cases = listCases({ company: co.value }).map(({ evidence: _e, diagnosis: _d, ...c }) => c) // eslint-disable-line @typescript-eslint/no-unused-vars
  return NextResponse.json({ success: true, cases })
}

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const body = (await request.json().catch(() => ({}))) as { company?: string; campaignId?: string; platform?: string; from?: string; to?: string }
  const co = requireCompany(u.value, body.company, t)
  if (!co.ok) return co.response
  if (!body.campaignId || !/^\d+$/.test(body.campaignId)) {
    return NextResponse.json({ success: false, error: t("libcase.s.svc.err.campaignId") }, { status: 400 })
  }
  if (body.platform !== undefined && body.platform !== "google" && body.platform !== "facebook") {
    return NextResponse.json({ success: false, error: t("libcase.s.api.platform") }, { status: 400 })
  }
  // Khoảng lưu làm mốc "trước" cho đo lại 7/14 ngày → tối thiểu 7 ngày (user chốt 28/09).
  const pr = parseRange(body.from, body.to, { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS, minDays: MIN_CASE_DAYS }, t)
  if (!pr.ok) return NextResponse.json({ success: false, error: t("libcase.s.api.rangeErr", { error: pr.error }) }, { status: 400 })
  const range = pr.range
  try {
    const c = await openCase({ company: co.value, campaignId: body.campaignId, range, actor: actorOf(u.value), platform: body.platform === "facebook" ? "facebook" : "google" })
    return NextResponse.json({ success: true, case: localizeCase(c, t) })
  } catch (err) {
    return fail(err, t)
  }
}
