// ============================================================
// Đợt 15b — ĐO LẠI mỗi lần ghi ở mốc 7 / 14 ngày
// ============================================================
// So N ngày TRƯỚC ngày ghi với N ngày SAU (bỏ chính ngày ghi) cho các chiến dịch bị chạm — chi, đơn Mua hàng, CPA — rồi TRỪ ĐI
// thay đổi CPA của cả tài khoản cùng kỳ (mùa vụ / cuối tháng không bị tính là do tool). "Đơn": Google = nhóm chuyển đổi MUA HÀNG
// (như X-quang Search — MBI đặt giá theo Thêm giỏ nên conversions thô sai); Meta = mua hàng từ LƯỢT BẤM 7 ngày (Đợt 12: số mặc
// định gồm cả chỉ-xem). Phán: Tốt / Xấu / Không đổi / Chưa rõ — Chưa rõ LUÔN kèm lý do (ít đơn, chồng lần ghi khác, dừng hẳn…).
import { addDays } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import type { WriteEvent, WritePlatform } from "./feed"

export const WINDOWS = [7, 14] as const
export type WindowDays = (typeof WINDOWS)[number]
export const MIN_ORDERS = 10, GOOD_CHANGE = -0.1, BAD_CHANGE = 0.15
/** Cả nhóm so sánh biến động quá mức này → không kết luận (đo 29/09: Search MBC nửa cuối tháng 9 CPA chung +47%…+96%). */
export const MAX_ACCOUNT_SWING = 0.3
/** Chờ thêm sau cửa sổ để đơn về trễ (Google gán đơn về ngày bấm; Meta lượt bấm 7 ngày) được ghi đủ. */
export const LAG_DAYS = 3
/** Biên dao động ngẫu nhiên: thay đổi phải vượt Z × sai số chuẩn của log(tỉ lệ CPA). Đo 29/09: Brand-Vn KHÔNG ai sửa mà CPA tuần
 *  sau vẫn +17% (293 → 227 đơn) — ngưỡng cứng 15% sẽ báo XẤU giả. Sai số theo Poisson: √(1/đơn trước + 1/đơn sau + nhóm so sánh). */
export const NOISE_Z = 1.96, MAX_NOISE_SE = 0.5
import type { Verdict } from "./verdict"
export { VERDICT_LABEL, type Verdict } from "./verdict"

export interface Metrics { cost: number; orders: number }
export interface CampaignMetrics extends Metrics { channel: string }
export interface WindowResult {
  eventId: string; days: WindowDays; measuredAt: string
  range: { before: { from: string; to: string }; after: { from: string; to: string } }
  campaignIds: string[]
  before: Metrics; after: Metrics; accountBefore: Metrics; accountAfter: Metrics
  cpaBefore: number | null; cpaAfter: number | null
  /** Thay đổi CPA của nhóm so sánh (chiến dịch cùng loại không bị chạm) cùng kỳ (vd +0,03 = +3%). */
  accountChange: number | null
  /** Thay đổi CPA của chiến dịch SAU KHI trừ thay đổi chung. */
  adjustedChange: number | null
  verdict: Verdict; note: string
}

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`
const cpa = (m: Metrics) => (m.orders > 0 ? m.cost / m.orders : null)
const dm = (ymd: string) => ymd.slice(5).split("-").reverse().join("/")

/** Ngày ghi (giờ VN) + cửa sổ trước/sau + ngày đo (sau cửa sổ LAG_DAYS ngày). Ngày ghi bị bỏ (nửa ngày trước, nửa ngày sau). */
export function windowRanges(at: string, days: number): { day0: string; before: { from: string; to: string }; after: { from: string; to: string }; dueOn: string } {
  const day0 = new Date(Date.parse(at) + 7 * 3_600_000).toISOString().slice(0, 10)
  return { day0, before: { from: addDays(day0, -days), to: addDays(day0, -1) }, after: { from: addDays(day0, 1), to: addDays(day0, days) }, dueOn: addDays(day0, days + 1 + LAG_DAYS) }
}

/** Lần ghi khác chạm cùng chiến dịch, KHÁC ngày, trong khoảng [trước, sau] của cửa sổ — số trước/sau không tách được. */
export function overlapsOf(ev: WriteEvent, all: WriteEvent[], campaignIds: string[], days: number): WriteEvent[] {
  const w = windowRanges(ev.at, days)
  return all.filter((o) => {
    if (o.id === ev.id || o.company !== ev.company || o.platform !== ev.platform) return false
    const d = windowRanges(o.at, 0).day0
    return d !== w.day0 && d >= w.before.from && d <= w.after.to && o.campaignIds.some((c) => campaignIds.includes(c))
  })
}

/** Phán một cửa sổ — HÀM THUẦN. */
export function judgeWindow(input: { before: Metrics; after: Metrics; accountBefore: Metrics; accountAfter: Metrics; overlaps: WriteEvent[] }): Pick<WindowResult, "cpaBefore" | "cpaAfter" | "accountChange" | "adjustedChange" | "verdict" | "note"> {
  const { before: b, after: a } = input
  const cpaBefore = cpa(b), cpaAfter = cpa(a)
  const accB = cpa(input.accountBefore), accA = cpa(input.accountAfter)
  const accountChange = accB && accA ? accA / accB - 1 : null
  const base = { cpaBefore, cpaAfter, accountChange, adjustedChange: null as number | null }
  if (input.overlaps.length) return { ...base, verdict: "chua_ro", note: `Chồng với lần ghi ${[...new Set(input.overlaps.map((o) => dm(windowRanges(o.at, 0).day0)))].join(", ")} trên cùng chiến dịch — không tách được tác động từng lần.` }
  if (b.cost < 1 && a.cost < 1) return { ...base, verdict: "chua_ro", note: "Không chi cả hai kỳ." }
  // Dừng hẳn (chi sau < 5% chi trước): chấm theo tiền đã thôi chi vs đơn mất.
  if (b.cost > 0 && a.cost < b.cost * 0.05) {
    const saved = b.cost - a.cost, lost = b.orders - a.orders
    if (b.orders < 1) return { ...base, verdict: "tot", note: `Thôi chi ${vnd(saved)} vào chỗ 0 đơn.` }
    const accCpa = accB ?? null
    if (accCpa && cpaBefore && cpaBefore > accCpa * 1.5) return { ...base, verdict: "tot", note: `Thôi chi ${vnd(saved)}, mất ${Math.round(lost)} đơn với CPA ${vnd(cpaBefore)} — đắt hơn 1,5× CPA chung ${vnd(accCpa)}.` }
    return { ...base, verdict: "chua_ro", note: `Thôi chi ${vnd(saved)} nhưng mất ${Math.round(lost)} đơn (CPA ${cpaBefore ? vnd(cpaBefore) : "—"}${accCpa ? ` vs chung ${vnd(accCpa)}` : ""}) — cân nhắc theo ngân sách.` }
  }
  if (b.orders + a.orders < MIN_ORDERS) return { ...base, verdict: "chua_ro", note: `Chỉ ${Math.round(b.orders)} → ${Math.round(a.orders)} đơn (< ${MIN_ORDERS} cả hai kỳ) — quá ít để kết luận.` }
  if (cpaBefore == null) return { ...base, verdict: "tot", note: `Trước 0 đơn, sau ${Math.round(a.orders)} đơn (CPA ${vnd(cpaAfter!)}).` }
  if (cpaAfter == null) return { ...base, verdict: "xau", note: `Trước ${Math.round(b.orders)} đơn, sau 0 đơn dù vẫn chi ${vnd(a.cost)}.` }
  const raw = cpaAfter / cpaBefore
  const adjustedChange = raw / (accountChange != null ? 1 + accountChange : 1) - 1
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`
  const line = `CPA ${vnd(cpaBefore)} → ${vnd(cpaAfter)} (${pct(raw - 1)}${accountChange != null ? `; nhóm so sánh ${pct(accountChange)} → sau khi trừ ${pct(adjustedChange)}` : ""}); đơn ${Math.round(b.orders)} → ${Math.round(a.orders)}.`
  if (accountChange != null && Math.abs(accountChange) > MAX_ACCOUNT_SWING)
    return { ...base, adjustedChange, verdict: "chua_ro", note: `${line} Các chiến dịch cùng loại biến động mạnh (${pct(accountChange)}) — mùa vụ / đơn về trễ, chưa kết luận được.` }
  const inv = (n: number) => (n > 0 ? 1 / n : 0)
  const se = Math.sqrt(inv(b.orders) + inv(a.orders) + inv(input.accountBefore.orders) + inv(input.accountAfter.orders))
  if (se > MAX_NOISE_SE) return { ...base, adjustedChange, verdict: "chua_ro", note: `${line} Quá ít đơn — biên dao động ngẫu nhiên ±${Math.round((Math.exp(NOISE_Z * se) - 1) * 100)}%.` }
  if (Math.abs(Math.log(1 + adjustedChange)) < NOISE_Z * se) return { ...base, adjustedChange, verdict: "khong_doi", note: `${line} Trong biên dao động ngẫu nhiên (±${Math.round((Math.exp(NOISE_Z * se) - 1) * 100)}%) — chưa thấy tác động rõ.` }
  // Tốt/Xấu chỉ khi số THÔ không ngược chiều — phép trừ không được tự lật dấu kết luận.
  const verdict: Verdict = adjustedChange <= GOOD_CHANGE && raw - 1 <= 0.05 ? "tot" : adjustedChange >= BAD_CHANGE && raw - 1 >= -0.05 ? "xau" : "khong_doi"
  return { ...base, adjustedChange, verdict, note: line }
}

// ── Đọc số (chỉ đọc) ──────────────────────────────────────────
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export interface MetricsReader {
  /** Số theo chiến dịch + tổng tài khoản (công ty) trong khoảng ngày. */
  read(company: Company, platform: WritePlatform, range: { from: string; to: string }): Promise<{ byCampaign: Map<string, CampaignMetrics> }>
  /** Tên tài nguyên cấp nhóm / asset group / ngân sách → mã chiến dịch. */
  resolve(company: Company, resources: string[]): Promise<string[]>
}

export function liveReader(): MetricsReader {
  const cache = new Map<string, Promise<{ byCampaign: Map<string, CampaignMetrics> }>>()
  return {
    read(company, platform, range) {
      const k = `${company}|${platform}|${range.from}|${range.to}`
      if (!cache.has(k)) cache.set(k, platform === "google" ? readGoogle(company, range) : readMeta(company, range))
      return cache.get(k)!
    },
    resolve: resolveGoogle,
  }
}

async function readGoogle(company: Company, range: { from: string; to: string }) {
  const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
  const c = getGoogleAdsCustomer(company)
  const B = `segments.date BETWEEN '${range.from}' AND '${range.to}'`
  const [cost, orders] = await Promise.all([
    c.query(`SELECT campaign.id, campaign.advertising_channel_type, metrics.cost_micros FROM campaign WHERE ${B}`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, segments.conversion_action_category, metrics.conversions FROM campaign WHERE ${B} AND segments.conversion_action_category = 'PURCHASE'`) as Promise<Row[]>,
  ])
  const byCampaign = new Map<string, CampaignMetrics>()
  const get = (id: string) => byCampaign.get(id) ?? (byCampaign.set(id, { cost: 0, orders: 0, channel: "?" }), byCampaign.get(id)!)
  for (const r of cost) { const m = get(String(r.campaign.id)); m.cost += (Number(r.metrics.cost_micros) || 0) / 1e6; m.channel = String(r.campaign.advertising_channel_type) }
  for (const r of orders) get(String(r.campaign.id)).orders += Number(r.metrics.conversions) || 0
  return { byCampaign }
}

async function readMeta(company: Company, range: { from: string; to: string }) {
  const { metaGetAll, adAccountId } = await import("@/lib/case/meta-graph")
  const { pickActionWindow, PURCHASE_TYPES } = await import("@/lib/case/meta-evidence")
  const { detectCompany } = await import("@/lib/company-detect")
  const rows = await metaGetAll<Row>(`act_${adAccountId()}/insights`, { level: "campaign", time_range: JSON.stringify({ since: range.from, until: range.to }), fields: "campaign_id,campaign_name,spend,actions", action_attribution_windows: JSON.stringify(["7d_click"]), limit: "500" }, 3)
  const byCampaign = new Map<string, CampaignMetrics>()
  for (const r of rows.filter((r) => detectCompany(String(r.campaign_name)) === company))
    byCampaign.set(String(r.campaign_id), { cost: Number(r.spend) || 0, orders: pickActionWindow(r.actions, PURCHASE_TYPES, "7d_click") ?? 0, channel: "meta" })
  return { byCampaign }
}

async function resolveGoogle(company: Company, resources: string[]): Promise<string[]> {
  if (!resources.length) return []
  const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
  const c = getGoogleAdsCustomer(company)
  const ids = (kind: string[]) => [...new Set(resources.filter((r) => kind.includes(r.split("/")[2])).map((r) => r.split("/")[3]))].filter((x) => /^\d+$/.test(x))
  const ag = ids(["adGroups", "adGroupCriteria", "adGroupAds", "adGroupAssets"]), asg = ids(["assetGroups", "assetGroupAssets", "assetGroupSignals", "assetGroupListingGroupFilters"]), bud = ids(["campaignBudgets"])
  const out = new Set<string>()
  const q = async (gaql: string) => { for (const r of (await c.query(gaql)) as Row[]) out.add(String(r.campaign.id)) }
  if (ag.length) await q(`SELECT campaign.id FROM ad_group WHERE ad_group.id IN (${ag.join(",")})`)
  if (asg.length) await q(`SELECT campaign.id FROM asset_group WHERE asset_group.id IN (${asg.join(",")})`)
  if (bud.length) await q(`SELECT campaign.id FROM campaign WHERE campaign_budget.id IN (${bud.join(",")})`)
  return [...out]
}

export const sumMetrics = (ms: Metrics[]): Metrics => ms.reduce((s, m) => ({ cost: s.cost + m.cost, orders: s.orders + m.orders }), { cost: 0, orders: 0 })

/** Đo một cửa sổ của một lần ghi. campaignIds đã tra xong. */
export async function measureWindow(ev: WriteEvent, campaignIds: string[], days: WindowDays, all: WriteEvent[], reader: MetricsReader, now = new Date()): Promise<WindowResult> {
  const w = windowRanges(ev.at, days)
  const [b, a] = await Promise.all([reader.read(ev.company, ev.platform, w.before), reader.read(ev.company, ev.platform, w.after)])
  const zero = { cost: 0, orders: 0 }
  const pick = (m: Map<string, Metrics>) => sumMetrics(campaignIds.map((id) => m.get(id) ?? zero))
  const before = pick(b.byCampaign), after = pick(a.byCampaign)
  // Nhóm so sánh = các chiến dịch CÙNG LOẠI (Search với Search, PMax với PMax; Meta: cả công ty) mà KHÔNG bị chạm.
  const channels = new Set(campaignIds.map((id) => b.byCampaign.get(id)?.channel ?? a.byCampaign.get(id)?.channel).filter(Boolean))
  const peers = (m: Map<string, CampaignMetrics>) => sumMetrics([...m.entries()].filter(([id, x]) => !campaignIds.includes(id) && (!channels.size || channels.has(x.channel))).map(([, x]) => x))
  const accountBefore = peers(b.byCampaign), accountAfter = peers(a.byCampaign)
  const j = judgeWindow({ before, after, accountBefore, accountAfter, overlaps: overlapsOf(ev, all, campaignIds, days) })
  return { eventId: ev.id, days, measuredAt: now.toISOString(), range: { before: w.before, after: w.after }, campaignIds, before, after, accountBefore, accountAfter, ...j }
}
