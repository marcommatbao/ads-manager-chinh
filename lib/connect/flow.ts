// ============================================================
// Bắt đầu / quay về một lượt kết nối qua cổng — dùng chung cho Google và Meta (app/api/connect/<provider>/{start,return}).
// Bắt đầu: sinh nonce (cookie HttpOnly trên miền bản cài) → gửi SHA-256 của nó cho cổng → sang trang trung gian của cổng.
// Quay về: chỉ trình duyệt có đúng nonce mới xác nhận được kết nối (mini-spec GATEWAY-CONNECT-1 §12A).
// ============================================================
import crypto from "crypto"
import { NextResponse, type NextRequest } from "next/server"
import type { SessionUser } from "@/lib/auth"
import { clearGatewayTokenCache, gatewayFetch } from "./gateway"
import { backPage, connectError, connectGuard, NEXT_COOKIE, NONCE_COOKIE, publicOrigin } from "./route-kit"
import type { ConnectProvider } from "./store"
import { defaultLocale, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config"

// Mã lý do ổn định gửi qua ?connect_error_code= — ConnectCard (client) dịch theo ngôn ngữ đang chọn (key connect.reason.*).
const REASON_CODES = ["cancelled", "access_denied", "scope_denied", "no_refresh_token", "session_mismatch", "install_inactive", "misconfigured", "provider_error"]

function reasonCode(reason: string): string {
  return REASON_CODES.includes(reason) ? reason : "provider_error"
}

export async function startConnect(req: NextRequest, provider: ConnectProvider): Promise<NextResponse> {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const nonce = crypto.randomBytes(32).toString("base64url")
  try {
    const { url } = await gatewayFetch<{ url: string }>("/api/v1/connect/start", {
      body: {
        provider,
        returnPath: `/api/connect/${provider}/return`,
        createdBy: g.user.email,
        // Song ngữ (#7135): trang trung gian của cổng + màn Google hiện đúng ngôn ngữ người bấm đang chọn (nút VI/EN).
        lang: (() => { const v = req.cookies.get(LOCALE_COOKIE)?.value; return isLocale(v) ? v : defaultLocale() })(),
        nonceHash: crypto.createHash("sha256").update(nonce).digest("hex"),
      },
    })
    const res = NextResponse.redirect(url, 303)
    const secure = process.env.NODE_ENV === "production"
    res.cookies.set(NONCE_COOKIE(provider), nonce, { httpOnly: true, sameSite: "lax", secure, path: "/api/connect", maxAge: 15 * 60 })
    res.cookies.set(NEXT_COOKIE, backPage(req.nextUrl.searchParams.get("next")) === "/setup" ? "setup" : "settings", { httpOnly: true, sameSite: "lax", secure, path: "/api/connect", maxAge: 15 * 60 })
    return res
  } catch (e) {
    return connectError(e)
  }
}

/** onConfirmed: ghi data/connect.json cho nhà cung cấp (kết nối mới thay kết nối cũ — cổng đã thu hồi cái cũ). */
export async function returnConnect(
  req: NextRequest,
  provider: ConnectProvider,
  onConfirmed: (cid: string, user: SessionUser) => Promise<void>,
): Promise<NextResponse> {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const q = req.nextUrl.searchParams
  const page = backPage(req.cookies.get(NEXT_COOKIE)?.value)
  const back = (params: Record<string, string>) => {
    const u = new URL(page, publicOrigin(req))
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    const res = NextResponse.redirect(u, 303)
    res.cookies.delete({ name: NONCE_COOKIE(provider), path: "/api/connect" })
    res.cookies.delete({ name: NEXT_COOKIE, path: "/api/connect" })
    return res
  }

  if (q.get("ok") !== "1") return back({ connect: provider, connect_error_code: reasonCode(q.get("reason") ?? "provider_error") })
  const cid = q.get("cid") ?? ""
  const nonce = req.cookies.get(NONCE_COOKIE(provider))?.value
  if (!/^c_[A-Za-z0-9_-]{12}$/.test(cid) || !nonce) return back({ connect: provider, connect_error_code: "session_mismatch" })

  try {
    await gatewayFetch(`/api/v1/connections/${cid}/confirm`, { body: { nonce } })
    clearGatewayTokenCache()
    await onConfirmed(cid, g.user)
  } catch (e) {
    return back({ connect: provider, connect_error: e instanceof Error ? e.message : String(e) })
  }
  return back({ connect: provider, connect_ok: "1" })
}
