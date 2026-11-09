// ============================================================
// Đợt 16 — Meta Conversions API: gửi đơn thật (đã băm) về pixel
// ============================================================
// Tên sự kiện RIÊNG (không phải "Purchase"): pixel trên web đã bắn Purchase mà không mang mã đơn Odoo → gửi thêm Purchase
// từ server sẽ bị Meta đếm TRÙNG, làm hỏng chính số đang dùng để tối ưu. Sự kiện riêng không đụng số cũ; muốn tối ưu theo
// nó thì tạo chuyển đổi tuỳ chỉnh trong Events Manager rồi tạo nhóm mới (như nhóm "chỉ tính lượt bấm" Đợt 12).
// Meta chỉ nhận sự kiện trong 7 ngày gần nhất (trừ cửa hàng) → quá hạn thì đánh dấu, không gửi.
// Chế độ thử: có mã test_event_code thì sự kiện chỉ hiện ở tab "Kiểm tra sự kiện", KHÔNG tính vào số liệu.

import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"
import type { Company } from "@/lib/case/types"
import { keyOf, type RealOrder } from "@/lib/conversions/real-orders"
import { sha256 } from "@/lib/leads/quality"

export const META_EVENT_NAME = "DonThanhToanOdoo"
export const META_MAX_AGE_DAYS = 7
export const META_MAX_ATTEMPTS = 3
const KEEP = 20_000
/** Quốc gia (ISO 2 chữ thường, băm) — mọi khách MBI là Việt Nam; tăng tỉ lệ khớp. */
const COUNTRY_VN = sha256("vn")
const DIR = path.join(process.cwd(), "data", "real-orders")
const file = (co: Company) => path.join(DIR, `${co}-meta.json`)

export interface MetaQueued {
  key: string; orderId: number | string; time: string; value: number; em?: string; ph?: string
  /** Đợt 19-0: nguồn không phải Odoo có thể gửi kèm. fbc/fbp KHÔNG băm (Meta quy định). */
  currency?: string; fbc?: string; fbp?: string
  status: "pending" | "sent" | "test_sent" | "failed" | "expired"; attempts: number; error?: string; sentAt?: string; receivedAt: string
}

export function readMetaQueue(co: Company): MetaQueued[] { try { return JSON.parse(fs.readFileSync(file(co), "utf-8")) as MetaQueued[] } catch { return [] } }

/** Đơn không có email lẫn SĐT thì Meta không khớp được ai — không xếp hàng. */
export function toQueued(r: RealOrder, now: Date): MetaQueued | null {
  if (!r.meta.em && !r.meta.ph && !r.fbc) return null
  return { key: keyOf(r), orderId: r.orderId, time: r.time, value: r.value, em: r.meta.em, ph: r.meta.ph, ...(r.currency && r.currency !== "VND" ? { currency: r.currency } : {}), ...(r.fbc ? { fbc: r.fbc } : {}), ...(r.fbp ? { fbp: r.fbp } : {}), status: "pending", attempts: 0, receivedAt: now.toISOString() }
}

export const tooOld = (q: Pick<MetaQueued, "time">, now: Date) => now.getTime() - new Date(q.time).getTime() > (META_MAX_AGE_DAYS * 24 - 1) * 3600_000

/** Một sự kiện theo khuôn /{pixel}/events. */
export function buildMetaEvent(q: MetaQueued): Record<string, unknown> {
  return {
    event_name: META_EVENT_NAME,
    event_time: Math.floor(new Date(q.time).getTime() / 1000),
    event_id: q.key,
    action_source: "system_generated",
    user_data: { ...(q.em ? { em: [q.em] } : {}), ...(q.ph ? { ph: [q.ph] } : {}), ...(q.fbc ? { fbc: q.fbc } : {}), ...(q.fbp ? { fbp: q.fbp } : {}), country: [COUNTRY_VN] },
    custom_data: { value: q.value, currency: q.currency ?? "VND", order_id: String(q.orderId) },
  }
}

/** Gộp đơn mới vào hàng đợi (trùng khoá bỏ qua). Trả số mới thêm. */
export async function enqueue(co: Company, rows: RealOrder[], now: Date): Promise<{ added: number; noContact: number }> {
  const fresh = rows.map((r) => toQueued(r, now))
  const noContact = fresh.filter((x) => !x).length
  return withFileLock(file(co), async () => {
    const cur = readMetaQueue(co)
    const seen = new Set(cur.map((q) => q.key))
    const add = fresh.filter((q): q is MetaQueued => !!q && !tooOld(q, now) && !seen.has(q.key) && (seen.add(q.key), true))
    fs.mkdirSync(DIR, { recursive: true })
    writeFileAtomicSync(file(co), JSON.stringify([...cur, ...add].slice(-KEEP)))
    return { added: add.length, noContact }
  })
}

export interface SendResult { sent: number; received: number; failed: number; expired: number; test: boolean; errors: string[] }
type Poster = (pixelId: string, body: Record<string, unknown>) => Promise<{ events_received?: number; error?: { message?: string; code?: number } }>

async function livePost(pixelId: string, body: Record<string, unknown>) {
  const { graphFetch } = await import("@/lib/meta-client")
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error("Thiếu META_ACCESS_TOKEN")
  const res = await graphFetch(`${META_GRAPH_BASE}/${pixelId}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }) })
  return (await res.json()) as { events_received?: number; error?: { message?: string; code?: number } }
}

const scrub = (s: string) => s.replace(/access_token=[^&\s]+/g, "access_token=***").slice(0, 300)

/**
 * Gửi hàng đợi. testEventCode có → chỉ vào tab thử, đánh dấu `test_sent` (khi tắt chế độ thử, các sự kiện CHƯA gửi thật
 * vẫn còn — test_sent được gửi lại thật nếu còn trong 7 ngày).
 */
export async function sendQueue(co: Company, pixelId: string, opts: { testEventCode?: string; now?: Date; post?: Poster; limit?: number } = {}): Promise<SendResult> {
  const now = opts.now ?? new Date()
  const post = opts.post ?? livePost
  const test = !!opts.testEventCode
  return withFileLock(file(co), async () => {
    const q = readMetaQueue(co)
    const out: SendResult = { sent: 0, received: 0, failed: 0, expired: 0, test, errors: [] }
    for (const x of q) if ((x.status === "pending" || x.status === "failed" || x.status === "test_sent") && tooOld(x, now)) { x.status = "expired"; out.expired++ }
    const want = (x: MetaQueued) => x.status === "pending" || (x.status === "failed" && x.attempts < META_MAX_ATTEMPTS) || (!test && x.status === "test_sent")
    const todo = q.filter(want).slice(0, opts.limit ?? 1000)
    for (let i = 0; i < todo.length; i += 500) {
      const chunk = todo.slice(i, i + 500)
      out.sent += chunk.length
      let r: Awaited<ReturnType<Poster>>
      try { r = await post(pixelId, { data: chunk.map(buildMetaEvent), ...(test ? { test_event_code: opts.testEventCode } : {}) }) } catch (e) { r = { error: { message: e instanceof Error ? e.message : String(e) } } }
      if (r.error || !(Number(r.events_received) >= 0)) {
        const msg = scrub(r.error?.message ?? "Meta không trả events_received")
        if (out.errors.length < 5) out.errors.push(msg)
        for (const x of chunk) { x.attempts++; x.status = "failed"; x.error = msg }
        out.failed += chunk.length
        continue
      }
      out.received += Number(r.events_received)
      for (const x of chunk) { x.attempts++; x.status = test ? "test_sent" : "sent"; x.error = undefined; x.sentAt = now.toISOString() }
    }
    writeFileAtomicSync(file(co), JSON.stringify(q))
    return out
  })
}

export function metaQueueStats(co: Company) {
  const q = readMetaQueue(co)
  const by: Record<MetaQueued["status"], number> = { pending: 0, sent: 0, test_sent: 0, failed: 0, expired: 0 }
  for (const x of q) by[x.status]++
  const last = q.filter((x) => x.sentAt).sort((a, b) => (b.sentAt! > a.sentAt! ? 1 : -1))[0]
  return { total: q.length, byStatus: by, lastSentAt: last?.sentAt ?? null, lastErrors: [...new Set(q.filter((x) => x.status === "failed" && x.error).map((x) => x.error!))].slice(0, 3) }
}
