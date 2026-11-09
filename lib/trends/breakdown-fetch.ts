// Đợt 28d — đọc số tách theo đối tượng / vị trí. Chỉ chạy khi bấm "Xem tách". Meta: cấp TÀI KHOẢN lọc theo chiến dịch của
// công ty, tách riêng chiến dịch bán hàng / thu lead (≤ 6 lượt gọi, ít dòng); kết quả từ LƯỢT BẤM 7 ngày. Google: 2 truy vấn.
import { enums } from "google-ads-api"
import { detectCompany } from "@/lib/company-detect"
import { adAccountId, metaGetAll } from "@/lib/case/meta-graph"
import { pickActionWindow, PURCHASE_TYPES } from "@/lib/case/meta-evidence"
import { placementKey, placementLabel } from "@/lib/case/meta-placements"
import { META_LEAD_TYPES, googleGoalKind, metaGoalKind, type GoalKind } from "@/lib/case/goal-kind"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { googleBiddableCategories } from "@/lib/case/service"
import { buildTable, DEVICE_VI, GENDER_VI, hourBlock, sumBy, type BRow, type BTable } from "./breakdown"
import { setCapped } from "@/lib/cost-guard"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const memo = new Map<string, { at: number; v: BTable[] }>()
const TTL = 30 * 60_000
const WORDS: Record<GoalKind, string> = { sales: "bán hàng", leads: "thu lead" }

export async function metaBreakdown(company: string, range: { from: string; to: string }, force = false): Promise<BTable[]> {
  const key = `meta|${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!force && hit && Date.now() - hit.at < TTL) return hit.v
  // Chiến dịch lấy từ số chi tiêu trong kỳ (gồm cả chiến dịch đã lưu trữ — danh sách mặc định của Meta bỏ chúng).
  const camps = (await metaGetAll<Row>(`act_${adAccountId()}/insights`, { level: "campaign", time_range: JSON.stringify({ since: range.from, until: range.to }), fields: "campaign_id,campaign_name,objective,spend", limit: "500" }))
    .filter((r) => detectCompany(String(r.campaign_name ?? "")) === company && Number(r.spend) > 0)
  const byKind: Record<GoalKind, string[]> = { sales: [], leads: [] }
  for (const c of camps) byKind[metaGoalKind(String(c.objective ?? ""))].push(String(c.campaign_id))
  const out: BTable[] = []
  const dims = [
    { dim: "age", title: "Độ tuổi", breakdowns: "age", key: (r: Row) => String(r.age), label: (r: Row) => String(r.age) },
    { dim: "gender", title: "Giới tính", breakdowns: "gender", key: (r: Row) => String(r.gender), label: (r: Row) => GENDER_VI[String(r.gender)] ?? String(r.gender) },
    { dim: "placement", title: "Vị trí hiển thị", breakdowns: "publisher_platform,platform_position", key: (r: Row) => placementKey(String(r.publisher_platform), String(r.platform_position)), label: (r: Row) => placementLabel(placementKey(String(r.publisher_platform), String(r.platform_position))) },
  ]
  for (const kind of ["sales", "leads"] as GoalKind[]) {
    const ids = byKind[kind]
    if (!ids.length) continue
    const types = kind === "leads" ? META_LEAD_TYPES : PURCHASE_TYPES
    for (const d of dims) {
      const rows = await metaGetAll<Row>(`act_${adAccountId()}/insights`, {
        level: "account", breakdowns: d.breakdowns, time_range: JSON.stringify({ since: range.from, until: range.to }),
        filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: ids }]),
        action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]), fields: "spend,impressions,inline_link_clicks,actions", limit: "500",
      })
      const b: BRow[] = sumBy(rows.map((r) => ({ key: d.key(r), label: d.label(r), spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.inline_link_clicks) || 0, results: pickActionWindow(r.actions, types, "7d_click") ?? 0 })))
      out.push(buildTable(`meta_${d.dim}_${kind}`, `Meta · ${d.title} · chiến dịch ${WORDS[kind]}`, kind, b))
    }
  }
  setCapped(memo, key, { at: Date.now(), v: out })
  return out
}

const en = (e: Record<string | number, string | number>, v: unknown) => (typeof v === "number" ? String(e[v] ?? v) : String(v ?? ""))

export async function googleBreakdown(company: string, range: { from: string; to: string }, force = false): Promise<BTable[]> {
  const key = `google|${company}|${range.from}|${range.to}`
  const hit = memo.get(key)
  if (!force && hit && Date.now() - hit.at < TTL) return hit.v
  const customer = getGoogleAdsCustomer(company)
  const cats = await googleBiddableCategories(customer).catch(() => new Map<string, string[]>())
  const D = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const [dev, hr] = await Promise.all([
    customer.query(`SELECT campaign.id, segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${D} AND metrics.impressions > 0`),
    customer.query(`SELECT campaign.id, segments.hour, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${D} AND metrics.impressions > 0`),
  ]) as [Row[], Row[]]
  const m = (r: Row) => ({ spend: (Number(r.metrics?.cost_micros) || 0) / 1e6, impressions: Number(r.metrics?.impressions) || 0, clicks: Number(r.metrics?.clicks) || 0, results: Number(r.metrics?.conversions) || 0 })
  const out: BTable[] = []
  for (const kind of ["sales", "leads"] as GoalKind[]) {
    const mine = (r: Row) => googleGoalKind(cats.get(String(r.campaign?.id))) === kind
    const d = sumBy(dev.filter(mine).map((r) => { const k = en(enums.Device as never, r.segments?.device); return { key: k, label: DEVICE_VI[k] ?? k, ...m(r) } }))
    const h = sumBy(hr.filter(mine).map((r) => ({ ...hourBlock(Number(r.segments?.hour) || 0), ...m(r) })))
    if (d.length) out.push(buildTable(`google_device_${kind}`, `Google · Thiết bị · chiến dịch ${WORDS[kind]}`, kind, d))
    if (h.length) { const t = buildTable(`google_hour_${kind}`, `Google · Khung giờ · chiến dịch ${WORDS[kind]}`, kind, h); t.rows.sort((a, b) => a.key.localeCompare(b.key)); out.push(t) } // khung giờ: theo thứ tự giờ
  }
  setCapped(memo, key, { at: Date.now(), v: out })
  return out
}
