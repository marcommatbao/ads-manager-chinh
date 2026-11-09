// ============================================================
// Đợt 11a — X-quang Search: tiền theo Ý ĐỊNH trong từng chiến dịch · mất hiển thị · từ khoá · thiết bị (CHỈ ĐỌC)
// ============================================================
// Đo 29/09 (30 ngày): 2 chiến dịch MBC tên "Brand" chi ₫182tr — chỉ ~₫46tr vào lượt tìm thương hiệu (838 đơn, CPA ~₫54k),
// ~₫95tr vào lượt tìm chung/mua (~286 đơn, CPA ~₫330k), trong khi mất 56% / 85% hiển thị vì NGÂN SÁCH. Tổng theo chiến dịch
// không thấy được điều này → tách theo ý định (cùng bộ từ với X-quang PMax: lib/case/intent).
// "Đơn" = chuyển đổi nhóm MUA HÀNG (segments.conversion_action_category) — MBI đang đặt giá theo Thêm giỏ nên "conversions"
// thô sẽ đếm sai (bài học Đợt 7). Google không cho lấy chi phí cùng segment đó → 2 truy vấn rồi ghép.

import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleAdsErrorMessage } from "@/lib/google-ads-error"
import { intentOf, type Intent, type IntentLexicon } from "@/lib/case/intent"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, vndT, nfOf, tk } from "@/lib/google-i18n"
import { lexiconFor } from "@/lib/case/targets"
import type { Company } from "@/lib/case/types"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k]))
const BID = inv(enums.BiddingStrategyType as unknown as Record<string, unknown>)
const MATCH = inv(enums.KeywordMatchType as unknown as Record<string, unknown>)
const DEVICE = inv(enums.Device as unknown as Record<string, unknown>)
const STATUS = inv(enums.CampaignStatus as unknown as Record<string, unknown>)
const nm = (m: Record<number, string>, v: unknown) => (typeof v === "number" ? m[v] ?? String(v) : String(v ?? ""))

export const BRAND_INTENTS: Intent[] = ["own_brand", "own_other", "lookup"]
export const STARVED_LOST_BUDGET = 0.2
export const STARVED_CPA_X = 2

export interface IntentCell { intent: Intent; label: string; cost: number; clicks: number; conversions: number; purchases: number; terms: number; cpa: number | null }
export interface SearchCampaign {
  id: string; name: string; status: string; bidding: string; budget: number
  cost: number; conversions: number; purchases: number; cpa: number | null
  impressionShare: number | null; lostBudget: number | null; lostRank: number | null
  intents: IntentCell[]
  brandShareOfCost: number
  warnings: SearchWarning[]
}
export interface SearchWarning { level: "bad" | "warn"; id: string; campaignId?: string; text: string; money?: number }
export interface KeywordRow { campaignId: string; adGroupId: string; criterion: string; text: string; match: string; qs: number | null; cost: number; clicks: number; conversions: number; purchases: number }
export interface TermRow { campaignId: string; adGroupId: string; term: string; cost: number; clicks: number; conversions: number; purchases: number }
export interface SearchXray {
  company: Company; range: { from: string; to: string }; collectedAt: string
  campaigns: SearchCampaign[]
  account: { cost: number; purchases: number; cpa: number | null; intents: IntentCell[] }
  matchTypes: { match: string; cost: number; purchases: number }[]
  qs: { qs: string; cost: number; purchases: number; keywords: number }[]
  devices: { device: string; cost: number; purchases: number }[]
  keywords: KeywordRow[]
  terms: TermRow[]
  warnings: SearchWarning[]
  notes: string[]
  errors: string[]
}

const cpaOf = (cost: number, n: number) => (n > 0 ? cost / n : null)

/** Gom lượt tìm theo ý định — HÀM THUẦN. */
export function intentCells(terms: TermRow[], lex: IntentLexicon, t: TFunction = viT): IntentCell[] {
  const m = new Map<Intent, IntentCell>()
  for (const r of terms) {
    const it = intentOf(r.term, lex)
    const c = m.get(it) ?? { intent: it, label: tk(t, `libgoogle.intent.${it}`), cost: 0, clicks: 0, conversions: 0, purchases: 0, terms: 0, cpa: null }
    c.cost += r.cost; c.clicks += r.clicks; c.conversions += r.conversions; c.purchases += r.purchases; c.terms++
    m.set(it, c)
  }
  return [...m.values()].map((c) => ({ ...c, cpa: cpaOf(c.cost, c.purchases) })).sort((a, b) => b.cost - a.cost)
}

/** Cảnh báo cấp chiến dịch — HÀM THUẦN. */
export function campaignWarnings(c: Omit<SearchCampaign, "warnings" | "brandShareOfCost">, t: TFunction = viT): { brandShareOfCost: number; warnings: SearchWarning[] } {
  const w: SearchWarning[] = []
  const vnd = (n: number) => vndT(t, n)
  const brand = c.intents.filter((i) => BRAND_INTENTS.includes(i.intent))
  const other = c.intents.filter((i) => !BRAND_INTENTS.includes(i.intent))
  const sum = (xs: IntentCell[], f: "cost" | "purchases") => xs.reduce((s, x) => s + x[f], 0)
  const termCost = sum(c.intents, "cost")
  const bCost = sum(brand, "cost"), oCost = sum(other, "cost")
  const bCpa = cpaOf(bCost, sum(brand, "purchases")), oCpa = cpaOf(oCost, sum(other, "purchases"))
  const brandShareOfCost = termCost > 0 ? bCost / termCost : 0
  // Thương hiệu bị ăn ngân sách: có lượt tìm thương hiệu rẻ, mất hiển thị vì ngân sách, và lượt tìm chung đắt hơn nhiều.
  // Chỉ khi phần thương hiệu ĐÁNG KỂ (≥ 20% tiền, ≥ 10 đơn) — đo 29/09: Vibe Hosting có ₫354k thương hiệu cũng bị báo, quá tay.
  if (bCost > 0 && brandShareOfCost >= 0.2 && sum(brand, "purchases") >= 10 && (c.lostBudget ?? 0) >= STARVED_LOST_BUDGET && oCost > bCost * 0.5 && bCpa != null && (oCpa == null || oCpa >= STARVED_CPA_X * bCpa)) {
    w.push({ level: "bad", id: "brand_starved", campaignId: c.id, money: oCost,
      text: t("libgoogle.sx.brandStarved", { name: c.name, lost: Math.round((c.lostBudget ?? 0) * 100), other: Math.round((1 - brandShareOfCost) * 100), money: vnd(oCost), cpa: oCpa ? vnd(oCpa) : t("libgoogle.sx.noOrders"), ratio: oCpa ? (oCpa / bCpa).toFixed(1) : "∞", bcpa: vnd(bCpa) }) })
  }
  const comp = c.intents.find((i) => i.intent === "competitor")
  if (comp && termCost > 0 && comp.cost / termCost >= 0.2 && comp.purchases === 0) w.push({ level: "bad", id: "competitor_spend", campaignId: c.id, money: comp.cost, text: t("libgoogle.sx.competitorSpend", { name: c.name, pct: Math.round((comp.cost / termCost) * 100), money: vnd(comp.cost) }) })
  if ((c.lostRank ?? 0) >= 0.5 && c.cost > 0) w.push({ level: "warn", id: "lost_rank", campaignId: c.id, text: t("libgoogle.sx.lostRank", { name: c.name, pct: Math.round((c.lostRank ?? 0) * 100) }) })
  return { brandShareOfCost, warnings: w }
}

/**
 * Một lượt tìm × nhóm quảng cáo có thể về NHIỀU dòng (user 01/10: [mua tên miền] hiện 3 lần, cùng số). Số đơn (pTerm) đã gộp theo khoá
 * nên gán cho từng dòng là đếm trùng. Gộp về một dòng/khoá: dòng giống hệt (cùng chi/click/chuyển đổi) bỏ, dòng khác cộng dồn — HÀM THUẦN.
 */
export function mergeTermRows(rows: TermRow[]): TermRow[] {
  const m = new Map<string, { row: TermRow; seen: Set<string> }>()
  for (const r of rows) {
    const k = `${r.campaignId}|${r.adGroupId}|${r.term}`, sig = `${r.cost}|${r.clicks}|${r.conversions}`
    const g = m.get(k)
    if (!g) { m.set(k, { row: { ...r }, seen: new Set([sig]) }); continue }
    if (g.seen.has(sig)) continue
    g.seen.add(sig); g.row.cost += r.cost; g.row.clicks += r.clicks; g.row.conversions += r.conversions
  }
  return [...m.values()].map((g) => g.row)
}

// Bộ nhớ đệm giữ bản TIẾNG VIỆT (số liệu thô); chữ theo ngôn ngữ được dựng lại mỗi yêu cầu (renderXray) → EN không đầu độc VI.
const memo = new Map<string, { at: number; value: SearchXray }>()

/** Dựng lại phần chữ (nhãn ý định, cảnh báo, ghi chú) theo ngôn ngữ của t — không đụng số liệu. */
export function renderXray(v: SearchXray, t: TFunction): SearchXray {
  if (nfOf(t) === nfOf(viT)) return v
  const lab = (cells: IntentCell[]) => cells.map((c) => ({ ...c, label: tk(t, `libgoogle.intent.${c.intent}`) }))
  const campaigns = v.campaigns.map((c) => { const base = { ...c, intents: lab(c.intents) }; return { ...base, ...campaignWarnings(base, t) } })
  return { ...v, campaigns, account: { ...v.account, intents: lab(v.account.intents) },
    warnings: campaigns.flatMap((x) => x.warnings).sort((a, b) => (a.level === b.level ? (b.money ?? 0) - (a.money ?? 0) : a.level === "bad" ? -1 : 1)),
    notes: [t("libgoogle.sx.noteAuction")] }
}

/** `t` chỉ quyết định ngôn ngữ chữ trả về; số liệu cache chung. */
export async function searchXray(company: Company, range: { from: string; to: string }, opts: { force?: boolean } = {}, t: TFunction = viT): Promise<SearchXray> {
  return renderXray(await searchXrayVi(company, range, opts), t)
}

async function searchXrayVi(company: Company, range: { from: string; to: string }, opts: { force?: boolean } = {}): Promise<SearchXray> {
  const key = `${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < 30 * 60_000) return hit.value
  const c = getGoogleAdsCustomer(company)
  const errors: string[] = []
  const q = async (label: string, g: string): Promise<Row[]> => { try { return (await c.query(g)) as Row[] } catch (e) { errors.push(`${label}: ${googleAdsErrorMessage(e)}`); return [] } }
  const B = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const S = "campaign.advertising_channel_type = 'SEARCH'"
  const P = "segments.conversion_action_category = 'PURCHASE'"
  const [camp, campP, term, termP, kw, kwP, dev, devP] = await Promise.all([
    q("chiến dịch", `SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, campaign_budget.amount_micros, metrics.cost_micros, metrics.conversions, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share FROM campaign WHERE ${S} AND campaign.status != 'REMOVED' AND ${B}`),
    q("đơn theo chiến dịch", `SELECT campaign.id, segments.conversion_action_category, metrics.conversions FROM campaign WHERE ${S} AND ${B} AND ${P}`),
    q("lượt tìm", `SELECT campaign.id, ad_group.id, search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions FROM search_term_view WHERE ${S} AND ${B}`),
    q("đơn theo lượt tìm", `SELECT campaign.id, ad_group.id, search_term_view.search_term, segments.conversion_action_category, metrics.conversions FROM search_term_view WHERE ${S} AND ${B} AND ${P}`),
    q("từ khoá", `SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, metrics.cost_micros, metrics.clicks, metrics.conversions FROM keyword_view WHERE ${S} AND campaign.status = 'ENABLED' AND ad_group_criterion.status = 'ENABLED' AND ${B}`),
    q("đơn theo từ khoá", `SELECT ad_group_criterion.resource_name, segments.conversion_action_category, metrics.conversions FROM keyword_view WHERE ${S} AND campaign.status = 'ENABLED' AND ${B} AND ${P}`),
    q("thiết bị", `SELECT segments.device, metrics.cost_micros FROM campaign WHERE ${S} AND ${B}`),
    q("đơn theo thiết bị", `SELECT segments.device, segments.conversion_action_category, metrics.conversions FROM campaign WHERE ${S} AND ${B} AND ${P}`),
  ])
  const sumBy = (rows: Row[], k: (r: Row) => string) => { const m = new Map<string, number>(); for (const r of rows) m.set(k(r), (m.get(k(r)) ?? 0) + (Number(r.metrics.conversions) || 0)); return m }
  const pCamp = sumBy(campP, (r) => String(r.campaign.id))
  const pTerm = sumBy(termP, (r) => `${r.campaign.id}|${r.ad_group.id}|${r.search_term_view.search_term}`)
  const pKw = sumBy(kwP, (r) => String(r.ad_group_criterion.resource_name))
  const pDev = sumBy(devP, (r) => nm(DEVICE, r.segments.device))
  const lex = lexiconFor(company)
  const terms = mergeTermRows(term.map((r) => ({ campaignId: String(r.campaign.id), adGroupId: String(r.ad_group.id), term: String(r.search_term_view.search_term ?? ""),
    cost: (Number(r.metrics.cost_micros) || 0) / 1e6, clicks: Number(r.metrics.clicks) || 0, conversions: Number(r.metrics.conversions) || 0,
    purchases: pTerm.get(`${r.campaign.id}|${r.ad_group.id}|${r.search_term_view.search_term}`) ?? 0 })).filter((t) => t.term))
  // Metric chiến dịch trả theo từng dòng ngày gộp sẵn (không segment) → mỗi chiến dịch một dòng.
  const campaigns: SearchCampaign[] = camp.map((r) => {
    const id = String(r.campaign.id)
    const cost = (Number(r.metrics.cost_micros) || 0) / 1e6
    const purchases = pCamp.get(id) ?? 0
    const base = { id, name: String(r.campaign.name), status: nm(STATUS, r.campaign.status), bidding: nm(BID, r.campaign.bidding_strategy_type), budget: (Number(r.campaign_budget?.amount_micros) || 0) / 1e6,
      cost, conversions: Number(r.metrics.conversions) || 0, purchases, cpa: cpaOf(cost, purchases),
      impressionShare: r.metrics.search_impression_share ?? null, lostBudget: r.metrics.search_budget_lost_impression_share ?? null, lostRank: r.metrics.search_rank_lost_impression_share ?? null,
      intents: intentCells(terms.filter((t) => t.campaignId === id), lex) }
    return { ...base, ...campaignWarnings(base) }
  }).filter((x) => x.cost > 0 || x.status === "ENABLED").sort((a, b) => b.cost - a.cost)
  const keywords: KeywordRow[] = kw.map((r) => ({ campaignId: String(r.campaign.id), adGroupId: String(r.ad_group.id), criterion: String(r.ad_group_criterion.resource_name), text: String(r.ad_group_criterion.keyword?.text ?? ""),
    match: nm(MATCH, r.ad_group_criterion.keyword?.match_type), qs: r.ad_group_criterion.quality_info?.quality_score ?? null,
    cost: (Number(r.metrics.cost_micros) || 0) / 1e6, clicks: Number(r.metrics.clicks) || 0, conversions: Number(r.metrics.conversions) || 0, purchases: pKw.get(String(r.ad_group_criterion.resource_name)) ?? 0 }))
  const group = <T extends string>(rows: KeywordRow[], k: (x: KeywordRow) => T) => { const m = new Map<T, { cost: number; purchases: number; keywords: number }>(); for (const x of rows) { const g = m.get(k(x)) ?? { cost: 0, purchases: 0, keywords: 0 }; g.cost += x.cost; g.purchases += x.purchases; g.keywords++; m.set(k(x), g) } return m }
  const devCost = new Map<string, number>(); for (const r of dev) { const d = nm(DEVICE, r.segments.device); devCost.set(d, (devCost.get(d) ?? 0) + (Number(r.metrics.cost_micros) || 0) / 1e6) }
  const accCost = campaigns.reduce((s, x) => s + x.cost, 0), accP = campaigns.reduce((s, x) => s + x.purchases, 0)
  const value: SearchXray = {
    company, range, collectedAt: new Date().toISOString(), campaigns,
    account: { cost: accCost, purchases: accP, cpa: cpaOf(accCost, accP), intents: intentCells(terms, lex) },
    matchTypes: [...group(keywords, (x) => x.match)].map(([match, g]) => ({ match, cost: g.cost, purchases: g.purchases })).sort((a, b) => b.cost - a.cost),
    qs: [...group(keywords, (x) => (x.qs == null ? "?" : String(x.qs)))].map(([qs, g]) => ({ qs, ...g })).sort((a, b) => (a.qs === "?" ? 99 : Number(a.qs)) - (b.qs === "?" ? 99 : Number(b.qs))),
    devices: [...devCost].map(([device, cost]) => ({ device, cost, purchases: pDev.get(device) ?? 0 })).sort((a, b) => b.cost - a.cost),
    keywords, terms: terms.sort((a, b) => b.cost - a.cost).slice(0, 5000),
    warnings: campaigns.flatMap((x) => x.warnings).sort((a, b) => (a.level === b.level ? (b.money ?? 0) - (a.money ?? 0) : a.level === "bad" ? -1 : 1)),
    notes: ["Auction insights (đối thủ cùng phiên đấu giá): developer token chưa được Google cấp quyền nhóm số liệu này — không đọc được qua API."],
    errors,
  }
  memo.set(key, { at: Date.now(), value })
  return value
}
