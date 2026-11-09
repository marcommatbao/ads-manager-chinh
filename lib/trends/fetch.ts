// Đợt 28 — đọc số cho tab "Diễn biến". Ngân sách lượt gọi (app Meta ~60 lượt/giờ cho cả app):
//   Meta  (mỗi công ty): danh sách chiến dịch (có đệm sẵn) + 1 lượt số theo NGÀY (kỳ này + kỳ trước) + 2 lượt số theo chiến dịch.
//   Google (mỗi công ty): 1 truy vấn chiến dịch × ngày + 1 truy vấn hạng mục đặt giá (tách lead / bán hàng).
// Đệm 30 phút. Meta tính kết quả từ LƯỢT BẤM 7 ngày (bài học 06/10: số Meta gộp người chỉ xem).
import { detectCompany } from "@/lib/company-detect"
import { adAccountId, metaGetAll } from "@/lib/case/meta-graph"
import { pickActionWindow, PURCHASE_TYPES } from "@/lib/case/meta-evidence"
import { META_LEAD_TYPES, googleGoalKind, metaGoalKind, type GoalKind } from "@/lib/case/goal-kind"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleBiddableCategories } from "@/lib/case/service"
import { add, previousRange, ZERO, type CampaignPeriods, type Metrics, type TrendDay } from "./build"
import { setCapped } from "@/lib/cost-guard"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export interface PlatformTrend { platform: "meta" | "google"; days: TrendDay[]; campaigns: CampaignPeriods[]; error: string | null }

const memo = new Map<string, { at: number; v: PlatformTrend }>()
const TTL = 30 * 60_000
const clickN = (acts: unknown, types: string[]) => pickActionWindow(acts as never, types, "7d_click") ?? 0

function metaMetrics(r: Row, kind: GoalKind | "mixed"): Omit<Metrics, "spendSales" | "spendLeads"> {
  return {
    spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.inline_link_clicks) || 0,
    purchases: kind === "leads" ? 0 : clickN(r.actions, PURCHASE_TYPES), purchaseValue: kind === "leads" ? 0 : clickN(r.action_values, PURCHASE_TYPES),
    leads: kind === "sales" ? 0 : clickN(r.actions, META_LEAD_TYPES),
  }
}

export async function metaTrend(company: string, range: { from: string; to: string }, force = false): Promise<PlatformTrend> {
  const key = `meta|${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!force && hit && Date.now() - hit.at < TTL) return hit.v
  const prev = previousRange(range.from, range.to)
  const act = `act_${adAccountId()}/insights`
  const win = JSON.stringify(["7d_click", "1d_view"])
  // Danh sách chiến dịch lấy TỪ SỐ CHI TIÊU của hai kỳ (không từ danh sách chiến dịch: danh sách mặc định của Meta bỏ chiến
  // dịch ĐÃ LƯU TRỮ dù chúng vẫn có chi phí trong kỳ). Lọc công ty theo tên; mục tiêu đọc ngay trong số liệu.
  const [curAll, prevAll] = await Promise.all([range, prev].map((r) => metaGetAll<Row>(act, { level: "campaign", time_range: JSON.stringify({ since: r.from, until: r.to }), action_attribution_windows: win, fields: "campaign_id,campaign_name,objective,spend,impressions,inline_link_clicks,actions,action_values", limit: "500" })))
  const mineOnly = (rows: Row[]) => rows.filter((r) => detectCompany(String(r.campaign_name ?? "")) === company)
  const curC = mineOnly(curAll), prevC = mineOnly(prevAll)
  const kindOf = new Map<string, GoalKind>([...prevC, ...curC].map((r) => [String(r.campaign_id), metaGoalKind(String(r.objective ?? ""))]))
  const ids = [...kindOf.keys()]
  if (!ids.length) { const v: PlatformTrend = { platform: "meta", days: [], campaigns: [], error: null }; setCapped(memo, key, { at: Date.now(), v }); return v }
  const daily = await metaGetAll<Row>(act, { level: "account", time_increment: "1", time_range: JSON.stringify({ since: prev.from, until: range.to }), filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids }]), action_attribution_windows: win, fields: "date_start,spend,impressions,inline_link_clicks,actions,action_values", limit: "500" })
  const withSplit = (m: Omit<Metrics, "spendSales" | "spendLeads">, kind: GoalKind): Metrics => ({ ...m, spendSales: kind === "sales" ? m.spend : 0, spendLeads: kind === "leads" ? m.spend : 0 })
  const byId = new Map<string, CampaignPeriods>()
  for (const [rows, side] of [[curC, "cur"], [prevC, "prev"]] as const) {
    for (const r of rows) {
      const id = String(r.campaign_id), kind = kindOf.get(id) ?? "sales"
      const cp = byId.get(id) ?? { id, name: String(r.campaign_name ?? id), platform: "meta" as const, kind, cur: { ...ZERO }, prev: { ...ZERO } }
      cp[side] = add(cp[side], withSplit(metaMetrics(r, kind), kind))
      byId.set(id, cp)
    }
  }
  const days: TrendDay[] = daily.map((r) => ({ date: String(r.date_start), ...metaMetrics(r, "mixed") })).sort((a, b) => a.date.localeCompare(b.date))
  const v: PlatformTrend = { platform: "meta", days, campaigns: [...byId.values()], error: null }
  setCapped(memo, key, { at: Date.now(), v })
  return v
}

const micros = (v: unknown) => (Number(v) || 0) / 1_000_000

export async function googleTrend(company: string, range: { from: string; to: string }, force = false): Promise<PlatformTrend> {
  const key = `google|${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!force && hit && Date.now() - hit.at < TTL) return hit.v
  const prev = previousRange(range.from, range.to)
  const customer = getGoogleAdsCustomer(company)
  const cats = await googleBiddableCategories(customer).catch(() => new Map<string, string[]>())
  const rows = (await customer.query(`SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type,
      metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE segments.date BETWEEN '${prev.from}' AND '${range.to}' AND metrics.impressions > 0`)) as Row[]
  const dayMap = new Map<string, TrendDay>()
  const byId = new Map<string, CampaignPeriods>()
  for (const r of rows) {
    const id = String(r.campaign?.id), date = String(r.segments?.date)
    const kind = googleGoalKind(cats.get(id))
    const conv = Number(r.metrics?.conversions) || 0
    const m: Metrics = {
      spend: micros(r.metrics?.cost_micros), impressions: Number(r.metrics?.impressions) || 0, clicks: Number(r.metrics?.clicks) || 0,
      purchases: kind === "sales" ? conv : 0, purchaseValue: kind === "sales" ? Number(r.metrics?.conversions_value) || 0 : 0, leads: kind === "leads" ? conv : 0,
      spendSales: 0, spendLeads: 0,
    }
    m.spendSales = kind === "sales" ? m.spend : 0; m.spendLeads = kind === "leads" ? m.spend : 0
    const d = dayMap.get(date) ?? { date, spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, leads: 0 }
    for (const k of ["spend", "impressions", "clicks", "purchases", "purchaseValue", "leads"] as const) d[k] += m[k]
    dayMap.set(date, d)
    const side = date >= range.from ? "cur" : "prev"
    const cp = byId.get(id) ?? { id, name: String(r.campaign?.name ?? id), platform: "google" as const, kind, cur: { ...ZERO }, prev: { ...ZERO } }
    cp[side] = add(cp[side], m)
    byId.set(id, cp)
  }
  const v: PlatformTrend = { platform: "google", days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)), campaigns: [...byId.values()], error: null }
  setCapped(memo, key, { at: Date.now(), v })
  return v
}
