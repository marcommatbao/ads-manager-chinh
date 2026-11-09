// ============================================================
// Thu thập bằng chứng cho một chiến dịch Google Search — CHỈ ĐỌC
// ============================================================
// Hai lớp:
//   - `searchEvidenceQueries` + `collectSearchEvidence`: chạy GAQL, mỗi nguồn
//     try/catch riêng → một nguồn lỗi chỉ làm nguồn đó "Lỗi", không làm hỏng
//     cả phiên.
//   - `buildSearchEvidence`: hàm THUẦN đổi dòng thô → SearchEvidence (test
//     được bằng dữ liệu đã chụp, không cần mạng).
// Mọi truy vấn lọc theo campaign.id — KHÔNG theo tên: tài khoản MBI có chiến
// dịch đã xoá trùng tên chiến dịch đang chạy (đo 25/09).

import { CaseError } from "./errors"
import { enums } from "google-ads-api"
import type { Customer } from "google-ads-api"
import type { Company, EvidenceSource, SearchEvidence } from "./types"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Enum của SDK trả về số; đổi sang tên. Chuỗi thì giữ nguyên. */
function en(e: Record<string | number, string | number>, v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number") return String(e[v] ?? v)
  return ""
}
const micros = (v: unknown) => (Number(v) || 0) / 1_000_000
const num = (v: unknown) => Number(v) || 0
const nullableNum = (v: unknown) => (v === undefined || v === null ? null : Number(v))

/** Bỏ query string + "/" cuối để gộp cùng một trang ("…?utm_…" và "…/"). */
export function pageKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`
  } catch {
    return url.split("?")[0].replace(/\/+$/, "")
  }
}

export function searchEvidenceQueries(campaignId: string, from: string, to: string): Record<string, string> {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaignId phải là số")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Ngày phải dạng YYYY-MM-DD")
  const D = `segments.date BETWEEN '${from}' AND '${to}'`
  const C = `campaign.id = ${campaignId}`
  return {
    campaign: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign.bidding_strategy_type, campaign.maximize_conversions.target_cpa_micros,
        campaign.target_cpa.target_cpa_micros, campaign.maximize_conversion_value.target_roas,
        campaign.target_roas.target_roas, campaign_budget.amount_micros,
        metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions,
        metrics.conversions_value, metrics.all_conversions, metrics.search_impression_share,
        metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
      FROM campaign WHERE ${C} AND ${D}`,
    // Cả tài khoản: vừa để tách chuyển đổi của chiến dịch này theo hành động,
    // vừa để biết tag Mua hàng có ghi đơn ở chiến dịch khác không.
    convByAction: `SELECT campaign.id, segments.conversion_action_name, segments.conversion_action_category,
        metrics.conversions, metrics.all_conversions, metrics.all_conversions_value
      FROM campaign WHERE ${D} AND campaign.status != 'REMOVED' AND metrics.all_conversions > 0`,
    goals: `SELECT campaign.id, campaign_conversion_goal.category, campaign_conversion_goal.origin,
        campaign_conversion_goal.biddable
      FROM campaign_conversion_goal WHERE ${C}`,
    searchTerms: `SELECT search_term_view.search_term, segments.search_term_match_type,
        metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.all_conversions
      FROM search_term_view WHERE ${C} AND ${D} AND metrics.clicks > 0
      ORDER BY metrics.cost_micros DESC LIMIT 1000`,
    keywords: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
      FROM keyword_view WHERE ${C} AND ${D} AND ad_group_criterion.status != 'REMOVED'`,
    negatives: `SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
      FROM campaign_criterion WHERE ${C} AND campaign_criterion.negative = TRUE
        AND campaign_criterion.type = 'KEYWORD'`,
    ads: `SELECT ad_group_ad.ad.final_urls, ad_group_ad.policy_summary.approval_status, ad_group_ad.ad_strength
      FROM ad_group_ad WHERE ${C} AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'`,
    // landing_page_view bắt buộc có campaign.id trong SELECT khi lọc theo nó (đo thật 26/09).
    landing: `SELECT campaign.id, landing_page_view.unexpanded_final_url, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM landing_page_view WHERE ${C} AND ${D} AND metrics.clicks > 0`,
    landingAccount: `SELECT landing_page_view.unexpanded_final_url, metrics.conversions
      FROM landing_page_view WHERE ${D} AND metrics.conversions > 0`,
    ...sharedListQueries(campaignId),
  }
}

/** Danh sách phủ định dùng chung (NEGATIVE_KEYWORDS) + từng từ + list đang gắn vào chiến dịch — dùng cho cả Search và Pmax. */
function sharedListQueries(campaignId: string): Record<string, string> {
  return {
    sharedSets: `SELECT shared_set.id, shared_set.name, shared_set.resource_name FROM shared_set
      WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'`,
    sharedMembers: `SELECT shared_set.id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
      FROM shared_criterion WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'`,
    campaignSharedSets: `SELECT shared_set.id FROM campaign_shared_set
      WHERE campaign.id = ${campaignId} AND campaign_shared_set.status = 'ENABLED'`,
  }
}

/**
 * Pmax dùng chung phần lớn truy vấn với Search. Khác: lượt tìm từ
 * campaign_search_term_view (từng lượt tìm thật của Pmax — đo 26/09 đọc được
 * 2.313 dòng/30 ngày trên 3 Pmax MBI), không có chỉ số tỉ lệ hiển thị Search,
 * thêm chia kênh và danh sách phủ định dùng chung.
 */
export function pmaxEvidenceQueries(campaignId: string, from: string, to: string): Record<string, string> {
  const base = searchEvidenceQueries(campaignId, from, to)
  const D = `segments.date BETWEEN '${from}' AND '${to}'`
  const C = `campaign.id = ${campaignId}`
  return {
    campaign: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign.bidding_strategy_type, campaign.maximize_conversions.target_cpa_micros,
        campaign.target_cpa.target_cpa_micros, campaign.maximize_conversion_value.target_roas,
        campaign.target_roas.target_roas, campaign_budget.amount_micros,
        metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions,
        metrics.conversions_value, metrics.all_conversions
      FROM campaign WHERE ${C} AND ${D}`,
    convByAction: base.convByAction,
    goals: base.goals,
    searchTerms: `SELECT campaign_search_term_view.search_term, metrics.cost_micros, metrics.clicks,
        metrics.conversions, metrics.all_conversions
      FROM campaign_search_term_view WHERE ${C} AND ${D} AND metrics.clicks > 0
      ORDER BY metrics.cost_micros DESC LIMIT 2000`,
    network: `SELECT segments.ad_network_type, metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM campaign WHERE ${C} AND ${D}`,
    negatives: base.negatives,
    landing: base.landing,
    landingAccount: base.landingAccount,
    ...sharedListQueries(campaignId),
  }
}

export type RawSearchRows = Partial<Record<string, Row[]>>

const SOURCE_LABEL: Record<string, string> = {
  campaign: "Chiến dịch, giá thầu, tỉ lệ hiển thị",
  convByAction: "Chuyển đổi tách theo hành động",
  goals: "Mục tiêu dùng để đặt giá",
  searchTerms: "Từ khoá khách tìm",
  keywords: "Từ khoá đang chạy + điểm chất lượng",
  negatives: "Từ khoá phủ định",
  ads: "Quảng cáo & trang đích khai báo",
  landing: "Trang đích thực nhận click",
  landingAccount: "Đơn trên cùng trang đích (cả tài khoản)",
  network: "Chi phí theo kênh (Tìm kiếm / Hiển thị / YouTube…)",
  sharedSets: "Danh sách phủ định dùng chung",
  sharedMembers: "Từ trong các danh sách dùng chung",
  campaignSharedSets: "Danh sách dùng chung đang gắn",
}

export function buildSearchEvidence(input: {
  kind?: SearchEvidence["kind"]
  company: Company
  campaignId: string
  range: { from: string; to: string }
  raw: RawSearchRows
  errors?: Partial<Record<string, string>>
  collectedAt?: string
}): SearchEvidence {
  const { raw, campaignId } = input
  const errors = input.errors ?? {}
  const cr = raw.campaign?.[0]
  if (!cr) throw new CaseError(errors.campaign ? `Không đọc được chiến dịch: ${errors.campaign}` : "Không có số liệu chiến dịch trong kỳ", 500, errors.campaign ? { key: "libcase.s.ev.campReadFail", vars: { error: errors.campaign } } : { key: "libcase.s.ev.noCampData" })
  const cm = cr.metrics ?? {}
  const campaign = {
    id: String(cr.campaign.id),
    name: String(cr.campaign.name),
    status: en(enums.CampaignStatus, cr.campaign.status),
    channel: en(enums.AdvertisingChannelType, cr.campaign.advertising_channel_type),
    biddingType: en(enums.BiddingStrategyType, cr.campaign.bidding_strategy_type),
    targetCpa: micros(cr.campaign.maximize_conversions?.target_cpa_micros ?? cr.campaign.target_cpa?.target_cpa_micros) || null,
    targetRoas: nullableNum(cr.campaign.maximize_conversion_value?.target_roas ?? cr.campaign.target_roas?.target_roas),
    budgetDaily: cr.campaign_budget?.amount_micros ? micros(cr.campaign_budget.amount_micros) : null,
    cost: micros(cm.cost_micros),
    clicks: num(cm.clicks),
    impressions: num(cm.impressions),
    orders: num(cm.conversions),
    orderValue: num(cm.conversions_value),
    allConversions: num(cm.all_conversions),
    impressionShare: nullableNum(cm.search_impression_share),
    lostIsBudget: nullableNum(cm.search_budget_lost_impression_share),
    lostIsRank: nullableNum(cm.search_rank_lost_impression_share),
  }

  const conv = (raw.convByAction ?? []).map((r) => ({
    campaignId: String(r.campaign?.id),
    name: String(r.segments?.conversion_action_name ?? ""),
    category: en(enums.ConversionActionCategory, r.segments?.conversion_action_category),
    conversions: num(r.metrics?.conversions),
    allConversions: num(r.metrics?.all_conversions),
    value: num(r.metrics?.all_conversions_value),
  }))
  const conversionsByAction = conv.filter((r) => r.campaignId === campaignId)
    .map(({ campaignId: _id, ...r }) => r) // eslint-disable-line @typescript-eslint/no-unused-vars
  const purchasesElsewhere = conv
    .filter((r) => r.campaignId !== campaignId && r.category === "PURCHASE")
    .reduce((s, r) => s + r.conversions, 0)

  const biddableCategories = [...new Set((raw.goals ?? [])
    .filter((r) => r.campaign_conversion_goal?.biddable)
    .map((r) => en(enums.ConversionActionCategory, r.campaign_conversion_goal.category)))]

  const searchTerms = (raw.searchTerms ?? []).map((r) => ({
    term: String(r.search_term_view?.search_term ?? r.campaign_search_term_view?.search_term ?? ""),
    matchType: r.segments?.search_term_match_type !== undefined ? en(enums.SearchTermMatchType, r.segments.search_term_match_type) : "PMAX",
    cost: micros(r.metrics?.cost_micros),
    clicks: num(r.metrics?.clicks),
    conversions: num(r.metrics?.conversions),
    allConversions: num(r.metrics?.all_conversions),
  }))

  const keywords = (raw.keywords ?? []).map((r) => {
    const q = r.ad_group_criterion?.quality_info ?? {}
    const bucket = (v: unknown) => (v === undefined || v === null ? null : en(enums.QualityScoreBucket, v))
    return {
      text: String(r.ad_group_criterion?.keyword?.text ?? ""),
      match: en(enums.KeywordMatchType, r.ad_group_criterion?.keyword?.match_type),
      status: en(enums.AdGroupCriterionStatus, r.ad_group_criterion?.status),
      qualityScore: q.quality_score ? Number(q.quality_score) : null,
      landingExperience: bucket(q.post_click_quality_score),
      expectedCtr: bucket(q.search_predicted_ctr),
      cost: micros(r.metrics?.cost_micros),
      clicks: num(r.metrics?.clicks),
      impressions: num(r.metrics?.impressions),
      conversions: num(r.metrics?.conversions),
    }
  })

  const negatives = (raw.negatives ?? []).map((r) => ({
    text: String(r.campaign_criterion?.keyword?.text ?? ""),
    match: en(enums.KeywordMatchType, r.campaign_criterion?.keyword?.match_type),
  }))

  const ads = (raw.ads ?? []).map((r) => ({
    finalUrls: (r.ad_group_ad?.ad?.final_urls ?? []) as string[],
    approval: en(enums.PolicyApprovalStatus, r.ad_group_ad?.policy_summary?.approval_status),
    strength: en(enums.AdStrength, r.ad_group_ad?.ad_strength),
  }))

  const byPage = new Map<string, { url: string; clicks: number; cost: number; conversions: number }>()
  for (const r of raw.landing ?? []) {
    const k = pageKey(String(r.landing_page_view?.unexpanded_final_url ?? ""))
    const x = byPage.get(k) ?? { url: k, clicks: 0, cost: 0, conversions: 0 }
    x.clicks += num(r.metrics?.clicks)
    x.cost += micros(r.metrics?.cost_micros)
    x.conversions += num(r.metrics?.conversions)
    byPage.set(k, x)
  }
  const accPage = new Map<string, number>()
  for (const r of raw.landingAccount ?? []) {
    const k = pageKey(String(r.landing_page_view?.unexpanded_final_url ?? ""))
    accPage.set(k, (accPage.get(k) ?? 0) + num(r.metrics?.conversions))
  }

  const kind = input.kind ?? "google_search"
  const network = raw.network ? raw.network.map((r) => ({
    network: en(enums.AdNetworkType, r.segments?.ad_network_type),
    cost: micros(r.metrics?.cost_micros), clicks: num(r.metrics?.clicks), conversions: num(r.metrics?.conversions),
  })).sort((a, b) => b.cost - a.cost) : undefined
  const attachedIds = new Set((raw.campaignSharedSets ?? []).map((r) => String(r.shared_set?.id)))
  const sharedLists = raw.sharedSets ? raw.sharedSets.map((r) => ({
    id: String(r.shared_set?.id), name: String(r.shared_set?.name ?? ""), resourceName: String(r.shared_set?.resource_name ?? ""),
    members: (raw.sharedMembers ?? []).filter((m) => String(m.shared_set?.id) === String(r.shared_set?.id)).map((m) => ({
      text: String(m.shared_criterion?.keyword?.text ?? ""), match: en(enums.KeywordMatchType, m.shared_criterion?.keyword?.match_type),
    })),
    attached: attachedIds.has(String(r.shared_set?.id)),
  })) : undefined

  // Pmax: lượt tìm chỉ phủ phần mạng Tìm kiếm → so với chi phí kênh Tìm kiếm, không với tổng.
  const searchSlice = network?.find((n) => n.network === "SEARCH")
  const campaignCost = kind === "google_pmax" && searchSlice ? searchSlice.cost : campaign.cost
  const visible = searchTerms.reduce((s, t) => s + t.cost, 0)
  const sources: EvidenceSource[] = Object.keys(SOURCE_LABEL).filter((id) => id in raw || errors[id]).map((id) => {
    const rows = (raw as Record<string, Row[] | undefined>)[id]?.length ?? 0
    if (errors[id]) return { id, label: SOURCE_LABEL[id], status: "error", rows, note: errors[id] }
    if (id === "searchTerms" && campaignCost > 0 && visible / campaignCost < 0.95) {
      return { id, label: SOURCE_LABEL[id], status: "partial", rows,
        note: `Thấy ${(visible / campaignCost * 100).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% chi phí — Google ẩn lượt tìm quá ít người tìm` }
    }
    return { id, label: SOURCE_LABEL[id], status: "ok", rows }
  })

  return {
    kind,
    company: input.company,
    range: input.range,
    collectedAt: input.collectedAt ?? new Date().toISOString(),
    campaign,
    conversionsByAction,
    biddableCategories,
    purchasesElsewhere,
    searchTerms,
    keywords,
    negatives,
    ads,
    landingPages: [...byPage.values()],
    landingConversionsAccount: [...accPage.entries()].map(([url, conversions]) => ({ url, conversions })),
    sources,
    ...(network ? { network } : {}),
    ...(sharedLists ? { sharedLists } : {}),
  }
}

/** Chạy mọi truy vấn song song; lỗi từng nguồn được ghi lại, không ném. */
export async function collectSearchEvidence(
  customer: Customer, company: Company, campaignId: string, range: { from: string; to: string },
  kind: SearchEvidence["kind"] = "google_search",
): Promise<SearchEvidence> {
  const qs = kind === "google_pmax" ? pmaxEvidenceQueries(campaignId, range.from, range.to) : searchEvidenceQueries(campaignId, range.from, range.to)
  const raw: RawSearchRows = {}
  const errors: Record<string, string> = {}
  await Promise.all(Object.entries(qs).map(async ([id, gaql]) => {
    try {
      raw[id] = (await customer.query(gaql)) as Row[]
    } catch (e) {
      const err = e as { errors?: { message?: string }[]; message?: string }
      errors[id] = err?.errors?.[0]?.message ?? err?.message ?? String(e)
    }
  }))
  return buildSearchEvidence({ kind, company, campaignId, range, raw, errors })
}
