// ============================================================
// Nguyên nhân "tốn tiền mà không ra đơn" — chiến dịch Google Search
// ============================================================
// Hàm thuần: bằng chứng vào → nguyên nhân xếp theo tiền + danh sách "đã kiểm,
// không phải nguyên nhân". Luật rút từ ca thật Search HĐĐT 20/7 (MBI, 25/09).
// Không có luật nào được kết luận trên phần dữ liệu KHÔNG thấy: Google ẩn
// một phần lượt tìm, tỉ lệ thấy được luôn đi kèm (`visibleTermShare`).

import { bucketByIntent, intentOf, type IntentLexicon } from "./intent"
import { stripDiacritics, tokens } from "./text"
import { blocks } from "./simulate-negatives"
import type { Cause, CheckedOk, Diagnosis, SearchEvidence } from "./types"
import { ZERO_RESULT_SPEND_MULT } from "./verdict"
import { makeT, type TFunction } from "@/lib/i18n/translate"

const SMART_BIDDING = new Set(["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"])
/** Từ khoá "rộng" bị nêu tên khi ăn ≥ 5% chi phí chiến dịch với điểm chất lượng ≤ 4. */
const LOWQS_MAX = 4
const LOWQS_MIN_SHARE = 0.05
/** Một nhóm ý định chỉ thành nguyên nhân khi ≥ 2% phần chi phí thấy được. */
const BUCKET_MIN_SHARE = 0.02

export interface DiagnoseOptions {
  lexicon: IntentLexicon
  /** Trần chi phí/đơn (VND) nếu chấm theo CPA — để biết đã chi "đủ để kết luận" chưa. */
  ceilingCpa: number | null
  /** Đợt 23 (3d): chiến dịch thu lead — bỏ các kiểm "Mua hàng" (đặt giá theo lead là ĐÚNG mục tiêu). Mặc định sales. */
  goalKind?: "sales" | "leads"
}

const NETWORK_KEYS = new Set(["SEARCH", "SEARCH_PARTNERS", "CONTENT", "YOUTUBE", "GMAIL", "DISCOVER", "MAPS", "MIXED", "GOOGLE_TV"])

/** Chiến dịch thương hiệu — suy từ tên ("Brand", "Thương hiệu"). */
export function isBrandCampaign(name: string): boolean {
  return /\bbrand\b|thuong hieu/.test(stripDiacritics(name ?? ""))
}

export function diagnoseSearch(ev: SearchEvidence, opts: DiagnoseOptions, t: TFunction = makeT("vi")): Diagnosis {
  const NL = t("libcase.c.numLocale")
  const vnd = (n: number) => `₫${Math.round(n).toLocaleString(NL)}`
  const pct1 = (x: number) => (x * 100).toLocaleString(NL, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const netName = (n: string) => (NETWORK_KEYS.has(n) ? t(`libcase.c.cs.net.${n}` as never) : n)
  const c = ev.campaign
  const causes: Cause[] = []
  const notCauses: CheckedOk[] = []
  const context: string[] = []

  const visible = ev.searchTerms.reduce((s, t) => s + t.cost, 0)
  // Pmax: lượt tìm chỉ phủ kênh Tìm kiếm — so với chi phí kênh đó, không với tổng chi Pmax.
  const searchSlice = ev.kind === "google_pmax" ? ev.network?.find((n) => n.network === "SEARCH") : undefined
  const termBase = searchSlice ? searchSlice.cost : c.cost
  const visibleTermShare = termBase > 0 ? Math.min(1, visible / termBase) : 0
  const buckets = bucketByIntent(ev.searchTerms, opts.lexicon)
  const bucket = (k: string) => buckets.find((b) => b.intent === k)

  // ── Đo lường ────────────────────────────────────────────────
  if (opts.goalKind === "leads") {
    notCauses.push({ id: "measurement-ok", text: t("libcase.c.cs.leadOk", { cats: ev.biddableCategories.join(", ") }) })
  } else if (!ev.biddableCategories.includes("PURCHASE")) {
    causes.push({
      id: "goal-not-purchase",
      title: t("libcase.c.cs.goalNotPurchase.title"),
      detail: t("libcase.c.cs.goalNotPurchase.detail", { cats: ev.biddableCategories.join(", ") || t("libcase.c.cs.unknown") }),
      money: c.cost, share: 1, shareOf: "campaign_cost", evidence: [],
    })
  } else if (ev.purchasesElsewhere > 0) {
    notCauses.push({ id: "measurement-ok", text: t("libcase.c.cs.measOk", { n: ev.purchasesElsewhere.toLocaleString(NL) }) })
  } else {
    causes.push({
      id: "measurement-unverified",
      title: t("libcase.c.cs.measUnv.title"),
      detail: t("libcase.c.cs.measUnv.detail"),
      money: null, share: null, shareOf: null, evidence: [],
    })
  }

  // ── Pmax: phần kênh Tìm kiếm tốn tiền mà không ra đơn ─────────
  if (ev.kind === "google_pmax" && searchSlice && searchSlice.conversions === 0
      && (opts.ceilingCpa === null || searchSlice.cost >= opts.ceilingCpa * ZERO_RESULT_SPEND_MULT)) {
    causes.push({
      id: "pmax-search-no-orders",
      title: t("libcase.c.cs.pmaxSearch.title"),
      detail: t("libcase.c.cs.pmaxSearch.detail", { clicks: searchSlice.clicks.toLocaleString(NL) }),
      money: searchSlice.cost, share: c.cost > 0 ? searchSlice.cost / c.cost : null, shareOf: "campaign_cost",
      evidence: (ev.network ?? []).filter((n) => n.cost > 0).map((n) => ({
        label: t("libcase.c.cs.pmaxSearch.ev", { net: netName(n.network), n: n.conversions.toLocaleString(NL, { maximumFractionDigits: 1 }) }), cost: n.cost, clicks: n.clicks,
      })),
    })
  }

  // ── Từ khoá rộng, điểm chất lượng thấp ───────────────────────
  const lowQs = ev.keywords
    .filter((k) => k.status === "ENABLED" && k.match !== "EXACT" && k.qualityScore !== null && k.qualityScore <= LOWQS_MAX)
    .filter((k) => c.cost > 0 && k.cost / c.cost >= LOWQS_MIN_SHARE)
    .sort((a, b) => b.cost - a.cost)
  if (lowQs.length) {
    const money = lowQs.reduce((s, k) => s + k.cost, 0)
    const lpBad = lowQs.some((k) => k.landingExperience === "BELOW_AVERAGE")
    const ctrBad = lowQs.some((k) => k.expectedCtr === "BELOW_AVERAGE")
    causes.push({
      id: "broad-lowqs",
      title: t("libcase.c.cs.lowqs.title", { n: lowQs.length, max: LOWQS_MAX }),
      detail: [
        lpBad && t("libcase.c.cs.lowqs.lp"),
        ctrBad && t("libcase.c.cs.lowqs.ctr"),
      ].filter(Boolean).join(" · ") || t("libcase.c.cs.lowqs.low"),
      money, share: money / c.cost, shareOf: "campaign_cost",
      evidence: lowQs.map((k) => ({ label: t("libcase.c.cs.lowqs.ev", { text: k.text, match: k.match, qs: k.qualityScore ?? "" }), cost: k.cost, clicks: k.clicks })),
    })
  }

  // ── Tiền rơi theo ý định lượt tìm ────────────────────────────
  const intentCause = (id: string, keys: string[], title: string, detail: string) => {
    const bs = keys.map(bucket).filter(Boolean) as NonNullable<ReturnType<typeof bucket>>[]
    const money = bs.reduce((s, b) => s + b.cost, 0)
    if (visible <= 0 || money / visible < BUCKET_MIN_SHARE) return
    const clicks = bs.reduce((s, b) => s + b.clicks, 0)
    const terms = bs.reduce((s, b) => s + b.terms, 0)
    const conv = bs.reduce((s, b) => s + b.conversions, 0)
    causes.push({
      id, title,
      detail: t("libcase.c.cs.intent.detail", { terms: terms.toLocaleString(NL), clicks: clicks.toLocaleString(NL), conv: conv.toLocaleString(NL), detail }),
      money, share: money / visible, shareOf: "visible_terms",
      evidence: bs.flatMap((b) => b.examples).sort((a, z) => z.cost - a.cost).slice(0, 8)
        .map((e) => ({ label: e.term, cost: e.cost, clicks: e.clicks })),
    })
  }
  intentCause("competitor-spend", ["competitor"], t("libcase.c.cs.competitor.title"), t("libcase.c.cs.competitor.detail"))
  intentCause("info-howto", ["info"], t("libcase.c.cs.info.title"), t("libcase.c.cs.info.detail"))
  // 19/10: chiến dịch THƯƠNG HIỆU sinh ra để nhận lượt tìm thương hiệu — đó không phải nguyên nhân tốn tiền.
  if (!isBrandCampaign(c.name)) intentCause("existing-customer", ["own_brand"], t("libcase.c.cs.existing.title"), t("libcase.c.cs.existing.detail"))
  const sibling = opts.lexicon.catalog?.sibling.site
  intentCause("other-product", ["own_other"], sibling ? t("libcase.c.cs.other.titleSib", { site: sibling }) : t("libcase.c.cs.other.title"), t("libcase.c.cs.other.detail"))
  intentCause("lookup", ["lookup"], t("libcase.c.cs.lookup.title"), t("libcase.c.cs.lookup.detail"))

  // ── Giá thầu tự động không có đơn để học ─────────────────────
  const judged = opts.ceilingCpa === null || c.cost >= opts.ceilingCpa * ZERO_RESULT_SPEND_MULT
  if (SMART_BIDDING.has(c.biddingType) && c.orders === 0 && judged) {
    const single = ev.searchTerms.filter((t) => t.clicks === 1).sort((a, b) => b.cost - a.cost).slice(0, 4)
    const target = c.targetCpa ? t("libcase.c.cs.blind.cpa", { v: vnd(c.targetCpa) }) : c.targetRoas ? t("libcase.c.cs.blind.roas", { v: c.targetRoas }) : ""
    causes.push({
      id: "blind-bidding",
      title: t("libcase.c.cs.blind.title"),
      detail: t("libcase.c.cs.blind.detail", { type: c.biddingType, target }),
      money: null, share: null, shareOf: null,
      evidence: single.map((x) => ({ label: t("libcase.c.cs.blind.ev", { term: x.term }), cost: x.cost })),
    })
  }

  // ── Phủ định mỏng / bỏ sót dạng không dấu / từ khoá đối thủ còn bật ──
  const negKws = ev.negatives.map((n) => ({ text: n.text, match: (n.match === "EXACT" || n.match === "BROAD" ? n.match : "PHRASE") as "PHRASE" | "EXACT" | "BROAD" }))
  const compNegs = ev.negatives.filter((n) => intentOf(n.text, opts.lexicon) === "competitor").length
  const accentGaps = negKws.filter((n) => stripDiacritics(n.text) !== tokens(n.text).join(" "))
    .filter((n) => !negKws.some((m) => tokens(m.text).join(" ") === stripDiacritics(n.text)))
    .filter((n) => ev.searchTerms.some((t) => blocks(t.term, { text: stripDiacritics(n.text), match: n.match }) && !blocks(t.term, n)))
    .map((n) => n.text)
  const compKws = ev.keywords.filter((k) => k.status === "ENABLED" && intentOf(k.text, opts.lexicon) === "competitor")
  const compKwImpr = compKws.reduce((s, k) => s + k.impressions, 0)
  const compKwCost = compKws.reduce((s, k) => s + k.cost, 0)
  const competitorMoney = bucket("competitor")?.cost ?? 0
  if ((compNegs === 0 && competitorMoney > 0) || accentGaps.length > 0 || compKws.length > 0) {
    const parts = [t("libcase.c.cs.neg.head", { n: ev.negatives.length, c: compNegs })]
    if (accentGaps.length) parts.push(t("libcase.c.cs.neg.accent", { list: accentGaps.map((a) => `“${a}”`).join(", ") }))
    if (compKws.length) parts.push(t("libcase.c.cs.neg.kws", { n: compKws.length, impr: compKwImpr.toLocaleString(NL), cost: vnd(compKwCost) }))
    causes.push({
      id: "thin-negatives", title: t("libcase.c.cs.neg.title"),
      detail: parts.join(" "), money: null, share: null, shareOf: null,
      evidence: compKws.slice(0, 8).map((k) => ({ label: t("libcase.c.cs.neg.ev", { text: k.text, match: k.match }), cost: k.cost })),
    })
  }

  // ── Trang đích, quảng cáo ────────────────────────────────────
  const mainLp = [...ev.landingPages].sort((a, b) => b.clicks - a.clicks)[0]
  if (mainLp) {
    const acc = ev.landingConversionsAccount.find((l) => l.url === mainLp.url)
    if (acc && acc.conversions > 0) {
      notCauses.push({ id: "landing-alive", text: t("libcase.c.cs.lpAlive", { url: mainLp.url, n: acc.conversions.toLocaleString(NL, { maximumFractionDigits: 1 }) }) })
    }
  }
  if (ev.ads.length && ev.ads.every((a) => a.approval === "APPROVED")) {
    notCauses.push({ id: "ads-approved", text: t("libcase.c.cs.adsOk", { n: ev.ads.length }) })
  } else if (ev.ads.some((a) => a.approval === "DISAPPROVED")) {
    causes.push({ id: "ads-disapproved", title: t("libcase.c.cs.adsBad.title"), detail: t("libcase.c.cs.adsBad.detail"), money: null, share: null, shareOf: null, evidence: [] })
  }

  if (c.lostIsBudget !== null && c.lostIsBudget > 0.3) {
    context.push(t("libcase.c.cs.ctx.budget", { p: pct1(c.lostIsBudget) }))
  }
  if (ev.kind === "google_pmax" && ev.network?.length) {
    const top = ev.network.filter((n) => n.cost > 0).slice(0, 4)
      .map((n) => t("libcase.c.cs.ctx.netItem", { net: netName(n.network), cost: vnd(n.cost), n: n.conversions.toLocaleString(NL, { maximumFractionDigits: 1 }) }))
    context.push(t("libcase.c.cs.ctx.network", { list: top.join(" · ") }))
  }
  if (visibleTermShare < 0.95) {
    context.push(t("libcase.c.cs.ctx.hidden", { p: pct1(1 - visibleTermShare), slice: searchSlice ? t("libcase.c.cs.ctx.hiddenSlice") : "" }))
  }

  const withMoney = causes.filter((x) => x.money !== null).sort((a, b) => b.money! - a.money!)
  const noMoney = causes.filter((x) => x.money === null)
  return { causes: [...withMoney, ...noMoney], notCauses, visibleTermShare, context }
}
