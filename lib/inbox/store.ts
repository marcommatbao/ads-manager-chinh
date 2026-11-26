// ============================================================
// Đợt 15a — Trạng thái việc trong hộp "Việc nên làm hôm nay" + ảnh chụp lần dựng gần nhất
// ============================================================
// Trạng thái gắn theo KHOÁ việc (ổn định giữa các lần dựng), không theo lần dựng. Luật HIỆN LẠI (hàm thuần `effective`):
//   • Hoãn → hết hạn hoãn thì về Mới.
//   • Bỏ qua → tiền tăng > 50% so với lúc bỏ qua thì về Mới (ghi rõ vì sao).
//   • Đã làm → sau 7 ngày mà việc VẪN còn được sinh ra thì về Mới ("vẫn còn sau khi đã làm").
// Việc không còn được sinh ra thì không hiện (trạng thái giữ 90 ngày rồi dọn).
import fs from "fs"
import { createHash, randomUUID } from "node:crypto"
import { withFileLock } from "@/lib/file-lock"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { InboxItem, InboxSource } from "./build"
import type { Company } from "@/lib/case/types"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type InboxStatus = "new" | "seen" | "snoozed" | "done" | "dismissed"
// Nhãn chuyển sang ./labels.ts (file thuần, không phụ thuộc "fs") — re-export ở đây để không đổi chỗ import cũ.
export { STATUS_LABEL } from "./labels"
export interface ItemState { revision?: string; status: InboxStatus; at: string; by?: string; until?: string; reason?: string; moneyAt?: number | null }
export interface InboxSnapshot {
  builtAt: string
  items: InboxItem[]
  /** Nguồn đọc hỏng ở lần dựng này — việc của nguồn đó KHÔNG hiện (không trình số cũ). */
  errors: { company: Company | "ALL"; source: InboxSource; error: string }[]
  digest?: { sentAt: string; keys: string[]; sent: boolean; notConfigured?: boolean; error?: string }
}
export interface InboxView extends InboxItem { revision: string | null; status: InboxStatus; state: ItemState | null; resurfaced: string | null }

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
  return items.map((it) => { const st = states[it.key] ?? null; return { ...it, ...effective(it, st, now, t), state: st, revision: revisionOf(st) } })
}

/** Việc đang cần làm (vào top 5 / đếm "còn tồn"): Mới hoặc Đã xem. */
export const isOpen = (v: Pick<InboxView, "status">) => v.status === "new" || v.status === "seen"

/** Stable legacy token without rewriting old rows. No state uses explicit null. */
export function revisionOf(st: ItemState | null | undefined): string | null {
  if (!st) return null
  return st.revision ?? `legacy:${createHash("sha256").update(JSON.stringify([st.status, st.at, st.by ?? null, st.until ?? null, st.reason ?? null, st.moneyAt ?? null])).digest("hex")}`
}
export interface StatusInput { key: string; status: InboxStatus; expectedRevision: string | null; until?: string; reason?: string }
export class InboxStatusError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}

export function validateStatusInput(x: unknown, t: TFunction = makeT("vi")): StatusInput | string {
  const b = (x ?? {}) as Record<string, unknown>
  if (typeof b.key !== "string" || !b.key) return t("libcase.w.err.missingKey")
  if (typeof b.status !== "string" || !["new", "seen", "snoozed", "done", "dismissed"].includes(b.status)) return t("libcase.w.err.badStatus")
  if (b.expectedRevision !== null && (typeof b.expectedRevision !== "string" || !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|legacy:[0-9a-f]{64})$/.test(b.expectedRevision))) return t("overview.today.invalidRevision")
  const expectedRevision = b.expectedRevision as string | null
  const status = b.status as InboxStatus
  if (status === "snoozed") {
    if (typeof b.until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.until)) return t("libcase.w.err.snoozeDate")
    return { key: b.key, expectedRevision, status, until: `${b.until}T00:00:00+07:00` }
  }
  if (status === "dismissed") {
    const reason = typeof b.reason === "string" ? b.reason.trim() : ""
    if (reason.length < 3) return t("libcase.w.err.dismissReason")
    return { key: b.key, expectedRevision, status, reason: reason.slice(0, 500) }
  }
  return { key: b.key, expectedRevision, status }
}

/** Process-local file mutex only: not a cross-process/distributed CAS. */
export async function setItemStatus(input: StatusInput, by: string, canAccess: (company: Company) => boolean, now: Date = new Date()): Promise<ItemState> {
  return withFileLock(STATE, async () => {
    const item = readSnapshot()?.items.find(i => i.key === input.key)
    if (!item) throw new InboxStatusError(404, "itemNotFound")
    if (!canAccess(item.company)) throw new InboxStatusError(403, "noCompanyAccess")
    if (item.evidence) throw new InboxStatusError(403, "qualityReadOnly")
    // Fail closed on damaged/unreadable state; only a missing file means empty.
    let states: Record<string, ItemState>
    try { states = JSON.parse(fs.readFileSync(STATE, "utf-8")) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; states = {} }
    if (!states || typeof states !== "object" || Array.isArray(states) || Object.values(states).some(state =>
      !state || typeof state !== "object" || !["new", "seen", "snoozed", "done", "dismissed"].includes(state.status)
      || typeof state.at !== "string" || !Number.isFinite(Date.parse(state.at)))) throw new Error("INBOX_STATE_UNAVAILABLE")
    if (revisionOf(states[input.key]) !== input.expectedRevision) throw new InboxStatusError(409, "revisionConflict")
    const st: ItemState = { revision: randomUUID(), status: input.status, at: now.toISOString(), by,
      ...(input.until ? { until: input.until } : {}), ...(input.reason ? { reason: input.reason } : {}),
      ...(input.status === "dismissed" ? { moneyAt: item.money } : {}) }
    // Retain the new-state row too: deleting it would re-enable an old null token.
    states[input.key] = st
    writeJson(STATE, pruneStates(states, now.getTime()))
    return st
  })
}

export function pruneStates(states: Record<string, ItemState>, now: number): Record<string, ItemState> {
  return Object.fromEntries(Object.entries(states).filter(([, s]) => now - Date.parse(s.at) <= STATE_KEEP_DAYS * DAY || (s.status === "snoozed" && s.until && Date.parse(s.until) > now)))
}
