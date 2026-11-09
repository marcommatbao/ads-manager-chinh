// Đợt 19-0 — Nguồn đơn của công ty.
// GET  ?company=                                   — nguồn đang dùng, độ phủ 30 ngày + 10 đơn gần nhất (nguồn webhook/CSV; Odoo dùng "Xem trước")
// POST {company, op: "set", source, confirmText}   — đổi nguồn (cần XAC NHAN)
// POST {company, op: "secret"}                     — tạo khoá webhook mới (hiện ĐÚNG MỘT LẦN)
// POST {company, op: "csv", text}                  — tải CSV đơn (nguồn phải đang là CSV)
import { NextRequest, NextResponse } from "next/server"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { PmaxControlError } from "@/lib/pmax/controls"
import { coverage } from "@/lib/conversions/real-orders"
import { ingestOrders, maskRecent, MAX_ORDERS_PER_CALL, ORDER_SOURCES, orderSourceOf, orderSourceReason, parseOrderCsv, readStoredOrders, rotateOrderSecret, setOrderSource } from "@/lib/orders/sources"
import type { OrderSourceId } from "@/lib/conversions/real-orders"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
const MAX_CSV_BYTES = 2_000_000
const MAX_CSV_ROWS = MAX_ORDERS_PER_CALL * 20
const err = (e: unknown) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e))

export async function GET(request: NextRequest) {
  const u = await requireUser()
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"))
  if (!co.ok) return co.response
  try {
    const s = orderSourceOf(co.value)
    const stored = s && s.source !== "odoo" ? readStoredOrders(co.value).filter((o) => o.source === s.source) : []
    const since = new Date(Date.now() - 30 * 864e5).toISOString()
    const last30 = stored.filter((o) => o.time >= since)
    return NextResponse.json({
      success: true, sources: ORDER_SOURCES, reason: orderSourceReason(co.value),
      current: s ? { source: s.source, by: s.by ?? null, at: s.at ?? null, hasSecret: !!s.secretHash, secretCreatedAt: s.secretCreatedAt ?? null, lastPushAt: s.lastPushAt ?? null } : null,
      webhookPath: `/api/orders/webhook?company=${co.value}`,
      coverage30: s && s.source !== "odoo" ? coverage(last30) : null, recent: maskRecent(stored),
      canEdit: hasPermission(u.value.role, "can_edit"),
    })
  } catch (e) { return err(e) }
}

export async function POST(request: NextRequest) {
  const u = await requireUser("can_edit")
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as { company?: string; op?: string; source?: string; confirmText?: string; text?: string }
  const co = requireCompany(u.value, b.company)
  if (!co.ok) return co.response
  try {
    if (b.op === "set") return NextResponse.json({ success: true, current: await setOrderSource(co.value, String(b.source) as OrderSourceId, actorOf(u.value), b.confirmText) })
    if (b.op === "secret") return NextResponse.json({ success: true, secret: await rotateOrderSecret(co.value, b.confirmText) })
    if (b.op === "csv") {
      if (orderSourceOf(co.value)?.source !== "csv") return NextResponse.json({ success: false, error: "Nguồn đơn đang không phải CSV — đổi sang CSV trước" }, { status: 409 })
      const text = String(b.text ?? "")
      if (!text.trim()) return NextResponse.json({ success: false, error: "Tệp rỗng" }, { status: 400 })
      if (Buffer.byteLength(text) > MAX_CSV_BYTES) return NextResponse.json({ success: false, error: "Tệp quá 2MB — tách nhỏ" }, { status: 413 })
      const p = parseOrderCsv(text)
      if (p.errors.length) return NextResponse.json({ success: false, error: p.errors.join(" · ") }, { status: 400 })
      if (p.rows.length > MAX_CSV_ROWS) return NextResponse.json({ success: false, error: `Tối đa ${MAX_CSV_ROWS} dòng một tệp` }, { status: 413 })
      return NextResponse.json({ success: true, rows: p.rows.length, ...(await ingestOrders(co.value, p.rows, "csv")) })
    }
    return NextResponse.json({ success: false, error: "op không hợp lệ" }, { status: 400 })
  } catch (e) { return err(e) }
}
