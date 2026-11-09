// GET /api/dashboard/trends?company=&platform=all|meta|google&from=&to=&force=1 — Đợt 28: tab "Diễn biến" ở Dashboard.
// CHỈ ĐỌC. Thẻ so kỳ trước (thật / trong mức dao động), biểu đồ ngày, mốc thay đổi (từ "Đã làm & kết quả" + kết quả đo lại
// 7/14 ngày), "Đáng chú ý" (chấm theo Mục tiêu ở Xử lý chiến dịch). Nền tảng chưa kết nối → báo riêng, không hỏng cả tab.
import { NextRequest, NextResponse } from "next/server"
import { requireCompany, requireUser } from "@/lib/case/http"
import { parseRange, vnDate } from "@/lib/case/dates"
import { allowForce } from "@/lib/cost-guard"
import { hasPermission } from "@/lib/permissions"
import { productGroupOf } from "@/lib/case/product"
import { targetFor } from "@/lib/case/targets"
import { leadCaseTarget } from "@/lib/targets/resolve"
import { friendlyError } from "@/lib/not-configured"
import { add, buildCards, buildNotable, previousRange, ZERO, type CampaignPeriods, type Metrics, type TrendDay } from "@/lib/trends/build"
import { googleTrend, metaTrend, type PlatformTrend } from "@/lib/trends/fetch"
import { collectWrites } from "@/lib/writes/feed"
import { readOutcomes, outcomeKey } from "@/lib/writes/job"
import { prettyWriteLabelT } from "@/lib/writes/labels"
import { getT } from "@/lib/i18n/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const total = (cs: CampaignPeriods[], side: "cur" | "prev"): Metrics => cs.reduce((m, c) => add(m, c[side]), { ...ZERO })
function mergeDays(lists: TrendDay[][]): TrendDay[] {
  const m = new Map<string, TrendDay>()
  for (const l of lists) for (const d of l) {
    const x = m.get(d.date) ?? { date: d.date, spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, leads: 0 }
    for (const k of ["spend", "impressions", "clicks", "purchases", "purchaseValue", "leads"] as const) x[k] += d[k]
    m.set(d.date, x)
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const t = await getT()
  const q = request.nextUrl.searchParams
  const co = requireCompany(u.value, q.get("company"))
  if (!co.ok) return co.response
  // Soát bảo mật 07/10: tối đa 90 ngày, không quá hôm nay; "Tải số mới" chỉ người có quyền sửa, 1 lần/60 giây (hạn mức Meta dùng chung).
  const pr = parseRange(q.get("from"), q.get("to"), { defaultDays: 30 })
  if (!pr.ok) return NextResponse.json({ success: false, error: pr.error }, { status: 400 })
  const { from, to } = pr.range
  const platform = q.get("platform") === "meta" ? "meta" : q.get("platform") === "google" ? "google" : "all"
  const force = q.get("force") === "1" && allowForce(`trends|${co.value}|${platform}|${from}|${to}`, hasPermission(u.value.role, "can_edit"))
  const range = { from, to }, prev = previousRange(from, to)

  const wanted: ("meta" | "google")[] = platform === "all" ? ["meta", "google"] : [platform]
  const results: PlatformTrend[] = await Promise.all(wanted.map(async (p) => {
    try { return await (p === "meta" ? metaTrend(co.value, range, force) : googleTrend(co.value, range, force)) }
    catch (e) { return { platform: p, days: [], campaigns: [], error: friendlyError(e instanceof Error ? e.message : String(e)) } }
  }))
  const campaigns = results.flatMap((r) => r.campaigns)
  const days = mergeDays(results.map((r) => r.days))
  const cur = total(campaigns, "cur"), before = total(campaigns, "prev")

  const targetOf = (c: CampaignPeriods) => {
    if (c.kind === "leads") { const t = leadCaseTarget(co.value, c.name); return t ? { target: t.target, ceiling: t.ceiling } : null }
    const t = targetFor(co.value, productGroupOf(c.name))
    return t && t.basis === "cpa" ? { target: t.target, ceiling: t.ceiling } : null // ROAS chấm theo doanh thu — không so bằng chi phí/lượt mua
  }

  // Mốc thay đổi trên biểu đồ: mọi lần tool / người ghi lên tài khoản trong kỳ, kèm kết quả đo lại 7/14 ngày nếu đã đo.
  let markers: { date: string; platform: "meta" | "google"; label: string; by: string; verdict7: string | null; verdict14: string | null }[] = []
  try {
    const { events } = await collectWrites(new Date(), { persist: false })
    const outcomes = readOutcomes()
    markers = events
      .filter((e) => e.company === co.value && (platform === "all" || e.platform === platform) && !e.undoneAt)
      .map((e) => ({ e, date: vnDate(new Date(e.at)) }))
      .filter(({ date }) => date >= prev.from && date <= to)
      .map(({ e, date }) => ({ date, platform: e.platform, label: prettyWriteLabelT(e.label, t), by: e.by, verdict7: outcomes[outcomeKey(e.id, 7)]?.verdict ?? null, verdict14: outcomes[outcomeKey(e.id, 14)]?.verdict ?? null }))
      .slice(0, 200)
  } catch { /* mốc là lớp bổ sung */ }

  return NextResponse.json({
    success: true, company: co.value, platform, range, prevRange: prev,
    errors: results.filter((r) => r.error).map((r) => ({ platform: r.platform, error: r.error })),
    cards: buildCards(cur, before, t), days, markers, notable: buildNotable(campaigns, targetOf, t),
  })
}
