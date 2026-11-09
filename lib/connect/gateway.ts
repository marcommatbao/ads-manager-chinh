// ============================================================
// Chế độ cổng (GATEWAY-CONNECT-1, task #6947): bản cài KHÔNG giữ khoá Google/Meta của Mắt Bão.
// Chỉ có MB_CONNECT_URL + MB_CONNECT_INSTALL_KEY; xin access token ngắn hạn từ Cổng kết nối Mắt Bão (mb-connect).
// Bản Mắt Bão không đặt 2 biến → gatewayEnabled() = false → mọi đường cũ (dán khoá) chạy y nguyên.
// ============================================================
import { readConnect, type ConnectProvider } from "./store"

export function gatewayConfig(): { url: string; key: string } | null {
  const url = (process.env.MB_CONNECT_URL ?? "").trim().replace(/\/+$/, "")
  const key = (process.env.MB_CONNECT_INSTALL_KEY ?? "").trim()
  return url && key ? { url, key } : null
}

export function gatewayEnabled(): boolean {
  return gatewayConfig() !== null
}

/** Chỉ đặt MỘT trong hai biến = cấu hình hỏng: báo lỗi lúc khởi động, không âm thầm rơi về chế độ dán khoá. */
export function gatewayHalfConfigured(): boolean {
  const u = !!(process.env.MB_CONNECT_URL ?? "").trim(), k = !!(process.env.MB_CONNECT_INSTALL_KEY ?? "").trim()
  return u !== k
}

/** Lỗi từ cổng, kèm mã ổn định (install_revoked, install_suspended, connection_missing, rate_limited…). */
export class GatewayError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
    this.name = "GatewayError"
  }
}

const FRIENDLY: Record<string, string> = {
  install_revoked: "Mắt Bão đã thu hồi kết nối của bản cài này — liên hệ Mắt Bão.",
  install_suspended: "Mắt Bão đã tạm ngưng kết nối của bản cài này — liên hệ Mắt Bão.",
  connection_missing: "Kết nối tài khoản quảng cáo không còn hiệu lực — vào Cài đặt bấm kết nối lại.",
  rate_limited: "Cổng kết nối đang giới hạn tần suất — thử lại sau ít phút.",
  unauthorized: "Khoá bản cài không hợp lệ (MB_CONNECT_INSTALL_KEY) — liên hệ Mắt Bão.",
  misconfigured: "Cổng kết nối Mắt Bão đang thiếu cấu hình — liên hệ Mắt Bão.",
}

export async function gatewayFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const cfg = gatewayConfig()
  if (!cfg) throw new GatewayError("not_configured", 0, "Chưa bật chế độ cổng (thiếu MB_CONNECT_URL / MB_CONNECT_INSTALL_KEY)")
  let res: Response
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { Authorization: `Bearer ${cfg.key}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    })
  } catch (e) {
    throw new GatewayError("unreachable", 0, `Không gọi được Cổng kết nối Mắt Bão: ${(e as Error).message}`)
  }
  let data: Record<string, unknown> = {}
  try { data = (await res.json()) as Record<string, unknown> } catch { /* thân rỗng */ }
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : `http_${res.status}`
    throw new GatewayError(code, res.status, FRIENDLY[code] ?? (typeof data.message === "string" ? data.message : `Cổng kết nối trả lỗi ${res.status}`))
  }
  return data as T
}

// ── Token ngắn hạn: cache theo kết nối, xin lại trước hạn 60 giây, nhiều lượt gọi cùng lúc chỉ xin MỘT lần ──
const REFRESH_EARLY_MS = 60_000
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
const inflight = new Map<string, Promise<string>>()

export function clearGatewayTokenCache(): void {
  tokenCache.clear()
  inflight.clear()
}

export async function getGatewayTokenFor(connectionId: string, now = Date.now()): Promise<string> {
  const c = tokenCache.get(connectionId)
  if (c && c.expiresAt - REFRESH_EARLY_MS > now) return c.accessToken
  let p = inflight.get(connectionId)
  if (!p) {
    p = (async () => {
      try {
        const r = await gatewayFetch<{ accessToken: string; expiresAt: string }>("/api/v1/token", { body: { connectionId } })
        tokenCache.set(connectionId, { accessToken: r.accessToken, expiresAt: Date.parse(r.expiresAt) || Date.now() + 3_000_000 })
        return r.accessToken
      } catch (e) {
        if (e instanceof GatewayError && (e.code === "connection_missing" || e.code === "install_revoked")) tokenCache.delete(connectionId)
        throw e
      } finally {
        inflight.delete(connectionId)
      }
    })()
    inflight.set(connectionId, p)
  }
  return p
}

/** Token của kết nối đang lưu cho nhà cung cấp. Chưa kết nối → GatewayError connection_missing. */
export async function getGatewayToken(provider: ConnectProvider): Promise<string> {
  const conn = readConnect()[provider]
  if (!conn?.connectionId) throw new GatewayError("connection_missing", 0, FRIENDLY.connection_missing)
  return getGatewayTokenFor(conn.connectionId)
}
