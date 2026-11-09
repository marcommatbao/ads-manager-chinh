// ============================================================
// Đợt 18f–h — Tự theo dõi bản tách chiến dịch Search
// ============================================================
// Trước Đợt 18: đo lại 7/14 ngày chỉ khi người dùng bấm, job đo lại Đợt 15b bỏ qua bản tách ("tự đo lại") → không đường nào đo.
// Nay: job hằng ngày tự đo đúng mốc 7 và 14 ngày sau lúc chuyển từ khoá, lưu kết quả; "Nên hoàn tác" → Teams kênh Ads + Hộp việc.
// Nhắc khi bản tách đã tạo mà chưa chuyển > 3 ngày, hoặc chiến dịch mới tạm dừng > 3 ngày (nhắc lại tối đa 3 ngày một lần).
// Diễn biến theo ngày (chi, chuyển đổi Google, CPA) của cả hai chiến dịch cho thẻ bản tách.

import { enums } from "google-ads-api"
import { addDays, vnDate } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import type { SplitRecord } from "./split"
import type { TFunction } from "@/lib/i18n/translate"
import { viT } from "@/lib/google-i18n"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const inv = (e: unknown) => Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([, v]) => typeof v === "number").map(([k, v]) => [v as number, k])) as Record<number, string>

export const REMIND_AFTER_DAYS = 3
export const REMIND_EVERY_DAYS = 3
const DAY = 86_400_000
/** Mốc thời gian ISO (UTC) → ngày giờ VN; chuỗi YYYY-MM-DD giữ nguyên. Cắt ISO UTC lệch 1 ngày cho thao tác 00:00–07:00 VN. */
export const vnDay = (s: string) => (s.length > 10 ? vnDate(new Date(s)) : s)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(vnDay(b)) - Date.parse(vnDay(a))) / DAY)

/** Mốc nào tới hạn mà chưa đo — HÀM THUẦN. "Hôm qua" theo giờ VN là ngày trọn cuối cùng. */
export function dueCheckpoints(r: Pick<SplitRecord, "step" | "movedAt" | "checkpoints">, now: Date): ("7" | "14")[] {
  if (r.step !== "moved" || !r.movedAt) return []
  const passed = daysBetween(r.movedAt, addDays(vnDate(now), -1))
  return (["7", "14"] as const).filter((d) => passed >= Number(d) && !r.checkpoints?.[d])
}

/** Có cần nhắc không — HÀM THUẦN. `newStatus`: trạng thái chiến dịch mới (đọc từ Google). */
export function reminderFor(r: Pick<SplitRecord, "step" | "at" | "movedAt" | "lastReminderAt" | "name">, newStatus: string | null, now: Date): string | null {
  if (r.step !== "created") return null
  const age = daysBetween(r.at, vnDate(now))
  if (age <= REMIND_AFTER_DAYS) return null
  if (r.lastReminderAt && daysBetween(r.lastReminderAt, vnDate(now)) < REMIND_EVERY_DAYS) return null
  return newStatus === "PAUSED"
    ? `Bản tách "${r.name}" tạo ${age} ngày trước nhưng chiến dịch mới VẪN TẠM DỪNG — bật (bước 2) rồi chuyển từ khoá (bước 3), hoặc gỡ nếu không dùng.`
    : `Bản tách "${r.name}" tạo ${age} ngày trước nhưng CHƯA chuyển từ khoá chung (bước 3) — chưa có mốc để đo hiệu quả, và từ khoá chung đang chạy ở cả hai chiến dịch.`
}

export interface DailyPoint { date: string; source: { cost: number; conv: number }; split: { cost: number; conv: number } }
export interface SplitSeries {
  from: string; to: string; points: DailyPoint[]
  totals: { source: { cost: number; conv: number; cpa: number | null }; split: { cost: number; conv: number; cpa: number | null } }
  newStatus: string | null; learning: string | null; sourceLostBudget7d: number | null
}

/** Gộp dòng GAQL theo ngày — HÀM THUẦN. */
export function buildSeries(rows: { date: string; campaignId: string; cost: number; conv: number }[], ids: { source: string; split: string }, from: string, to: string): Pick<SplitSeries, "points" | "totals" | "from" | "to"> {
  const m = new Map<string, DailyPoint>()
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, { date: d, source: { cost: 0, conv: 0 }, split: { cost: 0, conv: 0 } })
  for (const r of rows) {
    const p = m.get(r.date); if (!p) continue
    const side = r.campaignId === ids.source ? p.source : r.campaignId === ids.split ? p.split : null
    if (side) { side.cost += r.cost; side.conv += r.conv }
  }
  const points = [...m.values()]
  const tot = (k: "source" | "split") => { const cost = points.reduce((s, p) => s + p[k].cost, 0), conv = points.reduce((s, p) => s + p[k].conv, 0); return { cost, conv, cpa: conv > 0 ? cost / conv : null } }
  return { from, to, points, totals: { source: tot("source"), split: tot("split") } }
}

const BSS = inv(enums.BiddingStrategySystemStatus)
const CS = inv(enums.CampaignStatus)
export function learningLabel(status: number | null | undefined, t: TFunction = viT): string | null {
  const s = status == null ? "" : BSS[status] ?? ""
  if (!s) return null
  if (s.startsWith("LEARNING")) return t("libgoogle.st.learning")
  if (s.startsWith("LIMITED")) return t("libgoogle.st.limited", { why: s.replace("LIMITED_BY_", "").toLowerCase().replace(/_/g, " ") })
  if (s === "ENABLED") return t("libgoogle.st.stable")
  return s.toLowerCase().replace(/_/g, " ")
}

/** Diễn biến theo ngày từ lúc chuyển (hoặc lúc tạo) tới hôm qua, tối đa 21 ngày — ~2 truy vấn Google Ads. */
export async function splitSeries(company: Company, r: SplitRecord, now = new Date(), t: TFunction = viT): Promise<SplitSeries> {
  const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
  const c = getGoogleAdsCustomer(company)
  const splitId = String(r.newCampaign ?? "").split("/").pop() ?? ""
  if (!/^\d+$/.test(splitId) || !/^\d+$/.test(r.sourceId)) throw new Error(t("libgoogle.st.errNoId"))
  const to = addDays(vnDate(now), -1)
  const start = vnDay(r.movedAt ?? r.at)
  const minFrom = addDays(to, -20)
  let from = start > minFrom ? start : minFrom
  if (from > to) from = to
  const [daily, state] = await Promise.all([
    c.query(`SELECT segments.date, campaign.id, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id IN (${r.sourceId}, ${splitId}) AND segments.date BETWEEN '${from}' AND '${to}'`) as Promise<Row[]>,
    c.query(`SELECT campaign.id, campaign.status, campaign.bidding_strategy_system_status, metrics.search_budget_lost_impression_share FROM campaign WHERE campaign.id IN (${r.sourceId}, ${splitId}) AND segments.date BETWEEN '${addDays(to, -6)}' AND '${to}'`) as Promise<Row[]>,
  ])
  const s = buildSeries(daily.map((x) => ({ date: String(x.segments.date), campaignId: String(x.campaign.id), cost: Number(x.metrics.cost_micros) / 1e6 || 0, conv: Number(x.metrics.conversions) || 0 })), { source: r.sourceId, split: splitId }, from, to)
  const mine = state.find((x) => String(x.campaign.id) === splitId), src = state.find((x) => String(x.campaign.id) === r.sourceId)
  const lost = src?.metrics?.search_budget_lost_impression_share
  return { ...s, newStatus: mine ? CS[mine.campaign.status] ?? null : null, learning: learningLabel(mine?.campaign?.bidding_strategy_system_status, t), sourceLostBudget7d: lost == null ? null : Number(lost) }
}

// ── Job hằng ngày ──

export interface TrackingOutcome { measured: { id: string; name: string; days: "7" | "14"; verdict: string; lines: string[] }[]; reminders: { id: string; text: string }[]; errors: string[] }

/** Thẻ Teams — HÀM THUẦN. null = không có gì đáng báo (không gửi thẻ rỗng). */
export function composeTrackingCard(o: TrackingOutcome): { title: string; level: "good" | "warning" | "danger"; facts: { title: string; value: string }[] } | null {
  if (!o.measured.length && !o.reminders.length) return null
  const bad = o.measured.filter((m) => m.verdict === "dung")
  const facts = [
    ...o.measured.map((m) => ({ title: `${m.name} · mốc ${m.days} ngày`, value: `${m.verdict === "dung" ? "✕ Nên hoàn tác chuyển từ khoá" : m.verdict === "tot" ? "✓ Đạt" : "○ Theo dõi tiếp"} — ${m.lines[0] ?? ""}` })),
    ...o.reminders.map((r) => ({ title: "Nhắc", value: r.text })),
  ]
  return { title: bad.length ? `⚠ Bản tách Search: ${bad.length} bản nên hoàn tác` : "Bản tách Search — kết quả đo / nhắc việc", level: bad.length ? "danger" : o.reminders.length ? "warning" : "good", facts }
}

export async function runSplitTracking(now = new Date()): Promise<TrackingOutcome & { sent: boolean; notConfigured?: boolean }> {
  const { allSplits, splitCheckpoint, saveSplitCheckpoint, markSplitReminded } = await import("./split")
  const out: TrackingOutcome = { measured: [], reminders: [], errors: [] }
  for (const r of allSplits()) {
    if (r.step !== "moved" && r.step !== "created") continue
    try {
      for (const d of dueCheckpoints(r, now)) {
        const cp = await splitCheckpoint(r.company, r.id, Number(d) as 7 | 14)
        if (!cp.result) continue
        await saveSplitCheckpoint(r.company, r.id, d, cp.result, now)
        out.measured.push({ id: r.id, name: r.name, days: d, verdict: cp.result.verdict, lines: cp.result.lines })
      }
      if (r.step === "created" && r.newCampaign) {
        const { getGoogleAdsCustomer } = await import("@/lib/google-ads-client")
        const [st] = (await getGoogleAdsCustomer(r.company).query(`SELECT campaign.status FROM campaign WHERE campaign.resource_name = '${r.newCampaign}'`)) as Row[]
        const text = reminderFor(r, st ? CS[st.campaign.status] ?? null : null, now)
        if (text) { out.reminders.push({ id: r.id, text }); await markSplitReminded(r.company, r.id, now) }
      }
    } catch (e) { out.errors.push(`${r.name}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`) }
  }
  const card = composeTrackingCard(out)
  if (!card) return { ...out, sent: false }
  const { sendTeamsAlert } = await import("@/lib/teams-alert")
  const res = await sendTeamsAlert({ ...card, action: "Mở X-quang Search → Tách → Các bản tách đã có.", webhookUrl: process.env.TEAMS_WEBHOOK_ADS ?? "", setupHint: "Kết quả đo bản tách KHÔNG gửi Teams vì thiếu TEAMS_WEBHOOK_ADS — vẫn lưu trên thẻ bản tách." })
  return { ...out, sent: res.sent, ...(res.notConfigured ? { notConfigured: true } : {}) }
}
