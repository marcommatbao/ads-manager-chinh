// ============================================================
// Đợt 15a — Trạng thái việc trong hộp "Việc nên làm hôm nay" + ảnh chụp lần dựng gần nhất
// ============================================================
// Trạng thái gắn theo KHOÁ việc (ổn định giữa các lần dựng), không theo lần dựng. Luật HIỆN LẠI (hàm thuần `effective`):
//   • Hoãn → hết hạn hoãn thì về Mới.
//   • Bỏ qua → tiền tăng > 50% so với lúc bỏ qua thì về Mới (ghi rõ vì sao).
//   • Đã làm → sau 7 ngày mà việc VẪN còn được sinh ra thì về Mới ("vẫn còn sau khi đã làm").
// Việc không còn được sinh ra thì không hiện (trạng thái giữ 90 ngày rồi dọn).
import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { InboxItem, InboxSource } from "./build"
import type { Company } from "@/lib/case/types"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type InboxStatus = "new" | "seen" | "snoozed" | "done" | "dismissed"
// Nhãn chuyển sang ./labels.ts (file thuần, không phụ thuộc "fs") — re-export ở đây để không đổi chỗ import cũ.
export { STATUS_LABEL } from "./labels"
export interface ItemState { status: InboxStatus; at: string; by?: string; until?: string; reason?: string; moneyAt?: number | null }
export interface InboxSnapshot {
  builtAt: string
  items: InboxItem[]
  /** Nguồn đọc hỏng ở lần dựng này — việc của nguồn đó KHÔNG hiện (không trình số cũ). */
  errors: { company: Company | "ALL"; source: InboxSource; error: string }[]
  digest?: { sentAt: string; keys: string[]; sent: boolean; notConfigured?: boolean; error?: string }
}
export interface InboxView extends InboxItem { status: InboxStatus; state: ItemState | null; resurfaced: string | null }

const DIR = path.join(process.cwd(), "data")
const SNAP = path.join(DIR, "inbox.json"), STATE = path.join(DIR, "inbox-state.json")
export const DONE_RECHECK_DAYS = 7, RESURFACE_MONEY = 1.5, STATE_KEEP_DAYS = 90
const DAY = 86_400_000

const readJson = <T,>(p: string, d: T): T => { try { return JSON.parse(fs.readFileSync(p, "utf-8")) as T } catch { return d } }
const writeJson = (p: string, v: unknown) => { fs.mkdirSync(DIR, { recursive: true }); writeFileAtomicSync(p, JSON.stringify(v, null, 1)) }

export const readSnapshot = (): InboxSnapshot | null => readJson<InboxSnapshot | null>(SNAP, null)
export const saveSnapshot = (s: InboxSnapshot) => writeJson(SNAP, s)
export const readStates = (): Record<string, ItemState> => readJson<Record<string, ItemState>>(STATE, {})

/** Trạng thái hiệu lực của một việc lúc `now` — HÀM THUẦN. */
export function effective(item: Pick<InboxItem, "money">, st: ItemState | null | undefined, now: number, t: TFunction = makeT("vi")): { status: InboxStatus; resurfaced: string | null } {
  if (!st) return { status: "new", resurfaced: null }
  const d = st.at.slice(0, 10).split("-").reverse().join("/")
  if (st.status === "snoozed") return st.until && Date.parse(st.until) <= now ? { status: "new", resurfaced: t("libcase.w.resurf.snooze", { d: st.until.slice(0, 10).split("-").reverse().join("/") }) } : { status: "snoozed", resurfaced: null }
  if (st.status === "dismissed") {
    if (st.moneyAt && item.money != null && item.money > st.moneyAt * RESURFACE_MONEY)
      return { status: "new", resurfaced: t("libcase.w.resurf.dismiss", { d, p: Math.round((item.money / st.moneyAt - 1) * 100) }) }
    return { status: "dismissed", resurfaced: null }
  }
  if (st.status === "done" && now - Date.parse(st.at) > DONE_RECHECK_DAYS * DAY) return { status: "new", resurfaced: t("libcase.w.resurf.done", { d, n: DONE_RECHECK_DAYS }) }
  return { status: st.status, resurfaced: null }
}

export function viewItems(items: InboxItem[], states: Record<string, ItemState>, now: number = Date.now(), t: TFunction = makeT("vi")): InboxView[] {
  return items.map((it) => { const st = states[it.key] ?? null; return { ...it, ...effective(it, st, now, t), state: st } })
}

/** Việc đang cần làm (vào top 5 / đếm "còn tồn"): Mới hoặc Đã xem. */
export const isOpen = (v: Pick<InboxView, "status">) => v.status === "new" || v.status === "seen"

export function validateStatusInput(x: unknown, t: TFunction = makeT("vi")): { key: string; status: InboxStatus; until?: string; reason?: string } | string {
  const b = (x ?? {}) as Record<string, unknown>
  if (typeof b.key !== "string" || !b.key) return t("libcase.w.err.missingKey")
  if (!["new", "seen", "snoozed", "done", "dismissed"].includes(String(b.status))) return t("libcase.w.err.badStatus")
  const status = b.status as InboxStatus
  if (status === "snoozed") {
    if (typeof b.until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.until)) return t("libcase.w.err.snoozeDate")
    return { key: b.key, status, until: `${b.until}T00:00:00+07:00` }
  }
  if (status === "dismissed") {
    const reason = typeof b.reason === "string" ? b.reason.trim() : ""
    if (reason.length < 3) return t("libcase.w.err.dismissReason")
    return { key: b.key, status, reason: reason.slice(0, 500) }
  }
  return { key: b.key, status }
}

export function setItemStatus(input: { key: string; status: InboxStatus; until?: string; reason?: string }, by: string, now: Date = new Date()): ItemState {
  const states = readStates()
  const money = readSnapshot()?.items.find((i) => i.key === input.key)?.money ?? null
  const st: ItemState = { status: input.status, at: now.toISOString(), by, ...(input.until ? { until: input.until } : {}), ...(input.reason ? { reason: input.reason } : {}), ...(input.status === "dismissed" ? { moneyAt: money } : {}) }
  if (input.status === "new") delete states[input.key]
  else states[input.key] = st
  writeJson(STATE, pruneStates(states, now.getTime()))
  return st
}

export function pruneStates(states: Record<string, ItemState>, now: number): Record<string, ItemState> {
  return Object.fromEntries(Object.entries(states).filter(([, s]) => now - Date.parse(s.at) <= STATE_KEEP_DAYS * DAY || (s.status === "snoozed" && s.until && Date.parse(s.until) > now)))
}
