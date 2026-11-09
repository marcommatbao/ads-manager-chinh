// ============================================================
// Đợt 16 — Đồng bộ đơn thật: cài đặt bật/tắt + một lượt chạy
// ============================================================
// MẶC ĐỊNH TẮT cả hai nền tảng. Bật cần gõ XAC NHAN (cùng khuôn mọi thao tác ghi lên tài khoản quảng cáo).
// - Google: đưa đơn vào hàng "Lead chốt đơn" của Đợt 10c; job lead_quality_upload (mỗi giờ) gửi lên hành động PHỤ do tool
//   tạo → chưa đổi đặt giá cho tới khi người dùng tự đưa hành động đó vào mục tiêu.
// - Meta: sự kiện riêng DonThanhToanOdoo (không trùng Purchase của pixel). Có mã thử → chỉ vào tab Kiểm tra sự kiện.
// "Xem trước" chỉ đọc Odoo, không ghi gì — để biết bao nhiêu đơn / bao nhiêu phần trăm có email-SĐT trước khi bật.

import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import type { Company } from "@/lib/case/types"
import { makeT, type TFunction } from "@/lib/i18n/translate"
import { coverage, toGoogleInput, type Coverage, type RealOrder } from "@/lib/conversions/real-orders"
import { orderSourceOf, orderSourceReason, readOrders } from "@/lib/orders/sources"
import { enqueue, metaQueueStats, sendQueue, type SendResult } from "@/lib/conversions/meta-capi"

export const GOOGLE_LOOKBACK_DAYS = 30
export const META_LOOKBACK_DAYS = 7
const DIR = path.join(process.cwd(), "data", "real-orders")
const SETTINGS = path.join(DIR, "settings.json")

export interface Toggle { enabled: boolean; by?: string; at?: string }
export interface RealOrderSettings { google?: Toggle; meta?: Toggle & { testEventCode?: string; pixelId?: string } }
type All = Partial<Record<Company, RealOrderSettings>>

function readAll(): All { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf-8")) as All } catch { return {} } }
export const realOrderSettings = (co: Company): RealOrderSettings => readAll()[co] ?? {}

export interface SetInput { platform: "google" | "meta"; enabled: boolean; confirmText?: string; testEventCode?: string | null; actor: string }

/** Bật cần XAC NHAN; tắt thì không. Mã thử Meta chỉ chữ-số (Meta cấp dạng TEST12345). */
export async function setRealOrderToggle(co: Company, x: SetInput, now = new Date(), t: TFunction = makeT("vi")): Promise<RealOrderSettings> {
  const why = orderSourceReason(co)
  if (why && x.enabled) throw new PmaxControlError(why, 400)
  if (x.enabled && x.confirmText !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(t("libmeta.cv.s.typeConfirm", { text: PMAX_CONFIRM_TEXT }), 428)
  if (x.testEventCode != null && x.testEventCode !== "" && !/^[A-Za-z0-9]{4,40}$/.test(x.testEventCode)) throw new PmaxControlError(t("libmeta.cv.s.badTestCode"), 400)
  return withFileLock(SETTINGS, async () => {
    const all = readAll()
    const s = all[co] ?? {}
    const t: Toggle = { enabled: x.enabled, by: x.actor, at: now.toISOString() }
    if (x.platform === "google") s.google = t
    else s.meta = { ...s.meta, ...t, ...(x.testEventCode !== undefined ? { testEventCode: x.testEventCode || undefined } : {}) }
    all[co] = s
    fs.mkdirSync(DIR, { recursive: true })
    writeFileAtomicSync(SETTINGS, JSON.stringify(all, null, 1))
    return s
  })
}

async function pixelFor(co: Company, s: RealOrderSettings): Promise<string | null> {
  if (s.meta?.pixelId) return s.meta.pixelId
  const { metaAccountIds } = await import("@/lib/meta-accounts")
  const id = metaAccountIds(co).pixelId
  if (id) return id
  const { resolveCompanyPixelId } = await import("@/lib/meta-client")
  return (await resolveCompanyPixelId(co))?.id ?? null
}

export interface SyncResult {
  company: Company; unsupported?: string; preview: boolean
  coverage30: Coverage | null; coverage7: Coverage | null
  google: { enabled: boolean; accepted?: number; duplicates?: number; errors?: string[] }
  meta: { enabled: boolean; test: boolean; pixelId?: string | null; added?: number; noContact?: number; send?: SendResult; error?: string }
}

export interface SyncDeps { read?: (co: Company, since: Date, until: Date) => Promise<RealOrder[]>; ingest?: typeof import("@/lib/leads/quality").ingestEvents; send?: typeof sendQueue }

/** Một lượt: đọc đơn đã thu tiền 30 ngày → Google (nếu bật) + Meta 7 ngày (nếu bật). preview = chỉ đọc. */
export async function runRealOrderSync(co: Company, opts: { preview?: boolean; now?: Date; deps?: SyncDeps } = {}, t: TFunction = makeT("vi")): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const preview = !!opts.preview
  const s = realOrderSettings(co)
  const res: SyncResult = { company: co, preview, coverage30: null, coverage7: null, google: { enabled: !!s.google?.enabled }, meta: { enabled: !!s.meta?.enabled, test: !!s.meta?.testEventCode } }
  const why = orderSourceReason(co)
  if (why) return { ...res, unsupported: why }
  const read = opts.deps?.read ?? readOrders
  const rows = await read(co, new Date(now.getTime() - GOOGLE_LOOKBACK_DAYS * 864e5), now)
  const recent = rows.filter((r) => now.getTime() - new Date(r.time).getTime() <= META_LOOKBACK_DAYS * 864e5)
  res.coverage30 = coverage(rows)
  res.coverage7 = coverage(recent)
  if (preview) return res

  if (s.google?.enabled) {
    const ingest = opts.deps?.ingest ?? (await import("@/lib/leads/quality")).ingestEvents
    const acc = { accepted: 0, duplicates: 0, errors: [] as string[] }
    // Đơn chỉ có mã click (gclid/gbraid/wbraid — nguồn webhook) cũng khớp được: trước đây bị bỏ trong khi độ phủ đếm là "khớp được".
    const inputs = rows.filter((r) => r.google.hashedEmail || r.google.hashedPhone || r.gclid || r.gbraid || r.wbraid).map(toGoogleInput)
    for (let i = 0; i < inputs.length; i += 500) { const r = await ingest(co, inputs.slice(i, i + 500), orderSourceOf(co)?.source ?? "odoo"); acc.accepted += r.accepted; acc.duplicates += r.duplicates; acc.errors.push(...r.errors) }
    res.google = { enabled: true, ...acc, errors: acc.errors.slice(0, 5) }
  }
  if (s.meta?.enabled) {
    try {
      const pixelId = await pixelFor(co, s)
      res.meta.pixelId = pixelId
      if (!pixelId) res.meta.error = t("libmeta.cv.s.noPixel", { co })
      else {
        const q = await enqueue(co, recent, now)
        res.meta.added = q.added; res.meta.noContact = q.noContact
        res.meta.send = await (opts.deps?.send ?? sendQueue)(co, pixelId, { testEventCode: s.meta.testEventCode, now })
      }
    } catch (e) { res.meta.error = e instanceof Error ? e.message.slice(0, 300) : String(e) }
  }
  return res
}

export function realOrderStatus(co: Company) {
  return { settings: realOrderSettings(co), unsupported: orderSourceReason(co), source: orderSourceOf(co)?.source ?? null, meta: metaQueueStats(co), confirmText: PMAX_CONFIRM_TEXT }
}

/** Một dòng tóm tắt cho lịch sử job. */
export function summarize(r: SyncResult): string {
  if (r.unsupported) return `${r.company}: bỏ qua (${r.unsupported.split(" (")[0]})`
  const c = r.coverage30
  const parts = [`${r.company}: ${c?.orders ?? 0} đơn/30 ngày (${c?.matchable ?? 0} có email/SĐT)`]
  parts.push(r.google.enabled ? `Google +${r.google.accepted ?? 0} mới` : "Google tắt")
  parts.push(r.meta.enabled ? (r.meta.error ? `Meta lỗi: ${r.meta.error}` : `Meta${r.meta.test ? " (thử)" : ""} gửi ${r.meta.send?.sent ?? 0}, nhận ${r.meta.send?.received ?? 0}, lỗi ${r.meta.send?.failed ?? 0}`) : "Meta tắt")
  return parts.join(" · ")
}
