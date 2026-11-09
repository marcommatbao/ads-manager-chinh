// Dùng chung cho app/api/connect/*: chỉ chạy ở chế độ cổng, chỉ người sửa được khoá kết nối (super_admin).
import { NextResponse } from "next/server"
import { getCurrentUser, type SessionUser } from "@/lib/auth"
import { guardEditCredentials } from "@/lib/settings/guards"
import { GatewayError, gatewayEnabled } from "./gateway"

/** Trả user nếu được phép, ngược lại trả Response lỗi (404 khi không ở chế độ cổng — giống /api/setup/* khi tắt). */
export async function connectGuard(): Promise<{ user: SessionUser } | { res: NextResponse }> {
  if (!gatewayEnabled()) return { res: NextResponse.json({ error: "Không ở chế độ cổng kết nối" }, { status: 404 }) }
  const user = await getCurrentUser()
  if (!user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const guard = guardEditCredentials(user)
  if (guard) return { res: guard }
  return { user }
}

export function connectError(e: unknown): NextResponse {
  if (e instanceof GatewayError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 })
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
}

/** Trang quay về sau khi kết nối — chỉ 2 chỗ cố định (không nhận URL tuỳ ý). */
export function backPage(next: string | null | undefined): string {
  return next === "setup" ? "/setup" : "/settings"
}

export const NONCE_COOKIE = (provider: string) => `connect_nonce_${provider}`
export const NEXT_COOKIE = "connect_next"

/**
 * Địa chỉ công khai của bản cài để chuyển hướng trình duyệt. KHÔNG dùng req.nextUrl.origin: sau proxy (Vibe Host) nó là
 * http://0.0.0.0:3000 (đo 26/10). Thứ tự: APP_URL → X-Forwarded-Host/Proto → origin của yêu cầu.
 */
export function publicOrigin(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const app = (process.env.APP_URL ?? "").trim()
  if (app) {
    try { return new URL(app).origin } catch { /* sai dạng → bỏ qua */ }
  }
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  if (host && /^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "http" ? "http" : "https"
    return `${proto}://${host}`
  }
  return req.nextUrl.origin
}
