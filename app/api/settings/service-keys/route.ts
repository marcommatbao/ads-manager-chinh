// GET  /api/settings/service-keys — khoá dịch vụ phụ (đã che) + nguồn (Cài đặt / biến môi trường / chưa có)
// POST /api/settings/service-keys — lưu ô nào gửi lên (bỏ qua ô còn dạng che ****). Chỉ người được sửa khoá (Super Admin).
// Đợt 24a: SerpApi, SearchAPI, Apify, Resend, bot Telegram KPI trước đây chỉ đặt được ở Coolify.
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { guardEditCredentials, guardViewCredentials } from "@/lib/settings/guards"
import { writeAuditEntry } from "@/lib/settings/audit"
import { parseServiceKeyInput, saveServiceKeys, serviceKeyStatus } from "@/lib/settings/service-keys"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const g = guardViewCredentials(user)
  if (g) return g
  return NextResponse.json({ ok: true, keys: serviceKeyStatus() })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const g = guardEditCredentials(user)
  if (g) return g
  const parsed = parseServiceKeyInput((await request.json().catch(() => ({}))) as Record<string, unknown>)
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  const names = Object.keys(parsed.patch)
  if (!names.length) return NextResponse.json({ ok: true, message: "Không có thay đổi mới nào để lưu.", keys: serviceKeyStatus() })
  let overriddenByEnv: string[]
  try { ({ overriddenByEnv } = await saveServiceKeys(parsed.patch)) }
  catch { return NextResponse.json({ ok: false, error: "Không đọc / giải mã được khoá đã lưu (khoá mã hoá DATA_ENCRYPTION_KEY đã đổi hoặc tệp hỏng) — KHÔNG ghi đè để khỏi mất các khoá khác. Liên hệ quản trị." }, { status: 500 }) }
  await writeAuditEntry("credentials_service_keys", user, "update", names.join(", "), null, null, "ALL")
  const message = overriddenByEnv.length
    ? `Đã lưu, nhưng biến môi trường trên máy chủ (${overriddenByEnv.join(", ")}) đang ưu tiên hơn — gỡ biến đó ở Coolify để khoá vừa lưu có tác dụng.`
    : "Đã lưu — có hiệu lực ngay, không cần deploy lại."
  return NextResponse.json({ ok: true, message, overriddenByEnv, keys: serviceKeyStatus() })
}
