// ============================================================
// Đợt 16 — Đơn THẬT (đã thu tiền trong Odoo) → Google & Meta
// ============================================================
// Vì sao: Google/Meta đang học theo số của chính nó (Meta MBC: 88% "mua hàng" là chỉ-xem; tCPA Search MBI gần như mù).
// Gửi lại đơn đã thu tiền để nền tảng học theo đơn thật.
//
// Nguồn: CHỈ MBI (sale.order Odoo, cùng định nghĩa đơn MBI với P&L: MBI_ORDER_DOMAIN + đã thanh toán). MBC hiện chỉ có SỐ TỔNG
// qua Report API — chưa có danh sách từng đơn nên chưa gửi được.
// Khoá khớp: Odoo KHÔNG giữ gclid/fbclid (kiểm mã 30/09) → khớp bằng email/SĐT BĂM (chuyển đổi nâng cao). Email/SĐT thô chỉ
// sống trong bộ nhớ lúc đọc; ra khỏi hàm này chỉ còn bản băm.
//
// Hàm THUẦN ở trên (test được), đọc Odoo thật ở cuối tệp.

import { MBI_ORDER_DOMAIN } from "@/lib/mbi-order-sources"
import { MKT_EXCLUDED_ORDER_TYPES, MKT_PAYMENT_STATES } from "@/lib/odoo-mkt-orders"
import { normalizeEmail, normalizePhone, sha256, type LeadEventInput } from "@/lib/leads/quality"
import type { Company } from "@/lib/case/types"

type M2o = [number, string] | false
export interface OdooPaidOrder { id: number; name: string; date_order: string; amount_untaxed: number; partner_id: M2o; opportunity_id?: M2o }
export interface OdooContact { id: number; email?: string | false; email_from?: string | false; phone?: string | false; mobile?: string | false }

/**
 * Một đơn đã chuẩn hoá — KIỂU ĐƠN CHUNG cho mọi nguồn (Đợt 19-0: Odoo / webhook / CSV). Chỉ còn bản băm.
 * Google và Meta băm KHÁC nhau (Google bỏ dấu chấm gmail, SĐT có "+").
 */
export type OrderSourceId = "odoo" | "webhook" | "csv"
export interface RealOrder {
  orderId: number | string; name: string; time: string; value: number
  google: { hashedEmail?: string; hashedPhone?: string }
  meta: { em?: string; ph?: string }
  /** Đợt 19-0. Thiếu = đơn Odoo cũ (khoá `odoo-so-<id>`). */
  source?: OrderSourceId; key?: string; currency?: string
  gclid?: string; gbraid?: string; wbraid?: string; fbc?: string; fbp?: string
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string }
  productGroup?: string
}

/** Odoo có danh sách TỪNG đơn chỉ cho MBI. Công ty khác dùng nguồn webhook / CSV (lib/orders). */
export const REAL_ORDER_COMPANIES: readonly Company[] = ["MBI"]
export const unsupportedReason = (co: Company): string | null =>
  REAL_ORDER_COMPANIES.includes(co) ? null : "Odoo chưa có danh sách từng đơn cho công ty này (Report API chỉ trả số tổng) — chọn nguồn đơn Webhook hoặc CSV"

/** Giờ Odoo lưu UTC, dạng "YYYY-MM-DD HH:MM:SS" không ghi múi giờ. */
export function odooUtc(s: string): Date | null {
  const t = new Date(`${String(s).trim().replace(" ", "T")}Z`)
  return Number.isNaN(t.getTime()) ? null : t
}
export const toOdooUtc = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19)

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** Meta: email chỉ trim + chữ thường (KHÔNG bỏ dấu chấm gmail); SĐT chỉ chữ số, có mã nước, không "+". */
export function metaEmail(raw: string): string | null { const e = raw.trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null }
export function metaPhone(raw: string): string | null { const p = normalizePhone(raw); return p ? p.slice(1) : null }

/** Ghép đơn + khách + lead → RealOrder. Ưu tiên liên hệ trên khách hàng, thiếu thì lấy từ lead gốc. */
export function toRealOrders(orders: OdooPaidOrder[], partners: OdooContact[], leads: OdooContact[] = []): RealOrder[] {
  const pById = new Map(partners.map((p) => [p.id, p]))
  const lById = new Map(leads.map((l) => [l.id, l]))
  const out: RealOrder[] = []
  for (const o of orders) {
    const t = odooUtc(o.date_order)
    if (!t || !(o.amount_untaxed > 0)) continue
    const p = o.partner_id ? pById.get(o.partner_id[0]) : undefined
    const l = o.opportunity_id ? lById.get(o.opportunity_id[0]) : undefined
    const email = str(p?.email) ?? str(l?.email_from)
    const phone = str(p?.mobile) ?? str(p?.phone) ?? str(l?.phone)
    const gE = email ? normalizeEmail(email) : null, gP = phone ? normalizePhone(phone) : null
    const mE = email ? metaEmail(email) : null, mP = phone ? metaPhone(phone) : null
    out.push({
      orderId: o.id, name: String(o.name ?? ""), time: t.toISOString(), value: Math.round(o.amount_untaxed), source: "odoo", key: orderKey(o.id), currency: "VND",
      google: { hashedEmail: gE ? sha256(gE) : undefined, hashedPhone: gP ? sha256(gP) : undefined },
      meta: { em: mE ? sha256(mE) : undefined, ph: mP ? sha256(mP) : undefined },
    })
  }
  return out
}

export interface Coverage { orders: number; value: number; withEmail: number; withPhone: number; matchable: number; withClickId: number; withFbc: number; withUtm: number }
/** matchable = Google khớp được (email/SĐT băm HOẶC mã click). */
export function coverage(rows: RealOrder[]): Coverage {
  const click = (r: RealOrder) => !!(r.gclid || r.gbraid || r.wbraid)
  return {
    orders: rows.length, value: rows.reduce((s, r) => s + r.value, 0),
    withEmail: rows.filter((r) => r.google.hashedEmail).length, withPhone: rows.filter((r) => r.google.hashedPhone).length,
    matchable: rows.filter((r) => r.google.hashedEmail || r.google.hashedPhone || click(r)).length,
    withClickId: rows.filter(click).length, withFbc: rows.filter((r) => r.fbc).length, withUtm: rows.filter((r) => r.utm?.source || r.utm?.campaign).length,
  }
}

/** Mã sự kiện chung cho cả hai nền tảng — Google chống trùng theo order_id, Meta theo event_id. */
export const orderKey = (orderId: number | string) => `odoo-so-${orderId}`
export const keyOf = (r: Pick<RealOrder, "key" | "orderId">) => r.key ?? orderKey(r.orderId)

/** Đơn → sự kiện "Lead chốt đơn" của luồng Đợt 10c (lib/leads/quality). Băm sẵn nên truyền qua trường đã băm. */
export function toGoogleInput(r: RealOrder): LeadEventInput & { hashedEmail?: string; hashedPhone?: string } {
  return { leadId: keyOf(r), stage: "won", time: r.time, value: r.value, currency: r.currency ?? "VND", hashedEmail: r.google.hashedEmail, hashedPhone: r.google.hashedPhone, ...(r.gclid ? { gclid: r.gclid } : {}), ...(r.gbraid ? { gbraid: r.gbraid } : {}), ...(r.wbraid ? { wbraid: r.wbraid } : {}) }
}

// ── Đọc Odoo thật ──

export async function readPaidOrders(co: Company, since: Date, until = new Date()): Promise<RealOrder[]> {
  if (unsupportedReason(co)) return []
  const { searchRead } = await import("@/lib/odoo-client")
  const domain: unknown[] = [
    ...MBI_ORDER_DOMAIN,
    ["type_id.name", "not in", MKT_EXCLUDED_ORDER_TYPES],
    ["invoice_ids.payment_state", "in", MKT_PAYMENT_STATES],
    ["amount_untaxed", ">=", 1],
    ["date_order", ">=", toOdooUtc(since)],
    ["date_order", "<=", toOdooUtc(until)],
  ]
  const orders = await searchRead<OdooPaidOrder>("sale.order", domain, ["id", "name", "date_order", "amount_untaxed", "partner_id", "opportunity_id"], { limit: 5000, order: "date_order desc" })
  const ids = (xs: M2o[]) => [...new Set(xs.filter((x): x is [number, string] => !!x).map((x) => x[0]))]
  const pIds = ids(orders.map((o) => o.partner_id)), lIds = ids(orders.map((o) => o.opportunity_id ?? false))
  const partners = pIds.length ? await searchRead<OdooContact>("res.partner", [["id", "in", pIds]], ["id", "email", "phone", "mobile"], { limit: pIds.length }) : []
  const leads = lIds.length ? await searchRead<OdooContact>("crm.lead", [["id", "in", lIds]], ["id", "email_from", "phone"], { limit: lIds.length }) : []
  return toRealOrders(orders, partners, leads)
}

