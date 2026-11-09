// ============================================================
// Đợt 15b — Job `write_outcomes` (09:00 hằng ngày): đo lại các lần ghi tới mốc 7/14 ngày. CHỈ ĐỌC tài khoản quảng cáo.
// ============================================================
// Mỗi (lần ghi × mốc) đo ĐÚNG MỘT lần rồi lưu (data/write-outcomes.json, giữ theo luồng ghi ~400 ngày). Meta ~60 lượt/giờ →
// mỗi lượt chạy đo tối đa META_MAX_RANGES khoảng ngày Meta, phần còn lại để hôm sau. Mốc 14 ngày ra XẤU → một thẻ Teams (kênh
// Ads nếu có, không thì kênh IT) kèm chỗ hoàn tác — KHÔNG tự hoàn tác.
import { makeT, type TFunction } from "@/lib/i18n/translate"
import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { vnDate } from "@/lib/case/dates"
import { collectWrites, type WriteEvent } from "./feed"
import { WINDOWS, windowRanges, measureWindow, liveReader, VERDICT_LABEL, type MetricsReader, type Verdict, type WindowDays, type WindowResult } from "./outcome"

export interface SkippedResult { eventId: string; days: WindowDays; measuredAt: string; skipped: true; verdict: "chua_ro"; note: string }
export type OutcomeRecord = WindowResult | SkippedResult
const FILE = path.join(process.cwd(), "data", "write-outcomes.json")
export const META_MAX_RANGES = 12
export const outcomeKey = (eventId: string, days: number) => `${eventId}:${days}`

export function readOutcomes(): Record<string, OutcomeRecord> { try { return JSON.parse(fs.readFileSync(FILE, "utf-8")) as Record<string, OutcomeRecord> } catch { return {} } }
function saveOutcomes(o: Record<string, OutcomeRecord>) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); writeFileAtomicSync(FILE, JSON.stringify(o, null, 1)) }

/** Lý do KHÔNG đo (không tốn lượt gọi) — HÀM THUẦN. null = cần đo. */
export function skipReason(ev: WriteEvent, days: number, t: TFunction = makeT("vi")): string | null {
  if (ev.ownOutcome === "case") return t("libcase.w.skip.case")
  if (ev.ownOutcome === "split") return t("libcase.w.skip.split")
  if (ev.accountLevel) return t("libcase.w.skip.account")
  if (!ev.campaignIds.length && !ev.pending.length) return t("libcase.w.skip.unknown")
  if (ev.undoneAt && vnDate(new Date(ev.undoneAt)) <= windowRanges(ev.at, days).after.to) return t("libcase.w.skip.undone", { d: vnDate(new Date(ev.undoneAt)).slice(5).split("-").reverse().join("/") })
  return null
}

/** Các (lần ghi × mốc) tới hạn mà chưa đo — HÀM THUẦN. */
export function dueWindows(events: WriteEvent[], done: Record<string, OutcomeRecord>, today: string): { ev: WriteEvent; days: WindowDays }[] {
  const out: { ev: WriteEvent; days: WindowDays }[] = []
  for (const ev of events) for (const days of WINDOWS) if (!done[outcomeKey(ev.id, days)] && windowRanges(ev.at, days).dueOn <= today) out.push({ ev, days })
  return out.sort((a, b) => a.ev.at.localeCompare(b.ev.at) || a.days - b.days)
}

export async function runWriteOutcomes(now = new Date(), reader: MetricsReader = liveReader()): Promise<{ events: number; measured: number; skipped: number; deferred: number; errors: string[]; bad: WindowResult[]; verdicts: Partial<Record<Verdict, number>> }> {
  const { events, errors } = await collectWrites(now)
  const done = readOutcomes()
  const today = vnDate(now)
  let measured = 0, skipped = 0, deferred = 0, metaRanges = 0
  const bad: WindowResult[] = [], verdicts: Partial<Record<Verdict, number>> = {}
  const resolved = new Map<string, string[]>()
  for (const { ev, days } of dueWindows(events, done, today)) {
    const why = skipReason(ev, days)
    if (why) { done[outcomeKey(ev.id, days)] = { eventId: ev.id, days, measuredAt: now.toISOString(), skipped: true, verdict: "chua_ro", note: why }; skipped++; continue }
    if (ev.platform === "meta") { if (metaRanges + 2 > META_MAX_RANGES) { deferred++; continue } metaRanges += 2 }
    try {
      if (!resolved.has(ev.id)) resolved.set(ev.id, [...new Set([...ev.campaignIds, ...(ev.pending.length ? await reader.resolve(ev.company, ev.pending) : [])])])
      const ids = resolved.get(ev.id)!
      if (!ids.length) { done[outcomeKey(ev.id, days)] = { eventId: ev.id, days, measuredAt: now.toISOString(), skipped: true, verdict: "chua_ro", note: "Tài nguyên đã bị xoá — không tra được chiến dịch" }; skipped++; continue }
      const r = await measureWindow(ev, ids, days, events, reader, now)
      done[outcomeKey(ev.id, days)] = r
      measured++
      verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1
      if (r.verdict === "xau" && days === 14) bad.push(r)
    } catch (e) {
      // Lỗi đọc số: KHÔNG lưu → lần sau đo lại (không biến lỗi tạm thành "chưa rõ" vĩnh viễn).
      errors.push(`${ev.id} (${days} ngày): ${e instanceof Error ? e.message : String(e)}`)
    }
    saveOutcomes(done)
  }
  saveOutcomes(done)
  if (bad.length) await alertBad(bad, events).catch((e) => errors.push(`báo Teams: ${e instanceof Error ? e.message : String(e)}`))
  return { events: events.length, measured, skipped, deferred, errors, bad, verdicts }
}

async function alertBad(bad: WindowResult[], events: WriteEvent[]) {
  const facts = bad.map((r) => {
    const ev = events.find((e) => e.id === r.eventId)
    return { title: `${VERDICT_LABEL.xau} · ${ev?.company ?? ""} · ${ev?.sourceLabel ?? ""} · ghi ${ev ? windowRanges(ev.at, 0).day0.slice(5).split("-").reverse().join("/") : ""}`, value: `${ev?.label ?? r.eventId} — ${r.note}` }
  })
  const card = { level: "danger" as const, title: `✕ ${bad.length} lần ghi của tool ra XẤU sau 14 ngày`, facts, action: "Mở AdsCommand → Đã làm & kết quả để xem và HOÀN TÁC nếu cần (tool không tự hoàn tác)." }
  const ads = (process.env.TEAMS_WEBHOOK_ADS ?? "").trim()
  if (ads) {
    const { sendTeamsAlert } = await import("@/lib/teams-alert")
    const r = await sendTeamsAlert({ ...card, webhookUrl: ads })
    if (r.sent) return
  }
  const { sendSystemAlert } = await import("@/lib/system-alert")
  const r = await sendSystemAlert(card)
  if (!r.sent) throw new Error(r.error ?? "không gửi được")
}
