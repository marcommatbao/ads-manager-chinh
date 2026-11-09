// ============================================================
// Đợt 11+ — ĐÁNH GIÁ & LỘ TRÌNH tách lượt tìm chung khỏi chiến dịch thương hiệu (user 29/09: "đưa hướng giải quyết … cho ổn định")
// ============================================================
// Không chỉ có nút làm: nói rõ HIỆN TRẠNG (số), CẤU TRÚC ĐÍCH, CHIA NGÂN SÁCH (2 phương án: giữ tổng / tăng tổng), ĐẶT GIÁ cho
// chiến dịch Chung, LỘ TRÌNH theo ngày (không đụng gì 14 ngày học), TIÊU CHÍ THÀNH CÔNG / DỪNG, HOÀN TÁC. Hàm thuần — số từ
// X-quang Search + kế hoạch tách. Ước tính nhu cầu thương hiệu là THÔ (từ tỉ lệ mất hiển thị cấp chiến dịch) — ghi rõ.
import { BRAND_INTENTS, type SearchCampaign } from "./xray"
import type { SplitPlan } from "./split"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, vndT } from "@/lib/google-i18n"

export interface SplitAssessment {
  now: string[]
  structure: { name: string; role: string; keywords: string; budgetPerDay: number; bidding: string }[]
  budgetOptions: { id: "keep_total" | "grow"; label: string; brandBudget: number; genericBudget: number; total: number; note: string }[]
  recommendedOption: "keep_total" | "grow"
  bidding: string[]
  timeline: { when: string; what: string }[]
  success: string[]
  abort: string[]
  caveats: string[]
}
const round10k = (n: number) => Math.max(50_000, Math.round(n / 10_000) * 10_000)

export function assessSplit(input: { plan: SplitPlan; campaign: SearchCampaign; days: number; targetCpa?: number | null }, t: TFunction = viT): SplitAssessment {
  const vnd = (n: number) => vndT(t, n)
  const { plan, campaign: c } = input
  const days = Math.max(1, input.days)
  const brand = c.intents.filter((i) => BRAND_INTENTS.includes(i.intent)), other = c.intents.filter((i) => !BRAND_INTENTS.includes(i.intent))
  const s = (xs: typeof brand, f: "cost" | "purchases") => xs.reduce((a, x) => a + x[f], 0)
  const bCost = s(brand, "cost"), bP = s(brand, "purchases"), oCost = s(other, "cost"), oP = s(other, "purchases")
  const bCpa = bP ? bCost / bP : null, oCpa = oP ? oCost / oP : null
  const bDay = bCost / days
  const lostB = c.lostBudget ?? 0, is = c.impressionShare ?? null
  // Ước tính THÔ nhu cầu thương hiệu nếu hết mất vì ngân sách: chi thương hiệu × (IS + mất-vì-ngân-sách) / IS.
  const brandNeed = is && is > 0 ? Math.min(bDay * ((is + lostB) / is), c.budget * 2) : bDay * 1.5
  const genericBudget = plan.budgetPerDay
  const keepBrand = Math.max(round10k(bDay * 1.2), round10k(c.budget - genericBudget))
  const options: SplitAssessment["budgetOptions"] = [
    { id: "keep_total", label: t("libgoogle.sa.optKeepLabel"), brandBudget: round10k(c.budget - genericBudget) > round10k(bDay * 1.2) ? round10k(c.budget - genericBudget) : keepBrand, genericBudget, total: 0, note: "" },
    { id: "grow", label: t("libgoogle.sa.optGrowLabel"), brandBudget: round10k(c.budget), genericBudget, total: 0, note: "" },
  ]
  for (const o of options) { o.total = o.brandBudget + o.genericBudget; o.note = o.brandBudget >= brandNeed ? t("libgoogle.sa.noteEnough", { need: vnd(brandNeed) }) : t("libgoogle.sa.noteLow", { need: vnd(brandNeed), cur: vnd(bDay) }) }
  options[0].note += t("libgoogle.sa.noteKeepTotal", { total: vnd(options[0].total), cur: vnd(c.budget) })
  options[1].note += t("libgoogle.sa.noteGrowTotal", { total: vnd(options[1].total), cpa: bCpa ? vnd(bCpa) : "—" })
  const recommended = bCpa && oCpa && oCpa >= 2 * bCpa ? "grow" : "keep_total"
  const target = input.targetCpa ?? null
  return {
    now: [
      t("libgoogle.sa.now1", { name: c.name, cost: vnd(c.cost), days, bCost: vnd(bCost), bP: Math.round(bP), bCpa: bCpa ? vnd(bCpa) : "—", oCost: vnd(oCost), oP: Math.round(oP), oCpa: oCpa ? vnd(oCpa) : "—" }),
      t("libgoogle.sa.now2", { budget: vnd(c.budget), lost: Math.round(lostB * 100), ratio: bCpa && oCpa ? t("libgoogle.sa.now2Ratio", { x: (oCpa / bCpa).toFixed(1) }) : "" }),
      t("libgoogle.sa.now3", { oP: Math.round(oP) }),
    ],
    structure: [
      { name: c.name, role: t("libgoogle.sa.roleBrand"), keywords: t("libgoogle.sa.kwBrand", { n: plan.brandKeywords }), budgetPerDay: options.find((o) => o.id === recommended)!.brandBudget, bidding: t("libgoogle.sa.biddingKeep") },
      { name: plan.newName, role: t("libgoogle.sa.roleGeneric"), keywords: t("libgoogle.sa.kwGeneric", { n: plan.adGroups.reduce((a, g) => a + g.keywords.length, 0), m: plan.brandNegatives.length }), budgetPerDay: genericBudget, bidding: t("libgoogle.sa.biddingGeneric", { bidding: plan.bidding }) },
    ],
    budgetOptions: options,
    recommendedOption: recommended,
    bidding: [
      t("libgoogle.sa.bid1"),
      t("libgoogle.sa.bid2", { cur: oCpa ? t("libgoogle.sa.bid2Cur", { cpa: vnd(oCpa) }) : "", target: target ? t("libgoogle.sa.bid2Target", { target: vnd(target) }) : t("libgoogle.sa.bid2NoTarget") }),
      t("libgoogle.sa.bid3"),
    ],
    timeline: [
      { when: t("libgoogle.sa.tl0a.when"), what: t("libgoogle.sa.tl0a.what") },
      { when: t("libgoogle.sa.tl0b.when"), what: t("libgoogle.sa.tl0b.what") },
      { when: t("libgoogle.sa.tl0a.when"), what: t("libgoogle.sa.tl0c.what", { budget: vnd(options.find((o) => o.id === recommended)!.brandBudget) }) },
      { when: t("libgoogle.sa.tl1.when"), what: t("libgoogle.sa.tl1.what") },
      { when: t("libgoogle.sa.tl7.when"), what: t("libgoogle.sa.tl7.what") },
      { when: t("libgoogle.sa.tl14.when"), what: t("libgoogle.sa.tl14.what") },
    ],
    success: [
      t("libgoogle.sa.succ1", { lost: Math.round(lostB * 100) }),
      t("libgoogle.sa.succ2", { cpa: oCpa ? t("libgoogle.sa.succ2Cpa", { cpa: vnd(oCpa) }) : "" }),
      t("libgoogle.sa.succ3"),
    ],
    abort: [
      t("libgoogle.sa.abort1"),
      t("libgoogle.sa.abort2"),
    ],
    caveats: [
      t("libgoogle.sa.cav1"),
      t("libgoogle.sa.cav2"),
      ...plan.notes,
    ],
  }
}

/** Đo lại theo mốc — HÀM THUẦN: so N ngày trước lúc chuyển với N ngày sau, gộp 2 chiến dịch. */
/** Đợt 19d (18j): đơn THẬT (nguồn đơn → hành động phụ "Lead chốt đơn") của gốc + bản tách. Đủ số thì kết luận theo đơn thật. */
export const REAL_MIN_FOR_VERDICT = 10
export function checkpoint(before: { brand: SearchCampaign | null; generic: SearchCampaign | null }, after: { brand: SearchCampaign | null; generic: SearchCampaign | null }, days: number, real: { before: number; after: number } | null = null, t: TFunction = viT): { lines: string[]; verdict: "tot" | "theo_doi" | "dung"; basis?: "google" | "real" } {
  const p = (x: { brand: SearchCampaign | null; generic: SearchCampaign | null }) => (x.brand?.purchases ?? 0) + (x.generic?.purchases ?? 0)
  const cost = (x: { brand: SearchCampaign | null; generic: SearchCampaign | null }) => (x.brand?.cost ?? 0) + (x.generic?.cost ?? 0)
  const pb = p(before), pa = p(after), change = pb > 0 ? pa / pb - 1 : null
  const lost = after.brand?.lostBudget ?? null
  const vnd = (n: number) => vndT(t, n)
  const lines = [
    t("libgoogle.sa.cp1", { days, pb: Math.round(pb), pa: Math.round(pa), chg: change != null ? ` (${change >= 0 ? "+" : ""}${Math.round(change * 100)}%)` : "", c1: vnd(cost(before)), c2: vnd(cost(after)) }),
    t("libgoogle.sa.cp2", { l1: before.brand?.lostBudget != null ? Math.round(before.brand.lostBudget * 100) + "%" : "—", l2: lost != null ? Math.round(lost * 100) + "%" : "—", a1: before.brand?.cpa ? vnd(before.brand.cpa) : "—", a2: after.brand?.cpa ? vnd(after.brand.cpa) : "—" }),
    t("libgoogle.sa.cp3", { cost: vnd(after.generic?.cost ?? 0), n: Math.round(after.generic?.purchases ?? 0), cpa: after.generic?.cpa ? vnd(after.generic.cpa) : "—" }),
  ]
  const useReal = !!real && real.before + real.after >= REAL_MIN_FOR_VERDICT && real.before > 0
  const rc = useReal ? real!.after / real!.before - 1 : null
  if (real) lines.push(t("libgoogle.sa.cpReal", { b: Math.round(real.before), a: Math.round(real.after), chg: rc != null ? ` (${rc >= 0 ? "+" : ""}${Math.round(rc * 100)}%)` : "", tail: useReal ? t("libgoogle.sa.cpRealYes") : t("libgoogle.sa.cpRealNo", { min: REAL_MIN_FOR_VERDICT }) }))
  const ch = useReal ? rc : change
  const verdict = ch != null && ch < -0.2 ? "dung" : ch != null && ch >= 0 && (lost == null || lost < 0.15) ? "tot" : "theo_doi"
  const what = useReal ? t("libgoogle.sa.whatReal") : t("libgoogle.sa.whatTotal")
  lines.push(verdict === "dung" ? t("libgoogle.sa.vDung", { what }) : verdict === "tot" ? t("libgoogle.sa.vTot", { what: what.toLowerCase() }) : t("libgoogle.sa.vTheoDoi"))
  return { lines, verdict, basis: useReal ? "real" : "google" }
}
