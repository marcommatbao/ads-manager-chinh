// ============================================================
// Sức khoẻ đo lường — Google Ads (Đợt 4), CHỈ ĐỌC
// ============================================================
// Đợt 1–2 chỉ kiểm "chiến dịch có đặt giá theo Mua hàng không" trong từng
// phiên. Màn này kiểm ở cấp TÀI KHOẢN: hành động chuyển đổi có bắn không, giá
// trị thật hay cố định, gclid, utm trong URL đích có nối được Odoo không
// (đo 24/09: 59 giá trị utm_campaign, chỉ 9 khớp Odoo), trang đích chết.

import { enums } from "google-ads-api"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { sweepLandingPages } from "@/lib/google-landing-pages"
import { readGroup } from "@/lib/odoo-client"
import { extractUtmCampaign } from "@/lib/odoo-campaign-revenue"
import { addDays, vnDate, rangeDays } from "@/lib/case/dates"
import type { Company, EvidenceSource } from "@/lib/case/types"
import { HEALTH_DAYS } from "./meta-health"
import { checkAdLink, linksOfCompany, type LinkCheck } from "./utm-rules"
import { readStandardLinks } from "./utm-links"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const en = (e: Record<string | number, string | number>, v: unknown) => (typeof v === "number" ? String(e[v] ?? v) : String(v ?? ""))
const micros = (v: unknown) => (Number(v) || 0) / 1_000_000

export type ConversionFlag = "primary_purchase_silent" | "fixed_default_value" | "purchase_not_primary"

export interface ConversionActionHealth {
  id: string
  name: string
  category: string
  type: string
  primary: boolean
  value: { kind: "real" | "fixed" | "none"; defaultValue: number | null }
  total: number
  last7: number
  perDay: number[]
  flags: ConversionFlag[]
}

export interface CampaignUtmRow {
  campaignId: string
  name: string
  channel: string
  cost: number
  tags: string[]
  /** Đơn Odoo trong kỳ mang một trong các thẻ của chiến dịch (thẻ có thể dùng chung). */
  odooOrders: number
  /** "no_utm" | "unmatched" (có utm, Odoo không thấy đơn) | "matched" */
  status: "no_utm" | "unmatched" | "matched" | "unreadable"
  /** URL đích sai luật Google (google_ads + cpc|site_link) hoặc utm_campaign ngoài bảng chuẩn. Rỗng khi chưa có bảng. */
  linkIssues: { url: string; check: LinkCheck }[]
  /** Đợt 9 · 3 — URL đích (đã nối hậu tố utm) để gợi ý bảng link chuẩn. */
  urls: string[]
}

export interface GoogleHealth {
  company: Company
  range: { from: string; to: string }
  collectedAt: string
  account: { name: string; autoTagging: boolean | null }
  conversions: ConversionActionHealth[]
  utm: { campaigns: CampaignUtmRow[]; distinctTags: number; matchedTags: number; tableConfigured: boolean }
  /** Trang đích chết của quảng cáo đang chạy; spend = chi 30 ngày đang chảy vào trang đó. */
  deadPages: { url: string; spend: number; reason: string }[]
  sources: EvidenceSource[]
}

/** Cờ của một hành động chuyển đổi — hàm thuần. */
export function conversionFlags(a: Omit<ConversionActionHealth, "flags">, anyPrimaryPurchase = true): ConversionFlag[] {
  const flags: ConversionFlag[] = []
  const purchase = a.category === "PURCHASE"
  if (purchase && a.primary && a.last7 === 0) flags.push("primary_purchase_silent")
  if (purchase && a.value.kind === "fixed") flags.push("fixed_default_value")
  // Chỉ gắn khi KHÔNG có hành động Mua hàng nào là chính. Đo 27/09 MBC: "Purchase" chính chạy tốt
  // (372/7 ngày) mà bản nhập GA4 "purchase" là phụ → cờ cũ báo nhầm.
  if (purchase && !a.primary && !anyPrimaryPurchase) flags.push("purchase_not_primary")
  return flags
}

/** utm_campaign trong URL đích + suffix (ad/chiến dịch/tài khoản) — bỏ giá trị còn ValueTrack. */
export function utmTagsFrom(urls: string[], suffixes: string[]): string[] {
  const tags = new Set<string>()
  for (const u of urls) { const t = extractUtmCampaign(u); if (t) tags.add(t) }
  for (const s of suffixes) { if (!s) continue; const t = extractUtmCampaign(`?${s.replace(/^\?/, "")}`); if (t) tags.add(t) }
  return [...tags]
}

const memo = new Map<string, { at: number; value: GoogleHealth }>()
const MEMO_MS = 30 * 60_000

export async function googleHealth(company: Company, opts: { force?: boolean; now?: Date; range?: { from: string; to: string } } = {}): Promise<GoogleHealth> {
  const to = vnDate(opts.now)
  const range = opts.range ?? { from: addDays(to, -(HEALTH_DAYS - 1)), to }
  // Mảng theo ngày dài ĐÚNG bằng khoảng chọn — cố định 28 thì khoảng dài hơn bị cắt mất số.
  const days = rangeDays(range)
  const key = `${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!opts.force && hit && Date.now() - hit.at < MEMO_MS) return hit.value
  const customer = getGoogleAdsCustomer(company)
  const q = async (gaql: string) => (await customer.query(gaql)) as Row[]
  const sources: EvidenceSource[] = []
  const between = `segments.date BETWEEN '${range.from}' AND '${range.to}'`

  const [acc] = await q(`SELECT customer.descriptive_name, customer.auto_tagging_enabled, customer.final_url_suffix FROM customer LIMIT 1`)
  const account = { name: String(acc?.customer?.descriptive_name ?? ""), autoTagging: typeof acc?.customer?.auto_tagging_enabled === "boolean" ? acc.customer.auto_tagging_enabled : null }

  // Hành động chuyển đổi + số theo ngày.
  const actions = await q(`SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.category,
      conversion_action.type, conversion_action.primary_for_goal, conversion_action.value_settings.default_value,
      conversion_action.value_settings.always_use_default_value
    FROM conversion_action WHERE conversion_action.status = 'ENABLED'`)
  const daily = await q(`SELECT segments.date, segments.conversion_action, metrics.all_conversions
    FROM campaign WHERE ${between}`)
  const series = new Map<string, number[]>()
  const idx = (d: string) => Math.round((Date.parse(d) - Date.parse(range.from)) / 86_400_000)
  for (const r of daily) {
    const rn = String(r.segments?.conversion_action ?? "")
    const arr = series.get(rn) ?? Array(days).fill(0)
    const i = idx(String(r.segments?.date ?? ""))
    if (i >= 0 && i < days) arr[i] += Number(r.metrics?.all_conversions) || 0
    series.set(rn, arr)
  }
  const conversions: ConversionActionHealth[] = actions.map((r) => {
    const a = r.conversion_action
    const perDay = (series.get(String(a.resource_name)) ?? Array(days).fill(0)).map((x: number) => Math.round(x * 10) / 10)
    const def = a.value_settings?.default_value
    const always = !!a.value_settings?.always_use_default_value
    const base = {
      id: String(a.id), name: String(a.name), category: en(enums.ConversionActionCategory, a.category), type: en(enums.ConversionActionType, a.type),
      primary: !!a.primary_for_goal,
      value: { kind: always && Number(def) > 0 ? "fixed" as const : Number(def) > 0 || !always ? "real" as const : "none" as const, defaultValue: def !== undefined ? Number(def) : null },
      total: Math.round(perDay.reduce((s: number, x: number) => s + x, 0) * 10) / 10,
      last7: Math.round(perDay.slice(-7).reduce((s: number, x: number) => s + x, 0) * 10) / 10,
      perDay,
    }
    return { ...base, flags: [] as ConversionFlag[] }
  })
  const anyPrimaryPurchase = conversions.some((c) => c.category === "PURCHASE" && c.primary)
  for (const c of conversions) c.flags = conversionFlags(c, anyPrimaryPurchase)
  conversions.sort((a, b) => b.flags.length - a.flags.length || Number(b.category === "PURCHASE") - Number(a.category === "PURCHASE") || b.total - a.total)
  sources.push({ id: "conversions", label: "Hành động chuyển đổi 28 ngày", status: "ok", rows: conversions.length })

  // utm trong URL đích.
  const camps = await q(`SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.final_url_suffix, metrics.cost_micros
    FROM campaign WHERE ${between} AND campaign.status = 'ENABLED' AND metrics.cost_micros > 0`)
  const urls = new Map<string, { urls: string[]; suffixes: string[] }>()
  const push = (id: string, u: string[], s: string[]) => {
    const cur = urls.get(id) ?? { urls: [], suffixes: [] }
    cur.urls.push(...u); cur.suffixes.push(...s)
    urls.set(id, cur)
  }
  for (const r of await q(`SELECT campaign.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.final_url_suffix FROM ad_group_ad
      WHERE campaign.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'`)) {
    push(String(r.campaign.id), (r.ad_group_ad?.ad?.final_urls ?? []).map(String), [String(r.ad_group_ad?.ad?.final_url_suffix ?? "")])
  }
  let pmaxOk = true
  try {
    for (const r of await q(`SELECT campaign.id, asset_group.final_urls FROM asset_group WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'`)) {
      push(String(r.campaign.id), (r.asset_group?.final_urls ?? []).map(String), [])
    }
  } catch { pmaxOk = false }

  let odooByTag = new Map<string, number>()
  let odooNote: string | undefined
  try {
    const rows = (await readGroup("sale.order", [["date_order", ">=", `${range.from} 00:00:00`], ["date_order", "<", `${addDays(range.to, 1)} 00:00:00`], ["state", "in", ["sale", "done"]], ["campaign_id", "!=", false]], ["amount_total:sum"], ["campaign_id"])) as Row[]
    odooByTag = new Map(rows.map((r) => [Array.isArray(r.campaign_id) ? String(r.campaign_id[1]) : String(r.campaign_id), Number(r.__count ?? 0)]))
  } catch (e) { odooNote = `Không đọc được Odoo: ${e instanceof Error ? e.message : String(e)}` }

  const table = linksOfCompany(readStandardLinks().links, company, "google")
  const withSuffix = (u: string, suffix: string) => (suffix ? `${u}${u.includes("?") ? "&" : "?"}${suffix.replace(/^\?/, "")}` : u)
  const campaigns: CampaignUtmRow[] = camps.map((r): CampaignUtmRow => {
    const id = String(r.campaign.id)
    const u = urls.get(id)
    const channel = en(enums.AdvertisingChannelType, r.campaign.advertising_channel_type)
    const tags = utmTagsFrom(u?.urls ?? [], [...(u?.suffixes ?? []), String(r.campaign.final_url_suffix ?? ""), String(acc?.customer?.final_url_suffix ?? "")])
    const odooOrders = tags.reduce((s, t) => s + (odooByTag.get(t) ?? 0), 0)
    const unreadable = !u && channel === "PERFORMANCE_MAX" && !pmaxOk
    const suffix = String(r.campaign.final_url_suffix || acc?.customer?.final_url_suffix || "")
    const linkIssues = !table.length ? [] : [...new Set(u?.urls ?? [])].slice(0, 50)
      .map((url) => ({ url, check: checkAdLink(withSuffix(url, suffix), table, "google") }))
      .filter((x) => !x.check.ok)
    return {
      campaignId: id, name: String(r.campaign.name), channel, cost: micros(r.metrics.cost_micros), tags, odooOrders, linkIssues,
      urls: [...new Set(u?.urls ?? [])].slice(0, 20).map((x) => withSuffix(x, suffix)),
      status: unreadable ? "unreadable" : !tags.length ? "no_utm" : odooNote ? "unreadable" : odooOrders > 0 ? "matched" : "unmatched",
    }
  }).sort((a, b) => b.cost - a.cost)
  const allTags = new Set(campaigns.flatMap((c) => c.tags))
  sources.push({ id: "utm", label: "utm trong URL đích", status: odooNote ? "partial" : "ok", rows: campaigns.length, note: odooNote ?? (pmaxOk ? undefined : "Không đọc được URL của Pmax") })

  // Trang đích chết (bộ quét sẵn có, giới hạn để không nện trang của chính mình).
  let deadPages: GoogleHealth["deadPages"] = []
  try {
    const sw = await sweepLandingPages(q, { maxUrls: 80, concurrency: 4 })
    deadPages = sw.dead.map((d) => ({ url: d.url, spend: d.spendVnd, reason: d.problem ?? (d.status ? `HTTP ${d.status}` : "Không nhận được phản hồi") }))
    sources.push({ id: "landing", label: "Quét trang đích", status: sw.ok ? "ok" : "error", rows: sw.checked, note: sw.ok ? undefined : sw.error })
  } catch (e) {
    sources.push({ id: "landing", label: "Quét trang đích", status: "error", rows: 0, note: e instanceof Error ? e.message : String(e) })
  }

  const value: GoogleHealth = {
    company, range, collectedAt: new Date().toISOString(), account, conversions,
    utm: { campaigns, distinctTags: allTags.size, matchedTags: [...allTags].filter((t) => (odooByTag.get(t) ?? 0) > 0).length, tableConfigured: table.length > 0 },
    deadPages, sources,
  }
  memo.set(key, { at: Date.now(), value })
  return value
}
