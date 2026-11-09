// POST /api/leads/quality/webhook?company=MBC — CRM bất kỳ gọi vào khi lead đổi giai đoạn (không cần đăng nhập).
// Header: Authorization: Bearer <khoá webhook tạo ở Cài đặt → Kết nối bổ sung / PMax → Thí nghiệm → Lead chất lượng>
// Body: {"events":[{"leadId":"L123","stage":"qualified|won|junk","time":"2026-09-28T10:00:00+07:00","gclid":"...","email":"...","phone":"...","value":5000000}]}
// Email/SĐT băm SHA-256 ngay khi nhận; không lưu bản thô. Trả số nhận / trùng / lỗi từng dòng + kết quả gửi Google.
import { NextRequest, NextResponse } from "next/server"
import { getClientIp, rateLimit } from "@/lib/rate-limit"
import { ingestEvents, MAX_EVENTS_PER_CALL, uploadPending, verifyWebhookSecret, type LeadEventInput } from "@/lib/leads/quality"
import { PmaxControlError } from "@/lib/pmax/controls"
import type { Company } from "@/lib/case/types"
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const co = request.nextUrl.searchParams.get("company")
  if (!isCompany(co)) return NextResponse.json({ success: false, error: "Công ty không có ở bản cài này" }, { status: 400 })
  const rl = await rateLimit(`lead-quality:${getClientIp(request)}`, 60, 60_000)
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Quá nhiều lần gọi — thử lại sau 1 phút" }, { status: 429 })
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? null
  if (!verifyWebhookSecret(co as Company, auth)) return NextResponse.json({ success: false, error: "Sai hoặc thiếu khoá webhook" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { events?: unknown } | unknown[] | null
  const events = Array.isArray(body) ? body : Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events : body && typeof body === "object" ? [body] : []
  if (!events.length) return NextResponse.json({ success: false, error: "Không có sự kiện nào" }, { status: 400 })
  if (events.length > MAX_EVENTS_PER_CALL) return NextResponse.json({ success: false, error: `Tối đa ${MAX_EVENTS_PER_CALL} sự kiện một lần` }, { status: 413 })
  try {
    const ingest = await ingestEvents(co as Company, events as LeadEventInput[], "webhook")
    // Gửi luôn; lỗi phía Google không làm hỏng việc NHẬN (job lead_quality_upload gửi lại).
    const upload = await uploadPending(co as Company).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
    return NextResponse.json({ success: true, ...ingest, upload })
  } catch (e) {
    if (e instanceof PmaxControlError) return NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status })
    return NextResponse.json({ success: false, error: "Lỗi máy chủ" }, { status: 500 })
  }
}
