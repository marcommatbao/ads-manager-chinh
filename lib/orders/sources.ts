// ============================================================
// Đợt 19-0 — Nguồn đơn dùng chung (Odoo / Webhook / CSV)
// ============================================================
// User 02/10: "khách không dùng Odoo thì tính năng đơn thật có cần không — xây cấu hình cơ bản để nối Odoo HAY bên thứ 3".
// Mọi tính năng đơn thật (Đợt 16 gửi Google/Meta, 19b–19d) đọc qua readOrders() → kiểu chung RealOrder; Odoo chỉ là một nguồn.
// - Odoo: đọc trực tiếp (chỉ MBI có danh sách từng đơn).
// - Webhook / CSV: đơn ĐẨY vào, lưu ở data/orders/<co>.json (đã băm email/SĐT — bản thô không lưu).
// Mỗi công ty MỘT nguồn chính tại một thời điểm (hai nguồn cùng lúc = đếm trùng đơn).
// Hàm THUẦN ở trên (test được), đọc/ghi tệp ở dưới.

import crypto from "crypto"
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { normalizeEmail, normalizePhone, parseLeadTime, sha256 } from "@/lib/leads/quality"
import { metaEmail, metaPhone, readPaidOrders, unsupportedReason, type OrderSourceId, type RealOrder } from "@/lib/conversions/real-orders"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import type { Company } from "@/lib/case/types"

export const ORDER_SOURCES: { id: OrderSourceId; label: string; hint: string }[] = [
  { id: "odoo", label: "Odoo", hint: "Đọc đơn đã thanh toán trực tiếp từ Odoo (hiện chỉ MBI có danh sách từng đơn). Không có gclid/fbc — khớp theo email/SĐT." },
  { id: "webhook", label: "Webhook", hint: "Web / trang thanh toán / CRM bất kỳ gọi vào khi đơn đã thanh toán. Gửi kèm gclid / fbc / utm thì Google/Meta khớp tốt nhất." },
  { id: "csv", label: "Tệp CSV", hint: "Xuất đơn từ hệ thống bất kỳ (Excel → CSV) rồi tải lên. Thủ công, nên tải ít nhất mỗi tuần." },
]
export const MAX_ORDERS_PER_CALL = 500
const KEEP = 20_000
const KEEP_DAYS = 120

// ── Chuẩn hoá (HÀM THUẦN) ──

export interface OrderInput {
  orderId?: unknown; time?: unknown; value?: unknown; currency?: unknown; status?: unknown; name?: unknown
  email?: unknown; phone?: unknown; gclid?: unknown; gbraid?: unknown; wbraid?: unknown; fbc?: unknown; fbp?: unknown
  utm_source?: unknown; utm_medium?: unknown; utm_campaign?: unknown; utm_content?: unknown; utm_term?: unknown; productGroup?: unknown
}
const txt = (v: unknown, max = 200) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "")
const clickId = (v: unknown) => { const s = txt(v, 300); return /^[A-Za-z0-9_\-.~]{10,300}$/.test(s) ? s : undefined }
const PAID = new Set(["paid", "da_thanh_toan", "thanh_toan", "completed", "complete", "success", "hoan_thanh", ""])
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")

/** Số tiền: 1250000 · "1.250.000" · "1,250,000" · "1.250.000 ₫" · "1250000.5" · "1,5" (phẩy thập phân) — HÀM THUẦN. */
export function parseAmount(v: unknown): number {
  if (typeof v === "number") return v
  const s = String(v ?? "").replace(/[\s₫đ]|VND|VNĐ/gi, "")
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""))
  if (/^\d+,\d{1,2}$/.test(s)) return Number(s.replace(",", "."))
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

/**
 * Một đơn đẩy vào → RealOrder. CHỈ nhận đơn đã thanh toán (status trống = đã thanh toán); đơn huỷ/hoàn trả bị bỏ.
 * Email/SĐT băm NGAY (cả kiểu Google lẫn kiểu Meta) — bản thô không đi tiếp. fbc/fbp giữ nguyên (Meta quy định không băm).
 */
export function toOrder(x: OrderInput, source: Exclude<OrderSourceId, "odoo">, now = new Date()): { order?: RealOrder; error?: string; skipped?: string } {
  const id = txt(x.orderId, 100)
  if (!id) return { error: "thiếu orderId" }
  const st = slug(txt(x.status, 40))
  if (!PAID.has(st)) return { skipped: `đơn ${id}: trạng thái "${txt(x.status, 30)}" — chỉ nhận đơn đã thanh toán` }
  const t = parseLeadTime(x.time)
  if (!t) return { error: `đơn ${id}: thời điểm (time) không hợp lệ — vd 2026-10-02T10:00:00+07:00 hoặc 02/10/2026 10:00 (giờ VN)` }
  if (t.getTime() > now.getTime() + 5 * 60_000) return { error: `đơn ${id}: thời điểm ở tương lai` }
  const value = parseAmount(x.value)
  if (!(value > 0)) return { error: `đơn ${id}: giá trị (value) phải > 0` }
  const cur = txt(x.currency, 3).toUpperCase() || "VND"
  if (!/^[A-Z]{3}$/.test(cur)) return { error: `đơn ${id}: currency không hợp lệ` }
  const email = txt(x.email, 200), phone = txt(x.phone, 40)
  const gE = email ? normalizeEmail(email) : null, gP = phone ? normalizePhone(phone) : null
  const mE = email ? metaEmail(email) : null, mP = phone ? metaPhone(phone) : null
  const utm = { source: txt(x.utm_source, 100) || undefined, medium: txt(x.utm_medium, 100) || undefined, campaign: txt(x.utm_campaign, 200) || undefined, content: txt(x.utm_content, 200) || undefined, term: txt(x.utm_term, 200) || undefined }
  const hasUtm = Object.values(utm).some(Boolean)
  const fbc = txt(x.fbc, 400), fbp = txt(x.fbp, 200)
  return {
    order: {
      orderId: id, name: txt(x.name, 100) || id, time: t.toISOString(), value: cur === "VND" ? Math.round(value) : Math.round(value * 100) / 100, currency: cur, source, key: `${source}-${id}`,
      google: { hashedEmail: gE ? sha256(gE) : undefined, hashedPhone: gP ? sha256(gP) : undefined },
      meta: { em: mE ? sha256(mE) : undefined, ph: mP ? sha256(mP) : undefined },
      ...(clickId(x.gclid) ? { gclid: clickId(x.gclid) } : {}), ...(clickId(x.gbraid) ? { gbraid: clickId(x.gbraid) } : {}), ...(clickId(x.wbraid) ? { wbraid: clickId(x.wbraid) } : {}),
      ...(/^fb\.\d\.\d+\./.test(fbc) ? { fbc } : {}), ...(/^fb\.\d\.\d+\./.test(fbp) ? { fbp } : {}),
      ...(hasUtm ? { utm } : {}), ...(txt(x.productGroup, 80) ? { productGroup: txt(x.productGroup, 80) } : {}),
    },
  }
}

/** CSV đơn: tiêu đề bắt buộc, cột theo tên (tiếng Việt / Anh, có dấu hay không), thứ tự tuỳ ý, dấu "," hoặc ";", ô có ngoặc kép. */
export function parseOrderCsv(text: string): { rows: OrderInput[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], errors: ["Tệp rỗng"] }
  const sep = lines[0].split(";").length > lines[0].split(",").length ? ";" : ","
  const cells = (l: string) => { const out: string[] = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch } else if (ch === '"') q = true; else if (ch === sep) { out.push(cur.trim()); cur = "" } else cur += ch } out.push(cur.trim()); return out }
  const head = cells(lines[0]).map(slug)
  const ALIAS: Record<keyof OrderInput, string[]> = {
    orderId: ["order_id", "orderid", "ma_don", "ma_don_hang", "so_don", "id", "order"], time: ["time", "paid_at", "ngay_thanh_toan", "thoi_gian", "ngay", "date", "datetime", "created_at"],
    value: ["value", "gia_tri", "doanh_thu", "tong_tien", "amount", "total", "thanh_tien"], currency: ["currency", "tien_te"], status: ["status", "trang_thai", "payment_status"], name: ["name", "ten_don"],
    email: ["email", "e_mail"], phone: ["phone", "sdt", "so_dien_thoai", "dien_thoai", "mobile"], gclid: ["gclid"], gbraid: ["gbraid"], wbraid: ["wbraid"], fbc: ["fbc", "_fbc"], fbp: ["fbp", "_fbp"],
    utm_source: ["utm_source"], utm_medium: ["utm_medium"], utm_campaign: ["utm_campaign"], utm_content: ["utm_content"], utm_term: ["utm_term"], productGroup: ["product_group", "nhom_san_pham", "san_pham"],
  }
  // Theo THỨ TỰ ƯU TIÊN tên cột (paid_at trước created_at, order_id trước id…), không theo thứ tự cột trong tệp.
  const pick = (names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i } return -1 }
  const idx = Object.fromEntries(Object.entries(ALIAS).map(([k, names]) => [k, pick(names)])) as Record<keyof OrderInput, number>
  const missing = (["orderId", "time", "value"] as const).filter((k) => idx[k] < 0)
  if (missing.length) return { rows: [], errors: [`Thiếu cột bắt buộc: ${missing.map((k) => ALIAS[k][0]).join(", ")} (vd order_id, paid_at, value)`] }
  const rows = lines.slice(1).map((l) => { const c = cells(l); return Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([k, i]) => [k, c[i]])) as OrderInput })
  return { rows, errors: [] }
}

// ── Cấu hình nguồn theo công ty ──

const CFG = path.join(process.cwd(), "data", "order-sources.json")
const DIR = path.join(process.cwd(), "data", "orders")
const store = (co: Company) => path.join(DIR, `${co}.json`)
export interface SourceConfig { source: OrderSourceId; by?: string; at?: string; secretHash?: string; secretCreatedAt?: string; lastPushAt?: string }
type AllCfg = Partial<Record<Company, SourceConfig>>
function readCfg(): AllCfg { try { return JSON.parse(fs.readFileSync(CFG, "utf-8")) as AllCfg } catch { return {} } }
async function updateCfg(co: Company, f: (c: SourceConfig | undefined) => SourceConfig): Promise<SourceConfig> {
  return withFileLock(CFG, async () => {
    const all = readCfg(); all[co] = f(all[co])
    fs.mkdirSync(path.dirname(CFG), { recursive: true }); writeFileAtomicSync(CFG, JSON.stringify(all, null, 1))
    return all[co]!
  })
}

/** Nguồn đang dùng. Chưa cấu hình: MBI mặc định Odoo (giữ hành vi Đợt 16), công ty khác = chưa có nguồn. */
export function orderSourceOf(co: Company): SourceConfig | null {
  return readCfg()[co] ?? (unsupportedReason(co) ? null : { source: "odoo" })
}
/** null = đọc được đơn; chuỗi = lý do (CHƯA CẤU HÌNH là việc cần làm, không phải sự cố). */
export function orderSourceReason(co: Company): string | null {
  const s = orderSourceOf(co)
  if (!s) return "Chưa chọn nguồn đơn — vào Đo lường → Đơn thật → Nguồn đơn (Odoo / Webhook / CSV)"
  return s.source === "odoo" ? unsupportedReason(co) : null
}

export async function setOrderSource(co: Company, source: OrderSourceId, actor: string, confirmText?: string): Promise<SourceConfig> {
  if (!ORDER_SOURCES.some((x) => x.id === source)) throw new PmaxControlError("Nguồn đơn không hợp lệ", 400)
  if (confirmText !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(`Gõ "${PMAX_CONFIRM_TEXT}" để đổi nguồn đơn`, 428)
  if (source === "odoo" && unsupportedReason(co)) throw new PmaxControlError(unsupportedReason(co)!, 400)
  // Đổi nguồn → BỎ khoá webhook cũ (soát bảo mật 03/10: webhook → csv → webhook làm khoá cũ — có thể đã lộ — sống lại).
  return updateCfg(co, (c) => {
    const keep = c?.source === source ? { secretHash: c.secretHash, secretCreatedAt: c.secretCreatedAt } : {}
    return { source, by: actor, at: new Date().toISOString(), ...keep, ...(c?.lastPushAt ? { lastPushAt: c.lastPushAt } : {}) }
  })
}

export async function rotateOrderSecret(co: Company, confirmText?: string): Promise<string> {
  // Chỉ khi nguồn ĐÃ là Webhook (đổi nguồn phải qua setOrderSource + XAC NHAN, không được đổi ngầm ở đây).
  if (orderSourceOf(co)?.source !== "webhook") throw new PmaxControlError("Đổi nguồn đơn sang Webhook trước rồi mới tạo khoá", 409)
  // Đã có khoá → tạo mới làm khoá ĐANG DÙNG hết hiệu lực ngay (web gửi đơn sẽ bị 401) → cần XAC NHAN.
  if (readCfg()[co]?.secretHash && confirmText !== PMAX_CONFIRM_TEXT) throw new PmaxControlError(`Đã có khoá đang dùng — gõ "${PMAX_CONFIRM_TEXT}" để thay (khoá cũ hết hiệu lực ngay)`, 428)
  const secret = `ord_${crypto.randomBytes(24).toString("base64url")}`
  await updateCfg(co, (c) => ({ ...(c ?? { source: "webhook" }), secretHash: sha256(secret), secretCreatedAt: new Date().toISOString() }))
  return secret
}
export function verifyOrderSecret(co: Company, presented: string | null): boolean {
  const h = readCfg()[co]?.secretHash
  if (!h || !presented) return false
  const a = Buffer.from(sha256(presented)), b = Buffer.from(h)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ── Kho đơn đẩy vào (webhook / CSV) ──

export function readStoredOrders(co: Company): RealOrder[] { try { return JSON.parse(fs.readFileSync(store(co), "utf-8")) as RealOrder[] } catch { return [] } }

export interface IngestResult { accepted: number; duplicates: number; skipped: number; errors: string[] }
/** Nhận đơn (trùng khoá → bỏ). Giữ 120 ngày / 20.000 đơn gần nhất. */
export async function ingestOrders(co: Company, inputs: OrderInput[], source: Exclude<OrderSourceId, "odoo">, now = new Date()): Promise<IngestResult> {
  const out: IngestResult = { accepted: 0, duplicates: 0, skipped: 0, errors: [] }
  const fresh: RealOrder[] = []
  for (const x of inputs) {
    const r = toOrder(x, source, now)
    if (r.error) { if (out.errors.length < 20) out.errors.push(r.error); continue }
    if (r.skipped) { out.skipped++; continue }
    fresh.push(r.order!)
  }
  await withFileLock(store(co), async () => {
    const cur = readStoredOrders(co).filter((o) => now.getTime() - new Date(o.time).getTime() <= KEEP_DAYS * 864e5)
    const seen = new Set(cur.map((o) => o.key))
    for (const o of fresh) { if (seen.has(o.key)) { out.duplicates++; continue } seen.add(o.key); cur.push(o); out.accepted++ }
    fs.mkdirSync(DIR, { recursive: true }); writeFileAtomicSync(store(co), JSON.stringify(cur.slice(-KEEP)))
  })
  if (out.accepted) await updateCfg(co, (c) => ({ ...(c ?? { source }), lastPushAt: now.toISOString() }))
  return out
}

// ── Đọc đơn — MỌI tính năng đơn thật gọi hàm này ──

export async function readOrders(co: Company, since: Date, until = new Date()): Promise<RealOrder[]> {
  const s = orderSourceOf(co)
  if (!s || orderSourceReason(co)) return []
  if (s.source === "odoo") return readPaidOrders(co, since, until)
  return readStoredOrders(co).filter((o) => o.source === s.source && o.time >= since.toISOString() && o.time <= until.toISOString())
}

/** 10 đơn gần nhất cho trang Nguồn đơn — KHÔNG có email/SĐT (chỉ cờ "có / không"). */
export function maskRecent(rows: RealOrder[], n = 10) {
  return [...rows].sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, n).map((r) => ({
    key: r.key ?? String(r.orderId), name: r.name, time: r.time, value: r.value, currency: r.currency ?? "VND",
    has: { email: !!r.google.hashedEmail, phone: !!r.google.hashedPhone, gclid: !!(r.gclid || r.gbraid || r.wbraid), fbc: !!r.fbc, utm: !!(r.utm?.source || r.utm?.campaign) },
  }))
}
