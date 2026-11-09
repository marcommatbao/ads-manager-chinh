// GET /api/system/request-headers — chẩn đoán proxy (chỉ super_admin): app nhận X-Forwarded-For thế nào, IP nào được
// dùng cho giới hạn đăng nhập. Dùng khi chuyển hạ tầng (Vibe Host) — xem docs/VIBEHOST-PROXY-CHECK.md. Không trả cookie.
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/permissions"
import { getClientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  if (!isSuperAdmin(user.role)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
  const h = (k: string) => request.headers.get(k)
  return NextResponse.json({
    success: true,
    xForwardedFor: h("x-forwarded-for"), xRealIp: h("x-real-ip"), xForwardedHost: h("x-forwarded-host"), xForwardedProto: h("x-forwarded-proto"),
    host: h("host"), cfConnectingIp: h("cf-connecting-ip"),
    trustedProxyHops: Number(process.env.TRUSTED_PROXY_HOPS) || 1,
    clientIpUsedForRateLimit: getClientIp(request),
  }, { headers: { "Cache-Control": "no-store" } })
}
