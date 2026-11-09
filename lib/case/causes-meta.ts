// ============================================================
// Bước 4 (Facebook) — nguyên nhân từ bằng chứng đã đo
// ============================================================
// Cùng luật với Google: xếp theo tiền, nêu rõ phần thiếu, luôn liệt kê giả
// thuyết đã loại. Các ngưỡng dưới đây là quy ước của tool (không phải số Meta
// công bố) trừ mốc 50 sự kiện/tuần — mức Meta nói một nhóm quảng cáo cần để ra
// khỏi giai đoạn học.

import { FUNNEL_EVENTS } from "./meta-evidence"
import { isReels, placementLabel } from "./meta-placements"
import { isLeadOptimized, metaGoalKind } from "./goal-kind"
import type { Cause, CheckedOk, Diagnosis, MetaEvidence, MetaPlacementSlice } from "./types"
import { makeT, type TFunction } from "@/lib/i18n/translate"

/** Meta: nhóm quảng cáo cần ~50 sự kiện tối ưu mỗi tuần để ra khỏi giai đoạn học. */
export const EVENTS_PER_WEEK_TO_LEARN = 50
/** Tần suất trong kỳ từ mức này trở lên = cùng người xem quá nhiều lần. */
export const HIGH_FREQUENCY = 4
/** Vị trí chiếm ít nhất tỉ trọng chi phí này mới xét. */
export const PLACEMENT_MIN_SHARE = 0.1
/** Chi phí/kết quả ở vị trí gấp ngần này phần còn lại = vị trí đắt. */
export const PLACEMENT_COST_RATIO = 2
/** Cần ít nhất ngần này kết quả để so vị trí theo một chỉ số. */
// 10 từng quá thấp: đo 27/09 chiến dịch MBI có 27 lượt xem trang đích cho 18 vị
// trí → tool đòi loại Bảng tin dựa trên vài lượt lẻ.
export const MIN_RESULTS_TO_COMPARE = 30
/** Click liên kết tới trang đích dưới tỉ lệ này (khi đủ click) = đứt giữa click và trang. */
// Ngưỡng click→trang đích ở tệp THUẦN (giao diện cũng dùng; nhập từ tệp này kéo meta-client + fs vào gói trình duyệt).
export { MIN_LANDING_RATE, MIN_CLICKS_FOR_LANDING_RATE } from "./meta-thresholds"

/** Đợt 12: "lượt mua" chỉ-xem ≥ 60% và ≥ 10 lượt → nguyên nhân (đo 29/09 tài khoản ~90%). */
export const VIEW_HEAVY_SHARE = 0.6
export const VIEW_HEAVY_MIN_PURCHASES = 10
import { MIN_LANDING_RATE, MIN_CLICKS_FOR_LANDING_RATE } from "./meta-thresholds"
/** Meta báo ≥ ngần này lượt mua mới đối chiếu Odoo; Odoo < tỉ lệ này × Meta = lệch lớn. */
export const ODOO_MIN_META_PURCHASES = 5
export const ODOO_GAP_RATIO = 0.3

const pct = (x: number) => `${Math.round(x * 100)}%`

const VI_T = makeT("vi")
/** Nhãn sự kiện phễu theo ngôn ngữ (FUNNEL_EVENTS giữ bản tiếng Việt). */
export const funnelLabel = (key: string, label: string, t: TFunction = VI_T): string => (["purchase", "add_payment_info", "initiate_checkout", "add_to_cart", "complete_registration", "lead", "custom", "landing_page_view"].includes(key) ? t(`libcase.c.fe.${key}` as never) : label)
export interface PlacementRow { key: string; label: string; cost: number; results: number; adsetIds: string[] }
export interface PlacementVerdict extends PlacementRow { share: number; costPerResult: number | null; restCostPerResult: number | null; excess: number; flagged: boolean }

/** Chỉ số so vị trí: sâu nhất mà đủ số. Trả null khi không chỉ số nào đủ để so. */
export function placementMetric(ev: MetaEvidence, t: TFunction = VI_T): { key: "purchases" | "leads" | "optResults" | "landingViews"; label: string } | null {
  const sum = (f: (p: MetaPlacementSlice) => number) => ev.placements.reduce((s, p) => s + f(p), 0)
  // Đợt 23 (3d): chiến dịch thu lead so vị trí theo lead (không theo lượt mua — luôn ~0).
  if (metaGoalKind(ev.campaign.objective) === "leads") {
    if (sum((p) => p.leads ?? 0) >= MIN_RESULTS_TO_COMPARE) return { key: "leads", label: t("libcase.c.cm.m.leads") }
  } else if (sum((p) => p.purchases) >= MIN_RESULTS_TO_COMPARE) return { key: "purchases", label: t("libcase.c.cm.m.purchases") }
  if (sum((p) => p.optResults) >= MIN_RESULTS_TO_COMPARE) return { key: "optResults", label: t("libcase.c.cm.m.opt") }
  if (sum((p) => p.landingViews) >= MIN_RESULTS_TO_COMPARE) return { key: "landingViews", label: t("libcase.c.cm.m.land") }
  return null
}

export function judgePlacements(ev: MetaEvidence, t: TFunction = VI_T): { metric: ReturnType<typeof placementMetric>; rows: PlacementVerdict[] } {
  const metric = placementMetric(ev, t)
  const by = new Map<string, PlacementRow>()
  for (const p of ev.placements) {
    const r = by.get(p.key) ?? { key: p.key, label: t("libcase.c.numLocale") === "vi-VN" ? p.label : placementLabel(p.key, t), cost: 0, results: 0, adsetIds: [] }
    r.cost += p.cost
    r.results += metric ? p[metric.key] ?? 0 : 0
    if (!r.adsetIds.includes(p.adsetId)) r.adsetIds.push(p.adsetId)
    by.set(p.key, r)
  }
  const totalCost = [...by.values()].reduce((s, r) => s + r.cost, 0)
  const totalRes = [...by.values()].reduce((s, r) => s + r.results, 0)
  const rows = [...by.values()].map((r) => {
    const share = totalCost > 0 ? r.cost / totalCost : 0
    const restRes = totalRes - r.results
    const restCpr = restRes > 0 ? (totalCost - r.cost) / restRes : null
    const cpr = r.results > 0 ? r.cost / r.results : null
    const expected = restCpr ? r.results * restCpr : r.cost
    const excess = Math.max(0, r.cost - expected)
    const flagged = !!metric && !!restCpr && share >= PLACEMENT_MIN_SHARE
      && (cpr === null ? r.cost >= PLACEMENT_COST_RATIO * restCpr : cpr >= PLACEMENT_COST_RATIO * restCpr)
    return { ...r, share, costPerResult: cpr, restCostPerResult: restCpr, excess, flagged }
  }).sort((a, b) => b.cost - a.cost)
  return { metric, rows }
}

/** Sự kiện sâu nhất có đủ 50/tuần trên CẢ nhóm sản phẩm (mọi chiến dịch cùng sản phẩm gộp lại). */
export function bestLearnableEvent(ev: MetaEvidence, t: TFunction = VI_T): { key: string; label: string; perWeek: number } | null {
  // Thu lead: sự kiện cuối là "lead" — bỏ các sự kiện mua hàng nằm trước nó trong phễu.
  const from = metaGoalKind(ev.campaign.objective) === "leads" ? FUNNEL_EVENTS.findIndex((e) => e.key === "lead") : 0
  for (const e of FUNNEL_EVENTS.slice(from)) {
    if (e.key === "custom") continue // gộp mọi tên tự đặt — không chọn được một sự kiện cụ thể từ số này
    const perWeek = ev.peers.eventsPerWeek[e.key] ?? 0
    if (perWeek >= EVENTS_PER_WEEK_TO_LEARN) return { key: e.key, label: funnelLabel(e.key, e.label, t), perWeek }
  }
  return null
}

export function diagnoseMeta(ev: MetaEvidence, t: TFunction = makeT("vi")): Diagnosis {
  const NL = t("libcase.c.numLocale")
  const vnd = (n: number) => `₫${Math.round(n).toLocaleString(NL)}`
  const dec = (x: number, d: number) => x.toLocaleString(NL, { maximumFractionDigits: d })
  const causes: Cause[] = []
  const notCauses: CheckedOk[] = []
  const context: string[] = []
  const c = ev.campaign
  const spent = ev.adsets.filter((a) => a.cost > 0)
  const share = (m: number) => (c.cost > 0 ? m / c.cost : null)
  const weeks = Math.max(ev.peers.weeks, 1 / 7)
  // Đợt 23 (3d): chiến dịch thu lead — "kết quả cuối" là lead, không phải Mua hàng. Các kiểm chỉ đúng với đơn mua (giá trị đơn,
  // lượt mua chỉ-xem, lệch Odoo) bỏ qua; nhóm tối ưu theo sự kiện khác lead thì báo theo lead.
  const leads = metaGoalKind(c.objective) === "leads"
  if (leads) context.push(t("libcase.c.cm.ctx.lead"))

  // 1. Tối ưu theo sự kiện không phải Mua hàng (thu lead: không phải lead).
  const notLead = leads ? spent.filter((a) => !isLeadOptimized(a)) : []
  if (leads) {
    if (notLead.length) {
      const money = notLead.reduce((s, a) => s + a.cost, 0)
      causes.push({
        id: "opt-event-not-lead", title: t("libcase.c.cm.optLead.title", { events: [...new Set(notLead.map((a) => a.optEvent.label))].join(", ") }),
        detail: t("libcase.c.cm.optLead.detail"),
        money, share: share(money), shareOf: "campaign_cost",
        evidence: notLead.map((a) => ({ label: t("libcase.c.cm.opt.ev", { name: a.name, event: a.optEvent.label }), value: t("libcase.c.cm.opt.val", { n: a.optResults, approx: a.optResultsApprox ? t("libcase.c.cm.opt.approx") : "" }), cost: a.cost })),
      })
    } else if (spent.length) notCauses.push({ id: "opt-event-not-lead", text: t("libcase.c.cm.optLead.ok") })
  }
  const notPurchase = leads ? [] : spent.filter((a) => !a.optEvent.isPurchase)
  if (leads) { /* đã xét ở trên */ } else if (notPurchase.length) {
    const money = notPurchase.reduce((s, a) => s + a.cost, 0)
    const events = [...new Set(notPurchase.map((a) => a.optEvent.label))]
    causes.push({
      id: "opt-event-not-purchase", title: t("libcase.c.cm.optBuy.title", { events: events.join(", ") }),
      detail: notPurchase.some((a) => a.optEvent.type === "OTHER")
        ? t("libcase.c.cm.optBuy.detailCustom")
        : t("libcase.c.cm.optBuy.detail"),
      money, share: share(money), shareOf: "campaign_cost",
      evidence: notPurchase.map((a) => ({ label: t("libcase.c.cm.opt.ev", { name: a.name, event: a.optEvent.label }), value: t("libcase.c.cm.opt.val", { n: a.optResults, approx: a.optResultsApprox ? t("libcase.c.cm.opt.approx") : "" }), cost: a.cost })),
    })
  } else if (spent.length) notCauses.push({ id: "opt-event-not-purchase", text: t("libcase.c.cm.optBuy.ok") })

  // 2. Meta không học được.
  const fail = spent.filter((a) => a.learning.status === "FAIL")
  if (fail.length) {
    const money = fail.reduce((s, a) => s + a.cost, 0)
    causes.push({
      id: "learning-fail", title: t("libcase.c.cm.learn.title", { n: fail.length, total: spent.length }),
      detail: t("libcase.c.cm.learn.detail", { need: EVENTS_PER_WEEK_TO_LEARN }),
      money, share: share(money), shareOf: "campaign_cost",
      evidence: fail.map((a) => ({ label: a.name, value: t("libcase.c.cm.learn.ev", { n: a.learning.conversions ?? "?" }), cost: a.cost })),
    })
  } else if (spent.some((a) => a.learning.status)) notCauses.push({ id: "learning-fail", text: t("libcase.c.cm.learn.ok") })

  // 3. Quá mỏng: nhiều chiến dịch cùng sản phẩm chia nhau ít sự kiện.
  const bestEvent = ev.peers.eventsPerWeek[leads ? "lead" : "purchase"] ?? 0
  const optPerWeek = spent.reduce((s, a) => s + a.optResults, 0) / weeks
  if (ev.peers.activeCampaigns >= 2 && optPerWeek < EVENTS_PER_WEEK_TO_LEARN) {
    causes.push({
      id: "budget-thin", title: t("libcase.c.cm.thin.title", { n: ev.peers.activeCampaigns }),
      detail: t("libcase.c.cm.thin.detail", { opt: dec(optPerWeek, 1), best: dec(bestEvent, 1), unit: leads ? t("libcase.c.cm.thin.unitLead") : t("libcase.c.cm.thin.unitBuy"), need: EVENTS_PER_WEEK_TO_LEARN }),
      money: null, share: null, shareOf: null,
      evidence: FUNNEL_EVENTS.filter((e) => (ev.peers.eventsPerWeek[e.key] ?? 0) > 0).map((e) => ({ label: funnelLabel(e.key, e.label, t), value: t("libcase.c.cm.thin.ev", { n: dec(ev.peers.eventsPerWeek[e.key], 1) }) })),
    })
  }

  // 3b. Click không tới trang đích (hoặc pixel không ghi lượt xem trang).
  if (c.linkClicks >= MIN_CLICKS_FOR_LANDING_RATE) {
    const rate = c.landingViews / c.linkClicks
    if (rate < MIN_LANDING_RATE) {
      causes.push({
        id: "click-no-landing", title: t("libcase.c.cm.land.title", { clicks: c.linkClicks.toLocaleString(NL), views: c.landingViews.toLocaleString(NL), rate: pct(rate) }),
        detail: t("libcase.c.cm.land.detail"),
        money: null, share: null, shareOf: null,
        evidence: [{ label: t("libcase.c.cm.land.ev1"), value: c.linkClicks.toLocaleString(NL) }, { label: t("libcase.c.cm.land.ev2"), value: c.landingViews.toLocaleString(NL) }],
      })
    } else notCauses.push({ id: "click-no-landing", text: t("libcase.c.cm.land.ok", { rate: pct(rate) }) })
  }

  // 4. Mua hàng không mang giá trị.
  if (leads) { /* thu lead — không có giá trị đơn */ } else if (c.purchases > 0 && c.purchaseValue <= 0) {
    causes.push({
      id: "purchase-value-missing", title: t("libcase.c.cm.pv.title", { n: c.purchases }),
      detail: t("libcase.c.cm.pv.detail"),
      money: null, share: null, shareOf: null, evidence: [{ label: t("libcase.c.cm.pv.ev1"), value: String(c.purchases) }, { label: t("libcase.c.cm.pv.ev2"), value: vnd(0) }],
    })
  } else if (c.purchases > 0) notCauses.push({ id: "purchase-value-missing", text: t("libcase.c.cm.pv.ok", { v: vnd(c.purchaseValue) }) })

  // 5. Vị trí hiển thị đắt.
  const pl = judgePlacements(ev, t)
  if (!ev.placements.length) context.push(t("libcase.c.cm.pl.none"))
  else if (!pl.metric) context.push(t("libcase.c.cm.pl.few", { min: MIN_RESULTS_TO_COMPARE }))
  else {
    const bad = pl.rows.filter((r) => r.flagged)
    context.push(t("libcase.c.cm.pl.by", { m: pl.metric.label, min: MIN_RESULTS_TO_COMPARE }))
    if (bad.length) {
      const money = bad.reduce((s, r) => s + r.excess, 0)
      causes.push({
        id: "placement-waste", title: t("libcase.c.cm.pl.title", { labels: bad.map((r) => r.label).join(", "), m: pl.metric.label }),
        detail: t("libcase.c.cm.pl.detail", { m: pl.metric.label, where: bad.length > 1 ? t("libcase.c.cm.pl.these") : t("libcase.c.cm.pl.this"), ratio: PLACEMENT_COST_RATIO }),
        money, share: share(money), shareOf: "campaign_cost",
        evidence: bad.map((r) => ({
          label: r.label, cost: r.cost,
          value: t("libcase.c.cm.pl.val", { n: r.results, m: pl.metric!.label, share: pct(r.share), cpr: r.costPerResult ? ` · ${t("libcase.c.cm.pl.perResult", { v: vnd(r.costPerResult) })}` : "", rest: vnd(r.restCostPerResult ?? 0) }),
        })),
      })
    } else notCauses.push({ id: "placement-waste", text: t("libcase.c.cm.pl.ok", { min: pct(PLACEMENT_MIN_SHARE), ratio: PLACEMENT_COST_RATIO }) })
    const reels = pl.rows.filter((r) => isReels(r.key)).reduce((s, r) => s + r.cost, 0)
    if (reels > 0) context.push(t("libcase.c.cm.pl.reels", { p: pct(reels / Math.max(1, c.cost)), v: vnd(reels) }))
  }

  // 6. Tần suất cao.
  if (c.frequency !== null && c.frequency >= HIGH_FREQUENCY) {
    causes.push({
      id: "high-frequency", title: t("libcase.c.cm.freq.title", { f: dec(c.frequency, 1) }),
      detail: t("libcase.c.cm.freq.detail"),
      money: null, share: null, shareOf: null, evidence: [{ label: t("libcase.c.cm.freq.ev1"), value: dec(c.frequency, 2) }, { label: t("libcase.c.cm.freq.ev2"), value: c.reach.toLocaleString(NL) }],
    })
  } else if (c.frequency !== null) notCauses.push({ id: "high-frequency", text: t("libcase.c.cm.freq.ok", { f: dec(c.frequency, 1), max: HIGH_FREQUENCY }) })

  // 6b. Đợt 12 — "Mua hàng" chủ yếu là CHỈ XEM (1 ngày, không bấm). Đo 29/09: MBC .XYZ 204 "đơn" = 2 bấm + 202 chỉ xem, GA4
  //     utm xyz chỉ 2 đơn; toàn tài khoản ~90% là chỉ xem. Meta học theo tín hiệu này → tiêu tiền cho người đằng nào cũng mua.
  if (leads) { /* lượt mua chỉ-xem chỉ có nghĩa với chiến dịch bán hàng */ } else if (c.purchasesView != null && c.purchasesClick != null && c.purchases >= VIEW_HEAVY_MIN_PURCHASES && c.purchasesView / Math.max(c.purchases, 1) >= VIEW_HEAVY_SHARE) {
    const clickCpa = c.purchasesClick > 0 ? c.cost / c.purchasesClick : null
    causes.push({
      id: "view-through-heavy", title: t("libcase.c.cm.vt.title", { p: Math.round((c.purchasesView / c.purchases) * 100) }),
      detail: t("libcase.c.cm.vt.detail", { n: dec(c.purchasesClick, 0), cpa: clickCpa ? vnd(clickCpa) : t("libcase.c.cm.vt.noOrder"), all: vnd(c.purchases > 0 ? c.cost / c.purchases : 0) }),
      money: null, share: null, shareOf: null,
      evidence: [{ label: t("libcase.c.cm.vt.ev1"), value: dec(c.purchasesClick, 0) }, { label: t("libcase.c.cm.vt.ev2"), value: dec(c.purchasesView, 0) }, { label: t("libcase.c.cm.vt.ev3"), value: dec(c.purchases, 0) }],
    })
  } else if (c.purchasesView != null) notCauses.push({ id: "view-through-heavy", text: t("libcase.c.cm.vt.ok", { v: dec(c.purchasesView ?? 0, 0), all: dec(c.purchases, 0) }) })

  // 7. Meta lệch Odoo (chấm theo Meta, gắn cờ — user chốt 27/09).
  if (leads) { /* không có đơn để đối chiếu Odoo */ } else if (!ev.odoo.checked) context.push(t("libcase.c.cm.odoo.no", { note: ev.odoo.note }))
  else if (c.purchases >= ODOO_MIN_META_PURCHASES && ev.odoo.orders < c.purchases * ODOO_GAP_RATIO) {
    causes.push({
      id: "meta-vs-odoo", title: t("libcase.c.cm.odoo.title", { m: c.purchases, o: ev.odoo.orders }),
      detail: t("libcase.c.cm.odoo.detail"),
      money: null, share: null, shareOf: null,
      evidence: [{ label: "Meta", value: t("libcase.c.cm.odoo.ev1", { n: c.purchases, v: vnd(c.purchaseValue) }) }, { label: "Odoo", value: t("libcase.c.cm.odoo.ev2", { n: ev.odoo.orders, v: vnd(ev.odoo.revenue) }) }],
    })
  } else notCauses.push({ id: "meta-vs-odoo", text: t("libcase.c.cm.odoo.ok", { o: ev.odoo.orders, m: c.purchases }) })

  causes.sort((a, b) => (b.money ?? -1) - (a.money ?? -1))
  return { causes, notCauses, visibleTermShare: 1, context }
}
