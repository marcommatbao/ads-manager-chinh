// ============================================================
// Đợt 10a — PMax X-quang: kênh × kiểu ghi nhận · lượt tìm theo ý định · PMax ăn sang Search (CHỈ ĐỌC)
// ============================================================
// Đo 28/09 (30 ngày): PMax MBC chi ₫64,9tr, YouTube ₫45,9tr (71%) với 818,6 "Purchase" — 787,2 là ENGAGED_VIEW
// (xem ≥10 giây, KHÔNG bấm, rồi mua). Smart Bidding tính cả loại này → PMax dồn tiền vào xem video. PMax Insights cũ chỉ
// chia kênh theo chi/đơn gộp nên không thấy. Ở đây TÁCH đơn theo kiểu ghi nhận và chấm CPA theo đơn TỪ LƯỢT BẤM.
// Google không cho lấy chi phí cùng segments.conversion_attribution_event_type → 2 truy vấn rồi nối theo (chiến dịch, kênh).

import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { intentOf, mentionsBrand, type Intent, type IntentLexicon } from "@/lib/case/intent"
import type { TFunction } from "@/lib/i18n/translate"
import { viT, nfOf, tk } from "@/lib/google-i18n"
import { lexiconFor } from "@/lib/case/targets"
import { stripDiacritics } from "@/lib/case/text"
import type { Company } from "@/lib/case/types"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k]))
const NET = inv(enums.AdNetworkType as unknown as Record<string, unknown>)
const ATT = inv(enums.ConversionAttributionEventType as unknown as Record<string, unknown>)
const name = (map: Record<number, string>, v: unknown) => (typeof v === "number" ? map[v] ?? String(v) : String(v ?? "UNKNOWN"))

export const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Tìm kiếm", SEARCH_PARTNERS: "Đối tác tìm kiếm", CONTENT: "Hiển thị (Display)", YOUTUBE: "YouTube", GMAIL: "Gmail",
  DISCOVER: "Discover", MAPS: "Maps", GOOGLE_TV: "Google TV", MIXED: "Nhiều kênh", GOOGLE_OWNED_CHANNELS: "Kênh Google khác", UNKNOWN: "Không rõ",
}
/** Kênh ăn ≥ ngưỡng này trong chi PMax mà phần lớn đơn là engaged-view → cảnh báo. */
export const HEAVY_SHARE = 0.4
export const ENGAGED_HEAVY = 0.6

export interface ChannelRow {
  network: string; label: string
  cost: number; clicks: number; impressions: number
  /** Đơn từ lượt bấm/tương tác (kiểu ghi nhận khác ENGAGED_VIEW). */
  convClick: number
  /** Đơn sau lượt xem ≥10 giây không bấm. */
  convEngaged: number
  viewThrough: number
  value: number
  costShare: number
  cpaClick: number | null
}
export interface XrayWarning { level: "bad" | "warn"; id: string; text: string; campaignId?: string }

/** Hàm thuần: 2 bảng thô → kênh (có chia kiểu ghi nhận) + cảnh báo. */
export const channelLabel = (n: string, t: TFunction = viT): string => { const k = `libgoogle.chl.${n}`; const v = tk(t, k); return v === k ? n : v }

/** Cảnh báo từ các dòng kênh đã gộp — HÀM THUẦN (dựng lại được theo ngôn ngữ mà không cần số thô). */
export function channelWarnings(channels: ChannelRow[], t: TFunction = viT): XrayWarning[] {
  const fmt = (n: number) => n.toLocaleString(nfOf(t), { maximumFractionDigits: 1 })
  const warnings: XrayWarning[] = []
  for (const x of channels) {
    const conv = x.convClick + x.convEngaged
    const engagedShare = conv ? x.convEngaged / conv : 0
    if (x.costShare >= HEAVY_SHARE && engagedShare >= ENGAGED_HEAVY) warnings.push({ level: "bad", id: `engaged_${x.network}`,
      text: tk(t, "libgoogle.px.engaged", { label: x.label, share: Math.round(x.costShare * 100), eng: Math.round(engagedShare * 100), click: fmt(x.convClick), cpa: x.cpaClick ? tk(t, "libgoogle.px.cpaPer", { v: fmt(Math.round(x.cpaClick)) }) : tk(t, "libgoogle.px.none") }) })
    else if (x.costShare >= HEAVY_SHARE && x.convClick === 0 && x.cost > 0) warnings.push({ level: "bad", id: `nochannel_${x.network}`,
      text: tk(t, "libgoogle.px.noChannel", { label: x.label, share: Math.round(x.costShare * 100) }) })
  }
  return warnings
}

/** Hàm thuần: 2 bảng thô → kênh (có chia kiểu ghi nhận) + cảnh báo. */
export function buildChannels(costRows: { network: string; cost: number; clicks: number; impressions: number; viewThrough: number }[], convRows: { network: string; attribution: string; conversions: number; value: number }[], t: TFunction = viT): { channels: ChannelRow[]; totals: { cost: number; convClick: number; convEngaged: number }; warnings: XrayWarning[] } {
  const by = new Map<string, ChannelRow>()
  const get = (n: string) => by.get(n) ?? { network: n, label: channelLabel(n, t), cost: 0, clicks: 0, impressions: 0, convClick: 0, convEngaged: 0, viewThrough: 0, value: 0, costShare: 0, cpaClick: null }
  for (const r of costRows) { const x = get(r.network); x.cost += r.cost; x.clicks += r.clicks; x.impressions += r.impressions; x.viewThrough += r.viewThrough; by.set(r.network, x) }
  for (const r of convRows) {
    const x = get(r.network)
    if (r.attribution === "ENGAGED_VIEW") x.convEngaged += r.conversions; else x.convClick += r.conversions
    x.value += r.value
    by.set(r.network, x)
  }
  const cost = [...by.values()].reduce((s, x) => s + x.cost, 0)
  const channels = [...by.values()].map((x) => ({ ...x, costShare: cost ? x.cost / cost : 0, cpaClick: x.convClick > 0 ? x.cost / x.convClick : null }))
    .filter((x) => x.cost > 0 || x.convClick + x.convEngaged > 0).sort((a, b) => b.cost - a.cost)
  const warnings = channelWarnings(channels, t)
  return { channels, totals: { cost, convClick: channels.reduce((s, x) => s + x.convClick, 0), convEngaged: channels.reduce((s, x) => s + x.convEngaged, 0) }, warnings }
}

// ── Lượt tìm PMax theo ý định + n-gram ──
export interface SearchTermRow { campaignId: string; term: string; cost: number; clicks: number; conversions: number; impressions: number }
export interface IntentSummary { intent: Intent; label: string; terms: number; cost: number; clicks: number; conversions: number; examples: { term: string; clicks: number; conversions: number }[] }
export function summarizeTerms(rows: SearchTermRow[], lex: IntentLexicon, t: TFunction = viT): { intents: IntentSummary[]; ngrams: { gram: string; terms: number; clicks: number; conversions: number }[] } {
  const by = new Map<Intent, IntentSummary & { all: SearchTermRow[] }>()
  for (const r of rows) {
    const k = intentOf(r.term, lex)
    const b = by.get(k) ?? { intent: k, label: tk(t, `libgoogle.intent.${k}`), terms: 0, cost: 0, clicks: 0, conversions: 0, examples: [], all: [] }
    b.terms++; b.cost += r.cost; b.clicks += r.clicks; b.conversions += r.conversions; b.all.push(r)
    by.set(k, b)
  }
  const intents = [...by.values()].map(({ all, ...b }) => ({ ...b, examples: all.sort((a, c) => c.clicks - a.clicks || c.impressions - a.impressions).slice(0, 8).map((r) => ({ term: r.term, clicks: r.clicks, conversions: Math.round(r.conversions * 10) / 10 })) }))
    .sort((a, b) => b.clicks - a.clicks)
  const grams = new Map<string, { gram: string; terms: number; clicks: number; conversions: number }>()
  for (const r of rows) {
    const w = stripDiacritics(r.term).split(/\s+/).filter((x) => x.length > 1)
    const seen = new Set<string>()
    for (let n = 1; n <= 2; n++) for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n).join(" ")
      if (seen.has(g)) continue
      seen.add(g)
      const x = grams.get(g) ?? { gram: g, terms: 0, clicks: 0, conversions: 0 }
      x.terms++; x.clicks += r.clicks; x.conversions += r.conversions
      grams.set(g, x)
    }
  }
  const ngrams = [...grams.values()].filter((g) => g.terms >= 3).sort((a, b) => b.clicks - a.clicks).slice(0, 30)
  return { intents, ngrams }
}

// ── PMax ăn sang Search ──
export interface Cannibalization { overlapTerms: number; overlapClicks: number; overlapConversions: number; pmaxClicks: number; brandClicks: number; brandShare: number; examples: { term: string; clicks: number; searchKeyword: string }[] }
const norm = (s: string) => stripDiacritics(s).replace(/[+"[\]]/g, " ").replace(/\s+/g, " ").trim()
export function cannibalization(terms: SearchTermRow[], searchKeywords: string[], lex: IntentLexicon): Cannibalization {
  const kws = [...new Set(searchKeywords.map(norm).filter(Boolean))]
  const kwSet = new Set(kws)
  let overlapTerms = 0, overlapClicks = 0, overlapConversions = 0, pmaxClicks = 0, brandClicks = 0
  const examples: Cannibalization["examples"] = []
  for (const t of terms) {
    pmaxClicks += t.clicks
    const n = norm(t.term)
    if (mentionsBrand(t.term, lex)) brandClicks += t.clicks
    // Trùng = đúng từ khoá, hoặc lượt tìm CHỨA trọn một từ khoá Search ≥ 2 từ.
    const hit = kwSet.has(n) ? n : kws.find((k) => k.includes(" ") && ` ${n} `.includes(` ${k} `))
    if (hit) { overlapTerms++; overlapClicks += t.clicks; overlapConversions += t.conversions; if (t.clicks > 0) examples.push({ term: t.term, clicks: t.clicks, searchKeyword: hit }) }
  }
  return { overlapTerms, overlapClicks, overlapConversions: Math.round(overlapConversions * 10) / 10, pmaxClicks, brandClicks, brandShare: pmaxClicks ? brandClicks / pmaxClicks : 0, examples: examples.sort((a, b) => b.clicks - a.clicks).slice(0, 12) }
}

// ── Đọc ──
export interface PmaxXray {
  company: Company; range: { from: string; to: string }; collectedAt: string
  campaigns: { id: string; name: string; status: string; budget: number; bidding: string; cost: number; convClick: number; convEngaged: number; channels: ChannelRow[]; warnings: XrayWarning[] }[]
  account: { channels: ChannelRow[]; totals: { cost: number; convClick: number; convEngaged: number }; warnings: XrayWarning[] }
  terms: { total: number; intents: IntentSummary[]; ngrams: { gram: string; terms: number; clicks: number; conversions: number }[]
    /** Lượt tìm có ≥ 1 lượt bấm (tối đa 3000) — để 10b đề xuất phủ định. */
    rows: SearchTermRow[] }
  /** Từ khoá Search đang chạy (chữ thường) — 10b kiểm có Search thương hiệu chưa trước khi loại thương hiệu khỏi PMax. */
  searchKeywords: string[]
  cannibalization: Cannibalization
  /** Asset group của PMax đang chạy: độ mạnh quảng cáo + trạng thái phục vụ. */
  assetGroups: { campaignId: string; campaignName: string; name: string; adStrength: string; status: string }[]
  errors: string[]
}

// Bộ nhớ đệm giữ bản TIẾNG VIỆT; chữ theo ngôn ngữ được dựng lại mỗi yêu cầu (renderPmaxXray) → EN không đầu độc VI.
const memo = new Map<string, { at: number; value: PmaxXray }>()

/** Dựng lại nhãn kênh / nhãn ý định / cảnh báo theo ngôn ngữ của t — không đụng số liệu. */
export function renderPmaxXray(v: PmaxXray, t: TFunction): PmaxXray {
  if (nfOf(t) === nfOf(viT)) return v
  const relabel = (cs: ChannelRow[]) => cs.map((c) => ({ ...c, label: channelLabel(c.network, t) }))
  const account = { ...v.account, channels: relabel(v.account.channels) }
  account.warnings = channelWarnings(account.channels, t)
  const campaigns = v.campaigns.map((c) => { const channels = relabel(c.channels); return { ...c, channels, warnings: channelWarnings(channels, t).map((w) => ({ ...w, campaignId: c.id })) } })
  return { ...v, account, campaigns, terms: { ...v.terms, intents: v.terms.intents.map((i) => ({ ...i, label: tk(t, `libgoogle.intent.${i.intent}`) })) } }
}

export async function pmaxXray(company: Company, range: { from: string; to: string }, opts: { force?: boolean } = {}, t: TFunction = viT): Promise<PmaxXray> {
  return renderPmaxXray(await pmaxXrayVi(company, range, opts), t)
}

async function pmaxXrayVi(company: Company, range: { from: string; to: string }, opts: { force?: boolean } = {}): Promise<PmaxXray> {
  const key = `${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < 30 * 60_000) return hit.value
  const c = getGoogleAdsCustomer(company)
  const between = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const PM = "campaign.advertising_channel_type = 'PERFORMANCE_MAX'"
  const errors: string[] = []
  const q = async (label: string, g: string): Promise<Row[]> => { try { return (await c.query(g)) as Row[] } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); return [] } }
  const [meta, costR, convR, termR, kwR, agR] = await Promise.all([
    q("chiến dịch", `SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, campaign_budget.amount_micros FROM campaign WHERE ${PM} AND campaign.status != 'REMOVED'`),
    q("chi theo kênh", `SELECT campaign.id, segments.ad_network_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.view_through_conversions FROM campaign WHERE ${PM} AND ${between}`),
    q("đơn theo kiểu ghi nhận", `SELECT campaign.id, segments.ad_network_type, segments.conversion_attribution_event_type, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${PM} AND ${between}`),
    q("lượt tìm PMax", `SELECT campaign.id, campaign_search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.impressions FROM campaign_search_term_view WHERE ${PM} AND ${between}`),
    q("từ khoá Search", `SELECT ad_group_criterion.keyword.text FROM keyword_view WHERE campaign.advertising_channel_type = 'SEARCH' AND campaign.status = 'ENABLED' AND ad_group_criterion.status = 'ENABLED' AND ad_group_criterion.negative = FALSE AND ${between}`),
    q("asset group", `SELECT campaign.id, campaign.name, asset_group.name, asset_group.ad_strength, asset_group.primary_status FROM asset_group WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'`),
  ])
  const costRows = costR.map((r) => ({ campaignId: String(r.campaign.id), network: name(NET, r.segments.ad_network_type), cost: (Number(r.metrics.cost_micros) || 0) / 1e6, clicks: Number(r.metrics.clicks) || 0, impressions: Number(r.metrics.impressions) || 0, viewThrough: Number(r.metrics.view_through_conversions) || 0 }))
  const convRows = convR.map((r) => ({ campaignId: String(r.campaign.id), network: name(NET, r.segments.ad_network_type), attribution: name(ATT, r.segments.conversion_attribution_event_type), conversions: Number(r.metrics.conversions) || 0, value: Number(r.metrics.conversions_value) || 0 }))
  const account = buildChannels(costRows, convRows)
  const campaigns = meta.map((m) => {
    const id = String(m.campaign.id)
    const b = buildChannels(costRows.filter((r) => r.campaignId === id), convRows.filter((r) => r.campaignId === id))
    return { id, name: String(m.campaign.name), status: name(inv(enums.CampaignStatus as unknown as Record<string, unknown>), m.campaign.status), budget: (Number(m.campaign_budget?.amount_micros) || 0) / 1e6,
      bidding: name(inv(enums.BiddingStrategyType as unknown as Record<string, unknown>), m.campaign.bidding_strategy_type), cost: b.totals.cost, convClick: b.totals.convClick, convEngaged: b.totals.convEngaged, channels: b.channels,
      warnings: b.warnings.map((w) => ({ ...w, campaignId: id })) }
  }).filter((x) => x.cost > 0 || x.status === "ENABLED").sort((a, b) => b.cost - a.cost)
  const lex = lexiconFor(company)
  const terms: SearchTermRow[] = termR.map((r) => ({ campaignId: String(r.campaign.id), term: String(r.campaign_search_term_view.search_term ?? ""), cost: (Number(r.metrics.cost_micros) || 0) / 1e6, clicks: Number(r.metrics.clicks) || 0, conversions: Number(r.metrics.conversions) || 0, impressions: Number(r.metrics.impressions) || 0 })).filter((t) => t.term)
  const value: PmaxXray = {
    company, range, collectedAt: new Date().toISOString(), campaigns, account,
    terms: { total: terms.length, ...summarizeTerms(terms, lex), rows: terms.filter((t) => t.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 3000) },
    searchKeywords: [...new Set(kwR.map((r) => String(r.ad_group_criterion?.keyword?.text ?? "").toLowerCase()).filter(Boolean))],
    cannibalization: cannibalization(terms, kwR.map((r) => String(r.ad_group_criterion?.keyword?.text ?? "")), lex),
    assetGroups: agR.map((r) => ({ campaignId: String(r.campaign.id), campaignName: String(r.campaign.name), name: String(r.asset_group.name),
      adStrength: name(inv(enums.AdStrength as unknown as Record<string, unknown>), r.asset_group.ad_strength), status: name(inv(enums.AssetGroupPrimaryStatus as unknown as Record<string, unknown>), r.asset_group.primary_status) })),
    errors,
  }
  memo.set(key, { at: Date.now(), value })
  return value
}
