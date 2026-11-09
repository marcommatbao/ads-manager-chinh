// ============================================================
// Bước 2 (Facebook) — thu thập bằng chứng, CHỈ ĐỌC
// ============================================================
// Ngân sách lượt gọi: app Meta ở bậc development (~60 lượt/giờ/tài khoản), nên
// một lần thu thập dùng đúng 4 lượt cho chiến dịch + 1 lượt số liệu cả tài
// khoản (đệm 10 phút, dùng chung với bảng tổng quan):
//   1. chiến dịch + nhóm quảng cáo + liên kết quảng cáo (field expansion)
//   2. số liệu cấp chiến dịch (reach/tần suất không cộng dồn được từ nhóm)
//   3. số liệu cấp nhóm quảng cáo
//   4. số liệu nhóm quảng cáo × vị trí hiển thị
// Đo 26/09 (MBI): nhóm quảng cáo tối ưu custom_event_type "OTHER" +
// custom_event_str "add_payment_info" — sự kiện TỰ ĐẶT, Insights chỉ đếm gộp
// mọi sự kiện tự đặt dưới "offsite_conversion.fb_pixel_custom" nên số kết quả
// theo vị trí là XẤP XỈ (ghi rõ ở optResultsApprox).

import { CaseError } from "./errors"
import { enrichPostAds } from "@/lib/meta/page-posts"
import { detectCompany } from "@/lib/company-detect"
import { labelForStandardEvent } from "@/lib/meta-pixel-events"
import { resolveConversionActionTypes } from "@/lib/meta-conversion-goal"
import { extractUtmCampaign, fetchCampaignRevenue } from "@/lib/odoo-campaign-revenue"
import { adAccountId, metaGet, metaGetAll } from "./meta-graph"
import { placementKey, placementLabel } from "./meta-placements"
import { productGroupOf } from "./product"
import { vnDate } from "./dates"
import { META_LEAD_TYPES } from "./goal-kind"
import type { Company, EvidenceSource, MetaAdSetFacts, MetaCampaignFacts, MetaEvidence, MetaOptEvent, MetaPlacementSlice } from "./types"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Act = { action_type: string; value: string }

export const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]
export const CUSTOM_EVENT_TYPE = "offsite_conversion.fb_pixel_custom"
export const LANDING_TYPES = ["landing_page_view", "omni_landing_page_view"]

/** Giá trị đầu tiên có mặt theo thứ tự ưu tiên — omni/pixel là cùng một sự kiện đếm hai tên, KHÔNG cộng. */
/** Đợt 12 (D): số theo MỘT cửa sổ ghi nhận ("7d_click" / "1d_view") khi truy vấn có action_attribution_windows. */
export function pickActionWindow(arr: (Act & Record<string, unknown>)[] | null | undefined, types: string[], window: "7d_click" | "1d_view"): number | null {
  for (const t of types) {
    const x = arr?.find((a) => a.action_type === t)
    if (x) return x[window] !== undefined ? Number(x[window]) || 0 : 0
  }
  return arr ? 0 : null
}

export function pickAction(arr: Act[] | null | undefined, types: string[]): number {
  for (const t of types) {
    const x = arr?.find((a) => a.action_type === t)
    if (x) return Number(x.value) || 0
  }
  return 0
}

/** Gộp các tên trùng (omni_/offsite_conversion.fb_pixel_) về một tên gốc, lấy số lớn nhất. */
export function normalizeActions(actions: Act[] | null | undefined, values: Act[] | null | undefined): { type: string; count: number; value: number }[] {
  const base = (t: string) => t.replace(/^omni_/, "").replace(/^offsite_conversion\.fb_pixel_/, "").replace(/^onsite_web_/, "")
  const out = new Map<string, { type: string; count: number; value: number }>()
  for (const a of actions ?? []) {
    if (a.action_type === CUSTOM_EVENT_TYPE) { out.set("custom", { type: "custom", count: Number(a.value) || 0, value: 0 }); continue }
    const k = base(a.action_type)
    const cur = out.get(k) ?? { type: k, count: 0, value: 0 }
    cur.count = Math.max(cur.count, Number(a.value) || 0)
    out.set(k, cur)
  }
  for (const v of values ?? []) {
    const k = v.action_type === CUSTOM_EVENT_TYPE ? "custom" : base(v.action_type)
    const cur = out.get(k)
    if (cur) cur.value = Math.max(cur.value, Number(v.value) || 0)
  }
  return [...out.values()].sort((a, b) => b.count - a.count)
}

export function optEventOf(promoted: Row | undefined, optimizationGoal: string): MetaOptEvent {
  const type = String(promoted?.custom_event_type ?? "")
  const customName = promoted?.custom_event_str ? String(promoted.custom_event_str) : null
  if (type === "OTHER" || (customName && !type)) {
    return { type: "OTHER", customName, label: `Sự kiện tự đặt “${customName ?? "không rõ tên"}”`, isPurchase: false }
  }
  if (type) return { type, customName: null, label: labelForStandardEvent(type), isPurchase: type === "PURCHASE" }
  return { type: optimizationGoal || "UNKNOWN", customName: null, label: optimizationGoal || "Không rõ", isPurchase: false }
}

/** action_type để đếm "kết quả" theo sự kiện tối ưu của nhóm. */
export function optActionTypes(promoted: Row | undefined, optimizationGoal: string): { types: string[]; approx: boolean } {
  if (promoted?.custom_conversion_id) return { types: [`offsite_conversion.custom.${promoted.custom_conversion_id}`], approx: false }
  if (String(promoted?.custom_event_type ?? "") === "OTHER") return { types: [CUSTOM_EVENT_TYPE], approx: true }
  return { types: resolveConversionActionTypes({ optimization_goal: optimizationGoal, custom_event_type: promoted?.custom_event_type }), approx: false }
}

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v))

/** Số liệu cả tài khoản theo chiến dịch — đệm 10 phút, dùng chung cho tổng quan và phiên. */
const accountMemo = new Map<string, { at: number; rows: Row[] }>()
export async function accountCampaignInsights(range: { from: string; to: string }): Promise<Row[]> {
  const key = `${range.from}|${range.to}`
  const hit = accountMemo.get(key)
  if (hit && Date.now() - hit.at < 600_000) return hit.rows
  const rows = await metaGetAll<Row>(`act_${adAccountId()}/insights`, {
    level: "campaign", time_range: JSON.stringify({ since: range.from, until: range.to }),
    fields: "campaign_id,campaign_name,spend,impressions,clicks,frequency,actions,action_values", limit: "200",
  })
  accountMemo.set(key, { at: Date.now(), rows })
  return rows
}

/** Sự kiện dùng để khuyên "tối ưu theo gì" — từ sâu (Mua hàng) đến nông. */
export const FUNNEL_EVENTS: { key: string; label: string; types: string[] }[] = [
  { key: "purchase", label: "Mua hàng", types: PURCHASE_TYPES },
  { key: "add_payment_info", label: "Thêm thông tin thanh toán (chuẩn)", types: ["add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"] },
  { key: "initiate_checkout", label: "Bắt đầu thanh toán", types: ["initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"] },
  { key: "add_to_cart", label: "Thêm vào giỏ", types: ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"] },
  { key: "complete_registration", label: "Hoàn tất đăng ký", types: ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"] },
  { key: "lead", label: "Khách hàng tiềm năng", types: ["lead", "offsite_conversion.fb_pixel_lead"] },
  { key: "custom", label: "Sự kiện tự đặt (mọi tên gộp lại)", types: [CUSTOM_EVENT_TYPE] },
  { key: "landing_page_view", label: "Xem trang đích", types: LANDING_TYPES },
]

export function peersOf(rows: Row[], company: Company, campaignName: string, range: { from: string; to: string }): MetaEvidence["peers"] {
  const group = productGroupOf(campaignName)
  const mine = rows.filter((r) => detectCompany(String(r.campaign_name ?? "")) === company && productGroupOf(String(r.campaign_name ?? "")) === group)
  const days = Math.max(1, Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1)
  const weeks = days / 7
  const eventsPerWeek: Record<string, number> = {}
  for (const e of FUNNEL_EVENTS) eventsPerWeek[e.key] = Math.round((mine.reduce((s, r) => s + pickAction(r.actions, e.types), 0) / weeks) * 10) / 10
  return { campaigns: mine.length, activeCampaigns: mine.filter((r) => Number(r.spend) > 0).length, weeks: Math.round(weeks * 10) / 10, eventsPerWeek }
}

function linksOf(ads: Row[]): { urls: string[]; urlTags: string[] } {
  const urls: string[] = [], urlTags: string[] = []
  for (const ad of ads) {
    const c = ad.creative ?? {}
    if (c.url_tags) urlTags.push(String(c.url_tags))
    const s = c.object_story_spec ?? {}
    // __post = nội dung bài viết đọc bằng token Trang (lib/meta/page-posts.ts · Đợt 8).
    for (const u of [s.link_data?.link, s.video_data?.call_to_action?.value?.link, ...(c.asset_feed_spec?.link_urls ?? []).map((x: Row) => x.website_url), c.__post?.link]) {
      if (u) urls.push(String(u))
    }
  }
  return { urls, urlTags }
}

/**
 * Quảng cáo đọc được link đích không. Quảng cáo BÀI VIẾT (dùng bài có sẵn của
 * trang) chỉ có effective_object_story_id; link nằm trong bài — đọc bằng token
 * Trang (enrichPostAds, Đợt 8). Còn "post_unreadable" = Trang chưa có token.
 * Link trỏ về chính Facebook (sự kiện, trang, Messenger) không phải trang đích nên không kiểm utm.
 */
export const ON_PLATFORM_HOSTS = /(^|\.)(facebook\.com|fb\.me|fb\.com|m\.me|messenger\.com|instagram\.com|wa\.me|whatsapp\.com)$/i
export function adLinkKind(ad: Row): "readable" | "on_platform" | "post_unreadable" | "none" {
  const { urls } = linksOf([ad])
  if (urls.length) {
    const offsite = urls.some((u) => { try { return !ON_PLATFORM_HOSTS.test(new URL(u).hostname) } catch { return false } })
    return offsite ? "readable" : "on_platform"
  }
  return ad.creative?.effective_object_story_id || ad.creative?.object_story_id ? "post_unreadable" : "none"
}

export function utmTagsOf(ads: Row[]): string[] {
  const { urls, urlTags } = linksOf(ads)
  const tags = new Set<string>()
  for (const u of urls) { const t = extractUtmCampaign(u); if (t) tags.add(t) }
  for (const q of urlTags) { const t = extractUtmCampaign(`?${q}`); if (t) tags.add(t) }
  return [...tags]
}

export async function collectMetaEvidence(company: Company, campaignId: string, range: { from: string; to: string }): Promise<MetaEvidence> {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaignId không hợp lệ")
  const sources: EvidenceSource[] = []
  const tr = JSON.stringify({ since: range.from, until: range.to })

  const c = await metaGet<Row>(campaignId, {
    fields: [
      "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy",
      "adsets.limit(100){id,name,status,effective_status,daily_budget,optimization_goal,promoted_object,learning_stage_info,targeting,attribution_spec}",
      "ads.limit(100){creative{url_tags,effective_object_story_id,object_story_spec{link_data{link},video_data{call_to_action{value{link}}}},asset_feed_spec{link_urls}}}",
    ].join(","),
  })
  if (detectCompany(String(c.name)) !== company) throw new CaseError("Chiến dịch này không thuộc công ty đang chọn", 500, { key: "libcase.s.ev.foreignCampaign" })
  const adsetRows: Row[] = c.adsets?.data ?? []
  sources.push({ id: "structure", label: "Chiến dịch + nhóm quảng cáo", status: "ok", rows: adsetRows.length })

  const [campIns] = (await metaGet<{ data?: Row[] }>(`${campaignId}/insights`, {
    time_range: tr, fields: "spend,impressions,reach,frequency,clicks,actions,action_values",
    // Đợt 12: tách đơn từ lượt BẤM (7 ngày) và đơn chỉ XEM (1 ngày) — đo 29/09: ~90% "Mua hàng" Meta báo là 1d_view.
    action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
  })).data ?? []
  const adsetIns = await metaGetAll<Row>(`${campaignId}/insights`, {
    level: "adset", time_range: tr, fields: "adset_id,spend,impressions,clicks,frequency,actions,action_values", limit: "200",
  })
  sources.push({ id: "insights", label: "Số liệu chiến dịch + nhóm quảng cáo", status: "ok", rows: adsetIns.length })

  let placementRows: Row[] = []
  try {
    placementRows = await metaGetAll<Row>(`${campaignId}/insights`, {
      level: "adset", time_range: tr, breakdowns: "publisher_platform,platform_position",
      fields: "adset_id,spend,impressions,clicks,actions", limit: "500",
    })
    sources.push({ id: "placements", label: "Chi phí theo vị trí hiển thị", status: "ok", rows: placementRows.length })
  } catch (e) {
    sources.push({ id: "placements", label: "Chi phí theo vị trí hiển thị", status: "error", rows: 0, note: e instanceof Error ? e.message : String(e) })
  }

  const insByAdset = new Map(adsetIns.map((r) => [String(r.adset_id), r]))
  const optTypesByAdset = new Map<string, { types: string[]; approx: boolean }>()
  const adsets: MetaAdSetFacts[] = adsetRows.map((a) => {
    const ins = insByAdset.get(String(a.id)) ?? {}
    const opt = optActionTypes(a.promoted_object, String(a.optimization_goal ?? ""))
    optTypesByAdset.set(String(a.id), opt)
    const ls = a.learning_stage_info ?? {}
    return {
      id: String(a.id), name: String(a.name ?? ""), status: String(a.status ?? ""), effectiveStatus: String(a.effective_status ?? ""),
      dailyBudget: num(a.daily_budget), optimizationGoal: String(a.optimization_goal ?? ""),
      optEvent: optEventOf(a.promoted_object, String(a.optimization_goal ?? "")),
      learning: {
        status: ls.status ? String(ls.status) : null, conversions: num(ls.conversions),
        lastSigEditAt: ls.last_sig_edit_ts ? new Date(Number(ls.last_sig_edit_ts) * 1000).toISOString() : null,
      },
      targeting: (a.targeting ?? {}) as Record<string, unknown>,
      automaticPlacement: !Array.isArray(a.targeting?.publisher_platforms),
      cost: Number(ins.spend) || 0, impressions: Number(ins.impressions) || 0, clicks: Number(ins.clicks) || 0,
      frequency: num(ins.frequency),
      purchases: pickAction(ins.actions, PURCHASE_TYPES), purchaseValue: pickAction(ins.action_values, PURCHASE_TYPES),
      optResults: pickAction(ins.actions, opt.types), optResultsApprox: opt.approx, leads: pickAction(ins.actions, META_LEAD_TYPES),
      attributionSpec: Array.isArray(a.attribution_spec) ? (a.attribution_spec as Row[]).map((x) => ({ eventType: String(x.event_type), windowDays: Number(x.window_days) || 0 })) : undefined,
    }
  }).sort((x, y) => y.cost - x.cost)

  const placements: MetaPlacementSlice[] = placementRows.map((p) => {
    const key = placementKey(String(p.publisher_platform), String(p.platform_position))
    const opt = optTypesByAdset.get(String(p.adset_id)) ?? { types: PURCHASE_TYPES, approx: false }
    return {
      adsetId: String(p.adset_id), key, label: placementLabel(key),
      cost: Number(p.spend) || 0, impressions: Number(p.impressions) || 0, clicks: Number(p.clicks) || 0,
      landingViews: pickAction(p.actions, LANDING_TYPES), purchases: pickAction(p.actions, PURCHASE_TYPES), optResults: pickAction(p.actions, opt.types),
      leads: pickAction(p.actions, META_LEAD_TYPES),
    }
  }).filter((p) => p.cost > 0).sort((x, y) => y.cost - x.cost)

  const ci = campIns ?? {}
  const campaign: MetaCampaignFacts = {
    id: String(c.id), name: String(c.name), status: String(c.status ?? ""), effectiveStatus: String(c.effective_status ?? ""),
    objective: String(c.objective ?? ""), dailyBudget: num(c.daily_budget), lifetimeBudget: num(c.lifetime_budget),
    bidStrategy: c.bid_strategy ? String(c.bid_strategy) : null,
    cost: Number(ci.spend) || 0, impressions: Number(ci.impressions) || 0, reach: Number(ci.reach) || 0,
    frequency: num(ci.frequency), clicks: Number(ci.clicks) || 0,
    linkClicks: pickAction(ci.actions, ["link_click"]), landingViews: pickAction(ci.actions, LANDING_TYPES),
    purchases: pickAction(ci.actions, PURCHASE_TYPES), purchaseValue: pickAction(ci.action_values, PURCHASE_TYPES),
    purchasesClick: pickActionWindow(ci.actions, PURCHASE_TYPES, "7d_click"), purchasesView: pickActionWindow(ci.actions, PURCHASE_TYPES, "1d_view"),
    leads: pickAction(ci.actions, META_LEAD_TYPES),
    actions: normalizeActions(ci.actions, ci.action_values),
  }

  // Đối chiếu Odoo — lỗi ở đây không chặn phiên, chỉ ghi rõ là chưa kiểm được.
  const adRows: Row[] = c.ads?.data ?? []
  const postStats = await enrichPostAds(adRows).catch(() => null)
  const kinds = adRows.map(adLinkKind)
  const readable = kinds.filter((k) => k === "readable").length
  const postUnreadable = kinds.filter((k) => k === "post_unreadable").length
  const tags = utmTagsOf(adRows.filter((_, i) => kinds[i] === "readable"))
  let odoo: MetaEvidence["odoo"]
  if (!readable && postUnreadable) {
    // Đo 27/09: kết luận cũ "quảng cáo không gắn utm" ở đây là SAI — thật ra là không đọc được bài viết.
    odoo = { checked: false, tags: [], orders: 0, revenue: 0, readableAds: 0, unreadableAds: postUnreadable,
      note: `${postUnreadable} quảng cáo bài viết chưa đọc được link — ${postStats?.tokenErrors.length ? "token Trang hết hiệu lực" : "Trang chưa có token"} (Cài đặt → Kết nối → Trang Facebook). Chưa biết có utm hay không.` }
    sources.push({ id: "odoo", label: "Đơn hàng Odoo theo utm_campaign", status: "partial", rows: 0, note: "Không đọc được link của quảng cáo bài viết" })
  } else try {
    // Đúng khoảng của phiên (có ngày KẾT THÚC) — khoảng trong quá khứ không bị cộng đơn tới hôm nay.
    const r = await fetchCampaignRevenue(tags, new Map(), 0, range)
    odoo = {
      checked: tags.length > 0, tags, orders: r.totalOrders, revenue: r.totalRevenueVnd, readableAds: readable, unreadableAds: postUnreadable,
      // Không kiểm thẻ có dùng chung chiến dịch khác (tốn thêm lượt gọi Meta) — nói ra, không để note "dùng riêng" của hàm gốc.
      // Odoo KHÔNG lưu utm_source (source_id là nguồn khách, vd "Đơn hàng MBI online" — đo 27/09) và
      // cùng utm_campaign được cả Pmax Google dùng → số đơn này gồm cả đơn từ Google.
      note: tags.length ? `Đơn Odoo mang thẻ ${tags.map((t) => `“${t}”`).join(", ")} từ ${range.from} tới nay — gồm cả đơn từ Google/chiến dịch khác dùng chung thẻ; Odoo không lưu utm_source nên không tách được theo nền tảng.` : r.note,
    }
    sources.push({ id: "odoo", label: "Đơn hàng Odoo theo utm_campaign", status: tags.length ? "ok" : "partial", rows: r.totalOrders, note: tags.length ? undefined : "Quảng cáo không gắn utm_campaign" })
  } catch (e) {
    odoo = { checked: false, tags, orders: 0, revenue: 0, readableAds: readable, unreadableAds: postUnreadable, note: `Không đọc được Odoo: ${e instanceof Error ? e.message : String(e)}` }
    sources.push({ id: "odoo", label: "Đơn hàng Odoo theo utm_campaign", status: "error", rows: 0, note: odoo.note })
  }

  let peers: MetaEvidence["peers"] = { campaigns: 0, activeCampaigns: 0, weeks: 0, eventsPerWeek: {} }
  try {
    peers = peersOf(await accountCampaignInsights(range), company, campaign.name, range)
    sources.push({ id: "peers", label: "Chiến dịch cùng sản phẩm (cả tài khoản)", status: "ok", rows: peers.campaigns })
  } catch (e) {
    sources.push({ id: "peers", label: "Chiến dịch cùng sản phẩm (cả tài khoản)", status: "error", rows: 0, note: e instanceof Error ? e.message : String(e) })
  }

  // Pixel của nhóm tốn tiền nhất — số theo TÊN sự kiện 7 ngày gần nhất (1 lượt gọi).
  let pixel: MetaEvidence["pixel"] = null
  const pixelId = adsetRows.map((a) => a.promoted_object?.pixel_id).find(Boolean)
  if (pixelId) {
    try {
      const end = Math.floor(Date.now() / 1000)
      const j = await metaGet<Row>(`${pixelId}/stats`, { aggregation: "event", start_time: String(end - 7 * 86400), end_time: String(end) })
      const last7: Record<string, number> = {}
      for (const g of j.data ?? []) for (const e of g.data ?? [g]) { const n = String(e.value ?? e.event ?? ""); if (n) last7[n] = (last7[n] ?? 0) + (Number(e.count) || 0) }
      pixel = { pixelId: String(pixelId), last7 }
      sources.push({ id: "pixel", label: "Sự kiện pixel 7 ngày", status: "ok", rows: Object.keys(last7).length })
    } catch (e) {
      sources.push({ id: "pixel", label: "Sự kiện pixel 7 ngày", status: "error", rows: 0, note: e instanceof Error ? e.message : String(e) })
    }
  }

  return { kind: "meta", company, range, collectedAt: new Date().toISOString(), campaign, adsets, placements, odoo, peers, pixel, sources }
}
