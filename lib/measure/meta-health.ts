// ============================================================
// Sức khoẻ đo lường — Facebook (Đợt 4), CHỈ ĐỌC
// ============================================================
// Vì sao có màn này: Đợt 3 đo được (26–27/09) các nhóm quảng cáo MBI tối ưu
// theo sự kiện tự đặt "add_payment_info" mà Meta chỉ đếm 1–5 lần, Mua hàng
// ghi doanh thu ₫0, 1.884 click chỉ ra 27 lượt xem trang đích, quảng cáo
// không gắn utm. Tối ưu trên số liệu như vậy là tối ưu trên số sai — nên phải
// kiểm đo lường TRƯỚC khi đọc chi phí/đơn của bất kỳ chiến dịch nào.
//
// Lượt gọi Meta (~60/giờ ở bậc development): 6–8 lượt một lần kéo, đệm 30
// phút theo (công ty, kỳ); "Kéo lại" bỏ đệm.

import { enrichPostAds } from "@/lib/meta/page-posts"
import { detectCompany } from "@/lib/company-detect"
import { readGroup } from "@/lib/odoo-client"
import { accountCampaignInsights, adLinkKind, LANDING_TYPES, optEventOf, pickAction, PURCHASE_TYPES } from "@/lib/case/meta-evidence"
import { adAccountId, metaGet, metaGetAll } from "@/lib/case/meta-graph"
import { productGroupOf, PRODUCT_LABEL, type ProductGroup } from "@/lib/case/product"
import { addDays, vnDate, rangeDays } from "@/lib/case/dates"
import { EVENTS_PER_WEEK_TO_LEARN, MIN_CLICKS_FOR_LANDING_RATE, MIN_LANDING_RATE } from "@/lib/case/causes-meta"
import type { Company, EvidenceSource } from "@/lib/case/types"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { checkFacebookLink, effectiveLink, linksOfCompany, observedUtm, readStandardLinks, type LinkCheck } from "./utm-links"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const HEALTH_DAYS = 28

/** Khoảng ngày giờ VN → mốc epoch cho /stats của pixel (không vượt quá bây giờ). */
export function epochRange(r: { from: string; to: string }, nowMs = Date.now()): { start: number; end: number } {
  const start = Math.floor(Date.parse(`${r.from}T00:00:00+07:00`) / 1000)
  const end = Math.floor(Math.min(nowMs, Date.parse(`${addDays(r.to, 1)}T00:00:00+07:00`)) / 1000)
  return { start, end }
}

export interface PixelEventSeries {
  /** Tên Meta trả ở /stats — chuẩn ("Purchase") hoặc tự đặt ("add_payment_info"). */
  name: string
  total: number
  /** HEALTH_DAYS giá trị, cũ → mới, theo ngày giờ VN. */
  perDay: number[]
}

export interface PixelHealth {
  pixelId: string
  /** false = /stats hỏng → KHÔNG có số (khác với 0). */
  known: boolean
  error: string | null
  events: PixelEventSeries[]
  /** Cùng một hành động bắn dưới 2+ tên (vd "purchase" tự đặt + "Purchase" chuẩn — đo 27/09: 337 vs 69). */
  variants: { key: string; names: { name: string; total: number }[] }[]
}

export interface OptEventHealth {
  /** Tên sự kiện trên pixel (tự đặt: custom_event_str; chuẩn: tên Pixel). */
  pixelEventName: string | null
  label: string
  custom: boolean
  isPurchase: boolean
  adsets: { id: string; name: string; campaignId: string; campaignName: string; learningStatus: string | null; learningConversions: number | null }[]
  /** Lượt bắn/tuần đọc từ pixel; null = không đọc được pixel hoặc không dò ra tên. */
  perWeek: number | null
  status: "ok" | "low" | "dead" | "unknown"
  /** Tổng số lượt Meta tính cho các nhóm (learning_stage_info.conversions) — lượt đến TỪ quảng cáo. */
  adsAttributed: number
  pixelId: string | null
  /** Mọi nhóm đều học thất bại: pixel có thể bắn đủ trên site mà quảng cáo mang về quá ít. */
  allFail: boolean
  /** Trung bình mỗi nhóm (chỉ nhóm Meta có trả số) được tính < 50 lượt từ quảng cáo — kể cả khi pixel bắn
   *  đủ trên site. Đo 27/09 MBI: add_payment_info 124/tuần trên pixel mà nhóm chỉ được tính 1–6. */
  adsLow: boolean
}

export interface ProductHealth {
  group: ProductGroup
  label: string
  optEvents: OptEventHealth[]
}

export interface LandingRow { campaignId: string; name: string; group: ProductGroup; cost: number; linkClicks: number; landingViews: number; rate: number | null; purchases: number; flagged: boolean }
export interface NoValueRow { campaignId: string; name: string; purchases: number; value: number; cost: number }
export interface AdLinkRow { adId: string; adName: string; campaignId: string; campaignName: string; cost: number; link: string | null; check: LinkCheck }

export interface MetaHealth {
  company: Company
  range: { from: string; to: string }
  collectedAt: string
  pixels: PixelHealth[]
  products: ProductHealth[]
  noValue: NoValueRow[]
  landing: LandingRow[]
  /** checked = quảng cáo có link trang đích đọc được; onPlatform = link về Facebook (sự kiện/trang);
   *  postUnreadable = quảng cáo bài viết chưa đọc được link (Trang chưa có token / token hỏng — Đợt 8). */
  links: { activeAds: number; checked: number; bad: AdLinkRow[]; onPlatform: number; postUnreadable: number; noLink: number
    /** Đợt 8: quảng cáo bài viết đọc được link bằng token Trang; Trang chưa có token; Trang có token hỏng. */
    postRead: number; postNoToken: { pageId: string; ads: number }[]; postTokenErrors: { pageId: string; name: string | null }[]
    /** Đợt 9 · 3 — mọi link đích đọc được (kèm chi phí quảng cáo) để gợi ý bảng link chuẩn. */
    observedLinks: { url: string; cost: number; campaignName: string }[]
    /** false = công ty chưa có bảng link chuẩn → KHÔNG chấm, chỉ liệt kê `observed`. */
    tableConfigured: boolean; observed: ReturnType<typeof observedUtm> }
  odoo: { checked: boolean; note: string; totalOrders: number; taggedOrders: number; byStandardTag: { label: string; utmCampaign: string; orders: number; revenue: number }[] }
  sources: EvidenceSource[]
}

/** Tên Pixel của sự kiện chuẩn theo enum custom_event_type (khớp tên ở /stats). */
const PIXEL_NAME: Record<string, string> = {
  PURCHASE: "Purchase", ADD_PAYMENT_INFO: "AddPaymentInfo", INITIATED_CHECKOUT: "InitiateCheckout", ADD_TO_CART: "AddToCart",
  COMPLETE_REGISTRATION: "CompleteRegistration", LEAD: "Lead", CONTENT_VIEW: "ViewContent", SEARCH: "Search", CONTACT: "Contact",
  SUBSCRIBE: "Subscribe", START_TRIAL: "StartTrial", SUBMIT_APPLICATION: "SubmitApplication", SCHEDULE: "Schedule",
}

/**
 * /{pixel}/stats?aggregation=event trả theo mốc thời gian (thường theo giờ):
 * data[] = { start_time, data: [{ value, count }] }. Gom về theo NGÀY giờ VN.
 * Bản Graph cũ trả thẳng data[] không có mốc → không chia ngày được, chỉ còn tổng.
 */
export function pixelDailySeries(json: unknown, to: string, days = HEALTH_DAYS): PixelEventSeries[] {
  const root = (json as { data?: unknown })?.data
  const from = addDays(to, -(days - 1))
  const idx = (ymd: string) => Math.round((Date.parse(ymd) - Date.parse(from)) / 86_400_000)
  const out = new Map<string, PixelEventSeries>()
  const add = (name: string, n: number, day: string | null) => {
    if (!name || !Number.isFinite(n)) return
    const s = out.get(name) ?? { name, total: 0, perDay: Array(days).fill(0) }
    s.total += n
    if (day) { const i = idx(day); if (i >= 0 && i < days) s.perDay[i] += n }
    out.set(name, s)
  }
  if (!Array.isArray(root)) return []
  for (const g of root as Row[]) {
    const day = g.start_time ? vnDate(new Date(g.start_time)) : null
    if (Array.isArray(g.data)) for (const e of g.data) add(String(e.value ?? e.event ?? "").trim(), Number(e.count ?? 0), day)
    else add(String(g.value ?? g.event ?? "").trim(), Number(g.count ?? 0), null)
  }
  return [...out.values()].sort((a, b) => b.total - a.total)
}

/** Trạng thái sự kiện tối ưu theo số bắn/tuần trên pixel. */
/** Nhóm các tên sự kiện chỉ khác hoa/thường, "_" hoặc tiền tố "initiate"/"initiated". */
export function eventVariants(events: PixelEventSeries[]): PixelHealth["variants"] {
  const norm = (n: string) => n.toLowerCase().replace(/[_\s-]/g, "").replace(/^initiated/, "initiate")
  const g = new Map<string, { name: string; total: number }[]>()
  for (const e of events) g.set(norm(e.name), [...(g.get(norm(e.name)) ?? []), { name: e.name, total: e.total }])
  return [...g.entries()].filter(([, v]) => v.length > 1).map(([key, names]) => ({ key, names: names.sort((a, b) => b.total - a.total) }))
}

export function optEventStatus(perWeek: number | null): OptEventHealth["status"] {
  if (perWeek === null) return "unknown"
  if (perWeek < 1) return "dead"
  if (perWeek < EVENTS_PER_WEEK_TO_LEARN) return "low"
  return "ok"
}

export function buildProducts(adsets: Row[], pixels: PixelHealth[], company: Company, days = HEALTH_DAYS): ProductHealth[] {
  const weeks = days / 7
  // Số theo ĐÚNG pixel của từng nhóm (MBC có 2 pixel — đo 27/09), không cộng gộp các pixel.
  const events = new Map<string, number>()
  const knownPixels = new Set(pixels.filter((p) => p.known).map((p) => p.pixelId))
  for (const p of pixels) for (const e of p.events) events.set(`${p.pixelId}|${e.name}`, e.total)
  const byGroup = new Map<ProductGroup, Map<string, OptEventHealth>>()
  for (const a of adsets) {
    const campaignName = String(a.campaign?.name ?? "")
    if (detectCompany(campaignName) !== company) continue
    const group = productGroupOf(campaignName)
    const ev = optEventOf(a.promoted_object, String(a.optimization_goal ?? ""))
    const pixelEventName = ev.type === "OTHER" ? ev.customName : PIXEL_NAME[ev.type] ?? null
    const pixelId = String(a.promoted_object?.pixel_id ?? "")
    const key = `${pixelId}|${ev.type}|${pixelEventName ?? ev.label}`
    const g = byGroup.get(group) ?? new Map<string, OptEventHealth>()
    const cur = g.get(key) ?? {
      pixelEventName, label: ev.label, custom: ev.type === "OTHER", isPurchase: ev.isPurchase, adsets: [],
      perWeek: knownPixels.has(pixelId) && pixelEventName ? Math.round(((events.get(`${pixelId}|${pixelEventName}`) ?? 0) / weeks) * 10) / 10 : null, status: "unknown" as const,
      pixelId: pixelId || null,
      adsAttributed: 0, allFail: false, adsLow: false,
    }
    cur.adsets.push({
      id: String(a.id), name: String(a.name ?? ""), campaignId: String(a.campaign?.id ?? ""), campaignName,
      learningStatus: a.learning_stage_info?.status ?? null, learningConversions: a.learning_stage_info?.conversions ?? null,
    })
    cur.status = optEventStatus(cur.perWeek)
    cur.adsAttributed += Number(a.learning_stage_info?.conversions) || 0
    cur.allFail = cur.adsets.every((x) => x.learningStatus === "FAIL")
    const known = cur.adsets.filter((x) => x.learningConversions !== null && x.learningConversions !== undefined)
    cur.adsLow = known.length > 0 && known.reduce((s, x) => s + Number(x.learningConversions), 0) / known.length < EVENTS_PER_WEEK_TO_LEARN
    g.set(key, cur)
    byGroup.set(group, g)
  }
  return [...byGroup.entries()].map(([group, m]) => ({ group, label: PRODUCT_LABEL[group], optEvents: [...m.values()] }))
    .sort((a, b) => a.label.localeCompare(b.label, "vi"))
}

function linkOfAd(ad: Row): string | null {
  const c = ad.creative ?? {}
  const s = c.object_story_spec ?? {}
  const link = s.link_data?.link ?? s.video_data?.call_to_action?.value?.link ?? c.asset_feed_spec?.link_urls?.[0]?.website_url ?? c.__post?.link ?? null
  return link ? effectiveLink(String(link), c.url_tags ?? null) : null
}

const memo = new Map<string, { at: number; value: MetaHealth }>()
const MEMO_MS = 30 * 60_000

/** Khoảng mặc định (không truyền range) = HEALTH_DAYS ngày tới hôm nay — việc canh tự động hằng đêm dùng cái này. */
export async function metaHealth(company: Company, opts: { force?: boolean; now?: Date; range?: { from: string; to: string } } = {}, t: TFunction = makeT("vi")): Promise<MetaHealth> {
  const to = vnDate(opts.now)
  const range = opts.range ?? { from: addDays(to, -(HEALTH_DAYS - 1)), to }
  const days = rangeDays(range)
  // Văn bản (nhãn nguồn, ghi chú) sinh theo ngôn ngữ → khoá nhớ có ngôn ngữ, bản EN không làm hỏng bản VI.
  const key = `${t("libmeta.localeTag")}|${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < MEMO_MS) return hit.value
  const sources: EvidenceSource[] = []
  const act = `act_${adAccountId()}`
  const active = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])

  const adsets = (await metaGetAll<Row>(`${act}/adsets`, {
    filtering: active, limit: "200",
    fields: "id,name,optimization_goal,promoted_object,learning_stage_info,campaign{id,name}",
  })).filter((a) => detectCompany(String(a.campaign?.name ?? "")) === company)
  sources.push({ id: "adsets", label: t("libmeta.mh.srcAdsets"), status: "ok", rows: adsets.length })

  // Pixel THẬT SỰ đang dùng (promoted_object), không phải pixel khai trong env.
  const pixelIds = [...new Set(adsets.map((a) => a.promoted_object?.pixel_id).filter(Boolean).map(String))]
  const pixels: PixelHealth[] = []
  for (const pixelId of pixelIds) {
    const { start, end } = epochRange(range)
    try {
      const j = await metaGet<Row>(`${pixelId}/stats`, { aggregation: "event", start_time: String(start), end_time: String(end) })
      const events = pixelDailySeries(j, range.to, days)
      pixels.push({ pixelId, known: true, error: null, events, variants: eventVariants(events) })
    } catch (e) {
      pixels.push({ pixelId, known: false, error: e instanceof Error ? e.message : String(e), events: [], variants: [] })
    }
  }
  sources.push({ id: "pixel", label: t("libmeta.mh.srcPixel"), status: pixels.every((p) => p.known) ? "ok" : pixels.some((p) => p.known) ? "partial" : "error", rows: pixels.length, note: pixels.find((p) => p.error)?.error ?? undefined })

  const ins = (await accountCampaignInsights(range)).filter((r) => detectCompany(String(r.campaign_name ?? "")) === company && Number(r.spend) > 0)
  const noValue: NoValueRow[] = []
  const landing: LandingRow[] = []
  for (const r of ins) {
    const name = String(r.campaign_name), cost = Number(r.spend) || 0
    const purchases = pickAction(r.actions, PURCHASE_TYPES), value = pickAction(r.action_values, PURCHASE_TYPES)
    if (purchases > 0 && value <= 0) noValue.push({ campaignId: String(r.campaign_id), name, purchases, value, cost })
    const linkClicks = pickAction(r.actions, ["link_click"]), landingViews = pickAction(r.actions, LANDING_TYPES)
    const rate = linkClicks > 0 ? landingViews / linkClicks : null
    landing.push({ campaignId: String(r.campaign_id), name, group: productGroupOf(name), cost, linkClicks, landingViews, rate, purchases,
      flagged: linkClicks >= MIN_CLICKS_FOR_LANDING_RATE && rate !== null && rate < MIN_LANDING_RATE })
  }
  landing.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.cost - a.cost)
  sources.push({ id: "insights", label: t("libmeta.mh.srcInsights"), status: "ok", rows: ins.length })

  // Liên kết quảng cáo đang chạy + chi phí từng quảng cáo.
  const table = linksOfCompany(readStandardLinks().links, company)
  const campaignIds = new Set(adsets.map((a) => String(a.campaign?.id ?? "")))
  const ads = (await metaGetAll<Row>(`${act}/ads`, {
    filtering: active, limit: "200",
    fields: "id,name,campaign_id,campaign{name},creative{url_tags,effective_object_story_id,object_story_spec{link_data{link},video_data{call_to_action{value{link}}}},asset_feed_spec{link_urls}}",
  })).filter((a) => campaignIds.has(String(a.campaign_id)))
  const adSpend = new Map((await metaGetAll<Row>(`${act}/insights`, {
    level: "ad", time_range: JSON.stringify({ since: range.from, until: range.to }), fields: "ad_id,spend", limit: "500",
  })).map((r) => [String(r.ad_id), Number(r.spend) || 0]))
  const postStats = await enrichPostAds(ads).catch((e) => { console.warn("[meta-health] đọc bài viết lỗi:", e); return null })
  let noLink = 0, onPlatform = 0, postUnreadable = 0, checked = 0
  const observedLinks: { url: string; cost: number; campaignName: string }[] = []
  const bad: AdLinkRow[] = []
  const readableLinks: string[] = []
  for (const ad of ads) {
    const kind = adLinkKind(ad)
    if (kind === "on_platform") { onPlatform++; continue }
    if (kind === "post_unreadable") { postUnreadable++; continue }
    const link = linkOfAd(ad)
    if (kind === "none" || !link) { noLink++; continue }
    checked++
    readableLinks.push(link)
    observedLinks.push({ url: link, cost: adSpend.get(String(ad.id)) ?? 0, campaignName: String(ad.campaign?.name ?? "") })
    if (!table.length) continue
    const check = checkFacebookLink(link, table)
    if (!check.ok) bad.push({ adId: String(ad.id), adName: String(ad.name ?? ""), campaignId: String(ad.campaign_id), campaignName: String(ad.campaign?.name ?? ""), cost: adSpend.get(String(ad.id)) ?? 0, link, check })
  }
  bad.sort((a, b) => b.cost - a.cost)
  const postNote = [
    postStats?.read ? t("libmeta.mh.notePostRead", { n: postStats.read }) : "",
    postStats?.noToken.length ? t("libmeta.mh.noteNoToken", { n: postStats.noToken.reduce((s, x) => s + x.ads, 0), pages: postStats.noToken.map((x) => x.pageId).join(", ") }) : "",
    postStats?.tokenErrors.length ? t("libmeta.mh.noteTokenErr", { pages: postStats.tokenErrors.map((x) => x.name ?? x.pageId).join(", ") }) : "",
  ].filter(Boolean).join(" · ")
  sources.push({ id: "ads", label: t("libmeta.mh.srcAds"), status: postUnreadable ? "partial" : "ok", rows: ads.length, note: postNote || undefined })

  const odoo = await odooCoverage(range, table, t)
  sources.push({ id: "odoo", label: t("libmeta.mh.srcOdoo"), status: odoo.checked ? "ok" : "error", rows: odoo.totalOrders, note: odoo.checked ? undefined : odoo.note })

  const value: MetaHealth = {
    company, range, collectedAt: new Date().toISOString(), pixels, products: buildProducts(adsets, pixels, company, days),
    noValue, landing, links: { activeAds: ads.length, checked, bad, onPlatform, postUnreadable, noLink,
      postRead: postStats?.read ?? 0, postNoToken: postStats?.noToken ?? [], postTokenErrors: (postStats?.tokenErrors ?? []).map((e) => ({ pageId: e.pageId, name: e.name })), observedLinks, tableConfigured: table.length > 0, observed: observedUtm(readableLinks) }, odoo, sources,
  }
  memo.set(key, { at: Date.now(), value })
  return value
}

/**
 * Độ phủ thẻ chiến dịch trong Odoo. `campaign_id` của sale.order là utm.campaign
 * — tên của nó chính là giá trị utm_campaign. Không lọc theo công ty: Odoo không
 * có trường nào gắn đơn với công ty quảng cáo một cách chắc chắn → nói "toàn hệ thống".
 */
async function odooCoverage(range: { from: string; to: string }, table: { label: string; url: string }[], t: TFunction): Promise<MetaHealth["odoo"]> {
  try {
    // Có cả ngày KẾT THÚC — khoảng trong quá khứ không cộng đơn tới hôm nay (sửa 28/09).
    const base = [["date_order", ">=", `${range.from} 00:00:00`], ["date_order", "<", `${addDays(range.to, 1)} 00:00:00`], ["state", "in", ["sale", "done"]]]
    const all = (await readGroup("sale.order", base, ["amount_total:sum"], ["state"])) as Row[]
    const tagged = (await readGroup("sale.order", [...base, ["campaign_id", "!=", false]], ["amount_total:sum"], ["campaign_id"])) as Row[]
    const totalOrders = all.reduce((s, r) => s + Number(r.__count ?? r.state_count ?? 0), 0)
    const taggedOrders = tagged.reduce((s, r) => s + Number(r.__count ?? r.campaign_id_count ?? 0), 0)
    const byName = new Map(tagged.map((r) => [Array.isArray(r.campaign_id) ? String(r.campaign_id[1]) : String(r.campaign_id), r]))
    const byStandardTag = table.map((l) => {
      const utm = new URL(l.url).searchParams.get("utm_campaign") ?? ""
      const r = byName.get(utm)
      return { label: l.label, utmCampaign: utm, orders: Number(r?.__count ?? r?.campaign_id_count ?? 0), revenue: Number(r?.amount_total ?? 0) }
    })
    return {
      checked: true, totalOrders, taggedOrders, byStandardTag,
      // Đo 27/09: source_id của đơn là nguồn KHÁCH ("Đơn hàng MBI online"), không phải utm_source;
      // Pmax Google cũng dùng hoa-don-dien-tu-sitelink… → số theo thẻ gồm cả đơn từ Google.
      note: t("libmeta.mh.odooNote", { from: range.from, to: range.to, tagged: taggedOrders, total: totalOrders }),
    }
  } catch (e) {
    return { checked: false, totalOrders: 0, taggedOrders: 0, byStandardTag: [], note: t("libmeta.mh.odooErr", { msg: e instanceof Error ? e.message : String(e) }) }
  }
}
