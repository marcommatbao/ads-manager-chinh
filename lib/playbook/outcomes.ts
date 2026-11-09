// ============================================================
// Đợt 9 · 4 (7c) — tự CHẤM kinh nghiệm đã dùng sau 14 và 28 ngày
// ============================================================
// Mỗi lần tạo chiến dịch có dùng kinh nghiệm, 7b ghi data/playbook/usage.json. Ở mốc 14 và 28 ngày kể từ
// ngày tạo, job này so chi phí/kết quả của chiến dịch đó với CÁC CHIẾN DỊCH CÙNG SẢN PHẨM, CÙNG KỲ (không
// so với trung vị cũ trong Sổ — cùng kỳ thì mùa vụ/giá thầu như nhau). Chuẩn chấm giống engine: tốt khi
// ≤ 0,8 × trung vị, kém khi ≥ 1,25 × (hoặc 0 kết quả mà chi ≥ 2 × trung vị).
//   • dòng đã dùng: tốt → xác nhận, kém → bác bỏ;
//   • dòng "Nên tránh" mà người dùng làm trái: kém → xác nhận (đúng là nên tránh), tốt → bác bỏ.
// Bị bác ≥ 2 chiến dịch và bác nhiều hơn xác nhận → dòng "tự dùng" hạ xuống "gợi ý" (KHÔNG tự nâng bậc —
// nâng là việc của người duyệt). Kết quả lưu RIÊNG (outcomes.json) để lượt bóc Sổ hằng tuần không xoá mất.
// Doanh thu Odoo là cột TUỲ CHỌN (user chốt 28/09): có thì thêm để đối chiếu, không đổi cách chấm.

import fs from "fs"
import path from "path"
import { enums } from "google-ads-api"
import { addDays, vnDate } from "@/lib/case/dates"
import { accountCampaignInsights, LANDING_TYPES, pickAction, PURCHASE_TYPES, utmTagsOf } from "@/lib/case/meta-evidence"
import { metaGet } from "@/lib/case/meta-graph"
import { PRODUCT_LABEL, productGroupOf } from "@/lib/case/product"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { enrichPostAds } from "@/lib/meta/page-posts"
import { fetchCampaignRevenue, extractUtmCampaign } from "@/lib/odoo-campaign-revenue"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Metric } from "./engine"
import type { PlaybookEntry, PlaybookFile } from "./store"
import { productLabelOf } from "./products"
import { readUsage, type PlaybookUsage } from "./usage"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const FILE = path.join(process.cwd(), "data", "playbook", "outcomes.json")
export const CHECKPOINTS = [14, 28] as const
const INITIATE_TYPES = ["initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]
const MIN_PEERS = 3

export type OutcomeVerdict = "better" | "worse" | "neutral" | "insufficient"
export interface OutcomeRecord {
  usageKey: string
  checkpoint: 14 | 28
  evaluatedAt: string
  company: string
  platform: "facebook" | "google"
  campaignId: string
  campaignName: string
  product: string
  window: { from: string; to: string }
  metric: Metric | null
  cost: number
  results: number
  cpr: number | null
  peerMedian: number | null
  peers: number
  verdict: OutcomeVerdict
  why: string
  entryIds: string[]
  overriddenAvoidIds: string[]
  odoo?: { orders: number; revenue: number; tags: string[] } | { error: string }
}

// ── Hàm thuần ───────────────────────────────────────────────
export const usageKeyOf = (u: Pick<PlaybookUsage, "at" | "campaignId">) => `${u.at}|${u.campaignId}`
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`

/** Chấm một chiến dịch so với các chiến dịch cùng sản phẩm cùng kỳ. peers = chi phí/kết quả của từng chiến dịch khác. */
export function judge(me: { cost: number; results: number }, peers: { cost: number; results: number }[]): { verdict: OutcomeVerdict; cpr: number | null; peerMedian: number | null; why: string } {
  const withRes = peers.filter((p) => p.results > 0 && p.cost > 0)
  const cpr = me.results > 0 ? me.cost / me.results : null
  if (withRes.length < MIN_PEERS) return { verdict: "insufficient", cpr, peerMedian: null, why: `Chỉ ${withRes.length} chiến dịch cùng sản phẩm có kết quả trong kỳ (cần ≥ ${MIN_PEERS}) — chưa so được` }
  const M = median(withRes.map((p) => p.cost / p.results))
  if (me.results === 0) {
    return me.cost >= 2 * M
      ? { verdict: "worse", cpr, peerMedian: M, why: `Chi ${vnd(me.cost)} mà 0 kết quả (≥ 2 × trung vị ${vnd(M)})` }
      : { verdict: "insufficient", cpr, peerMedian: M, why: `Chi ${vnd(me.cost)}, chưa có kết quả — chưa đủ để kết luận` }
  }
  const r = cpr! / M
  const why = `${vnd(cpr!)}/kết quả so với trung vị ${vnd(M)} của ${withRes.length} chiến dịch cùng sản phẩm (×${Math.round(r * 100) / 100})`
  return { verdict: r <= 0.8 ? "better" : r >= 1.25 ? "worse" : "neutral", cpr, peerMedian: M, why }
}

export interface EntryOutcome { confirmed: number; refuted: number; neutral: number; campaigns: number; lastAt: string | null; demoted: boolean }
/** Gộp kết quả (mốc 28 ngày thắng mốc 14 cho cùng lượt dùng) → tóm tắt theo mã dòng. */
export function summarizeOutcomes(records: OutcomeRecord[]): Map<string, EntryOutcome> {
  const latest = new Map<string, OutcomeRecord>()
  for (const r of records) { const cur = latest.get(r.usageKey); if (!cur || r.checkpoint > cur.checkpoint) latest.set(r.usageKey, r) }
  const out = new Map<string, EntryOutcome & { camps: Set<string>; refCamps: Set<string> }>()
  const bump = (id: string, kind: "confirmed" | "refuted" | "neutral", r: OutcomeRecord) => {
    const o = out.get(id) ?? { confirmed: 0, refuted: 0, neutral: 0, campaigns: 0, lastAt: null, demoted: false, camps: new Set<string>(), refCamps: new Set<string>() }
    o[kind]++; o.camps.add(r.campaignId); if (kind === "refuted") o.refCamps.add(r.campaignId)
    if (!o.lastAt || r.evaluatedAt > o.lastAt) o.lastAt = r.evaluatedAt
    out.set(id, o)
  }
  for (const r of latest.values()) {
    if (r.verdict === "insufficient") continue
    for (const id of r.entryIds) bump(id, r.verdict === "better" ? "confirmed" : r.verdict === "worse" ? "refuted" : "neutral", r)
    for (const id of r.overriddenAvoidIds) bump(id, r.verdict === "worse" ? "confirmed" : r.verdict === "better" ? "refuted" : "neutral", r)
  }
  return new Map([...out].map(([id, o]) => [id, { confirmed: o.confirmed, refuted: o.refuted, neutral: o.neutral, campaigns: o.camps.size, lastAt: o.lastAt, demoted: o.refCamps.size >= 2 && o.refuted > o.confirmed }]))
}

/** Gắn tóm tắt kết quả vào Sổ để HIỂN THỊ + gợi ý (không ghi vào tệp Sổ). Bị bác → "tự dùng" hạ xuống "gợi ý". */
export function withOutcomes(p: PlaybookFile, records: OutcomeRecord[] = readOutcomes()): PlaybookFile {
  const sum = summarizeOutcomes(records)
  return { ...p, entries: p.entries.map((e) => {
    const o = sum.get(e.id)
    if (!o) return e
    const demote = o.demoted && e.status === "auto"
    return { ...e, outcome: o, ...(demote ? { status: "suggested" as const, demoted: true } : {}) } as PlaybookEntry
  }) }
}

// ── Lưu trữ ─────────────────────────────────────────────────
export function readOutcomes(): OutcomeRecord[] {
  try { return fs.existsSync(FILE) ? ((JSON.parse(fs.readFileSync(FILE, "utf-8")) as { records?: OutcomeRecord[] }).records ?? []) : [] } catch { return [] }
}
function writeOutcomes(records: OutcomeRecord[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify({ records: records.slice(-2000) }, null, 1))
}

// ── Đọc số ──────────────────────────────────────────────────
const sameProduct = (name: string, label: string) => PRODUCT_LABEL[productGroupOf(name)] === label

async function metaNumbers(u: PlaybookUsage, window: { from: string; to: string }, label: string) {
  const rows = (await accountCampaignInsights(window)).filter((r) => Number(r.spend) > 0 && sameProduct(String(r.campaign_name ?? ""), label))
  const pick = (r: Row, types: string[]) => pickAction(r.actions, types)
  const me = rows.find((r) => String(r.campaign_id) === u.campaignId)
  const others = rows.filter((r) => String(r.campaign_id) !== u.campaignId)
  // Chỉ số sâu nhất mà các chiến dịch cùng sản phẩm có đủ số: mua → bắt đầu thanh toán → xem trang đích.
  for (const [metric, types] of [["purchase", PURCHASE_TYPES], ["initiate_checkout", INITIATE_TYPES], ["landing_view", LANDING_TYPES]] as [Metric, string[]][]) {
    const peers = others.map((r) => ({ cost: Number(r.spend) || 0, results: pick(r, types) }))
    if (peers.filter((p) => p.results > 0).length >= MIN_PEERS || metric === "landing_view") {
      return { metric, me: { cost: Number(me?.spend) || 0, results: me ? pick(me, types) : 0 }, peers, name: String(me?.campaign_name ?? u.campaignName) }
    }
  }
  throw new Error("unreachable")
}

async function googleNumbers(u: PlaybookUsage, window: { from: string; to: string }, label: string) {
  const c = getGoogleAdsCustomer(u.company as string)
  const between = `segments.date BETWEEN '${window.from}' AND '${window.to}'`
  // Google không cho lấy chi phí cùng segments.conversion_action_category → 2 truy vấn rồi nối (đo 27/09).
  const cost = (await c.query(`SELECT campaign.id, campaign.name, metrics.cost_micros FROM campaign WHERE ${between} AND metrics.cost_micros > 0`)) as Row[]
  const conv = (await c.query(`SELECT campaign.id, segments.conversion_action_category, metrics.conversions FROM campaign WHERE ${between} AND segments.conversion_action_category = 'PURCHASE'`)) as Row[]
  const purchases = new Map<string, number>()
  for (const r of conv) if (String(r.segments?.conversion_action_category) === "PURCHASE" || r.segments?.conversion_action_category === enums.ConversionActionCategory.PURCHASE) purchases.set(String(r.campaign.id), (purchases.get(String(r.campaign.id)) ?? 0) + (Number(r.metrics.conversions) || 0))
  const rows = cost.map((r) => ({ id: String(r.campaign.id), name: String(r.campaign.name), cost: (Number(r.metrics.cost_micros) || 0) / 1e6, results: purchases.get(String(r.campaign.id)) ?? 0 }))
    .filter((r) => sameProduct(r.name, label) || r.id === u.campaignId)
  const me = rows.find((r) => r.id === u.campaignId)
  return { metric: "purchase" as Metric, me: { cost: me?.cost ?? 0, results: me?.results ?? 0 }, peers: rows.filter((r) => r.id !== u.campaignId && sameProduct(r.name, label)), name: me?.name ?? u.campaignName }
}

/** Doanh thu Odoo theo utm_campaign của chiến dịch trong đúng kỳ — TUỲ CHỌN, lỗi thì ghi lỗi. */
async function odooColumn(u: PlaybookUsage, window: { from: string; to: string }): Promise<OutcomeRecord["odoo"]> {
  if (!process.env.ODOO_URL) return undefined
  try {
    let tags: string[] = []
    if (u.platform === "facebook") {
      const c = await metaGet<Row>(u.campaignId, { fields: "ads.limit(100){creative{url_tags,effective_object_story_id,object_story_spec{link_data{link},video_data{call_to_action{value{link}}}},asset_feed_spec{link_urls}}}" })
      const ads: Row[] = c.ads?.data ?? []
      await enrichPostAds(ads).catch(() => null)
      tags = utmTagsOf(ads)
    } else {
      const g = getGoogleAdsCustomer(u.company as string)
      const rows = (await g.query(`SELECT ad_group_ad.ad.final_urls, campaign.final_url_suffix FROM ad_group_ad WHERE campaign.id = ${Number(u.campaignId)}`)) as Row[]
      const set = new Set<string>()
      for (const r of rows) for (const url of r.ad_group_ad?.ad?.final_urls ?? []) { const t = extractUtmCampaign(`${url}${r.campaign?.final_url_suffix ? `${String(url).includes("?") ? "&" : "?"}${r.campaign.final_url_suffix}` : ""}`); if (t) set.add(t) }
      tags = [...set]
    }
    if (!tags.length) return { orders: 0, revenue: 0, tags: [] }
    const r = await fetchCampaignRevenue(tags, new Map(), 0, window)
    return { orders: r.totalOrders, revenue: r.totalRevenueVnd, tags }
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
}

/** Job playbook_outcomes (hằng ngày): chấm các lượt dùng đã đủ 14/28 ngày mà chưa chấm. */
export async function runPlaybookOutcomes(now: Date = new Date()): Promise<{ evaluated: number; skipped: number; errors: string[] }> {
  const today = vnDate(now)
  const records = readOutcomes()
  const done = new Set(records.map((r) => `${r.usageKey}|${r.checkpoint}`))
  let evaluated = 0, skipped = 0
  const errors: string[] = []
  for (const u of readUsage()) {
    if (!u.campaignId || !/^\d+$/.test(u.campaignId)) { skipped++; continue }
    const label = productLabelOf(u.productKey)
    if (!label) { skipped++; continue }
    const start = vnDate(new Date(u.at))
    for (const cp of CHECKPOINTS) {
      const window = { from: start, to: addDays(start, cp - 1) }
      if (window.to >= today || done.has(`${usageKeyOf(u)}|${cp}`)) continue // kỳ chưa trọn / đã chấm
      try {
        const n = u.platform === "facebook" ? await metaNumbers(u, window, label) : await googleNumbers(u, window, label)
        const j = judge(n.me, n.peers)
        records.push({
          usageKey: usageKeyOf(u), checkpoint: cp, evaluatedAt: now.toISOString(), company: u.company, platform: u.platform,
          campaignId: u.campaignId, campaignName: n.name, product: label, window, metric: n.metric,
          cost: Math.round(n.me.cost), results: n.me.results, cpr: j.cpr === null ? null : Math.round(j.cpr), peerMedian: j.peerMedian === null ? null : Math.round(j.peerMedian), peers: n.peers.filter((p) => p.results > 0).length,
          verdict: j.verdict, why: j.why, entryIds: u.entryIds, overriddenAvoidIds: u.overriddenAvoidIds,
          odoo: await odooColumn(u, window),
        })
        done.add(`${usageKeyOf(u)}|${cp}`)
        evaluated++
      } catch (e) {
        errors.push(`${u.campaignName} (${cp} ngày): ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  if (evaluated) writeOutcomes(records)
  return { evaluated, skipped, errors }
}
