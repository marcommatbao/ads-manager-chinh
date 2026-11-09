// Đợt 19-0 — POST /api/orders/webhook?company=MBI — web / trang thanh toán / CRM bất kỳ gửi đơn ĐÃ THANH TOÁN (không cần đăng nhập).
// Header: Authorization: Bearer <khoá tạo ở Đo lường → Đơn thật → Nguồn đơn>
// Body: {"orders":[{"orderId":"WEB-1001","time":"2026-10-02T10:00:00+07:00","value":1250000,"email":"...","phone":"...",
//        "gclid":"...","fbc":"fb.1.1696...","utm_source":"google","utm_campaign":"..."}]}
// Email/SĐT băm SHA-256 ngay khi nhận; không lưu bản thô. Chỉ nhận khi nguồn đơn của công ty đang là Webhook.
import { NextRequest, NextResponse } from "next/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { ingestOrders, MAX_ORDERS_PER_CALL, orderSourceOf, verifyOrderSecret, type OrderInput } from "@/lib/orders/sources"
import type { Company } from "@/lib/case/types"
import { isCompany } from "@/lib/companies/registry";

export const dynamic = "force-dynamic"
export const maxDuration = 60
const MAX_BODY_BYTES = 1_000_000

export async function POST(request: NextRequest) {
  const co = request.nextUrl.searchParams.get("company")
  if (!isCompany(co)) return NextResponse.json({ success: false, error: "Công ty không có ở bản cài này" }, { status: 400 })
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? null
  // Lọc rẻ TRƯỚC bộ đếm tần suất (bộ đếm ghi tệp mỗi lần gọi): không có khoá đúng khuôn thì trả 401 luôn.
  if (!auth || !/^ord_[A-Za-z0-9_-]{30,40}$/.test(auth)) return NextResponse.json({ success: false, error: "Sai hoặc thiếu khoá webhook" }, { status: 401 })
  const rl = await rateLimit(`orders-webhook:${getClientIp(request)}`, 60, 60_000)
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Quá nhiều lần gọi — thử lại sau 1 phút" }, { status: 429 })
  if (!verifyOrderSecret(co as Company, auth)) return NextResponse.json({ success: false, error: "Sai hoặc thiếu khoá webhook" }, { status: 401 })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ success: false, error: "Nội dung quá 1MB — gửi ít đơn hơn mỗi lần" }, { status: 413 })
  // Nguồn khác đang bật → không nhận (đơn sẽ không được đọc = mất âm thầm; hai nguồn cùng lúc = đếm trùng).
  const src = orderSourceOf(co as Company)?.source
  if (src !== "webhook") return NextResponse.json({ success: false, error: `Nguồn đơn của ${co} đang là "${src ?? "chưa chọn"}" — đổi sang Webhook ở Đo lường → Đơn thật trước` }, { status: 409 })
  // content-length có thể thiếu / sai (chunked) → đếm lại sau khi đọc.
  const raw = await request.text().catch(() => "")
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ success: false, error: "Nội dung quá 1MB — gửi ít đơn hơn mỗi lần" }, { status: 413 })
  let body: { orders?: unknown } | unknown[] | null = null
  try { body = JSON.parse(raw) } catch { body = null }
  const orders = Array.isArray(body) ? body : Array.isArray((body as { orders?: unknown })?.orders) ? (body as { orders: unknown[] }).orders : body && typeof body === "object" ? [body] : []
  if (!orders.length) return NextResponse.json({ success: false, error: "Không có đơn nào" }, { status: 400 })
  if (orders.length > MAX_ORDERS_PER_CALL) return NextResponse.json({ success: false, error: `Tối đa ${MAX_ORDERS_PER_CALL} đơn một lần` }, { status: 413 })
  try {
    return NextResponse.json({ success: true, ...(await ingestOrders(co as Company, orders as OrderInput[], "webhook")) })
  } catch {
    return NextResponse.json({ success: false, error: "Lỗi máy chủ" }, { status: 500 })
  }
}
