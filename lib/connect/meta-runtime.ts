// ============================================================
// Chế độ cổng — Meta: đổ kết nối vào ĐÚNG các biến mà mã Meta đang đọc (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID,
// NEXT_PUBLIC_META_PIXEL_ID_<hậu tố>, NEXT_PUBLIC_META_PAGE_ID_<hậu tố>) — cùng cách trang Cài đặt → Meta đang làm khi dán khoá.
// Nhờ vậy 47 tệp gọi Meta không phải sửa, và bản Mắt Bão (không bật cổng) không bị đụng.
// Token Meta không hết hạn nhưng cổng chỉ cấp kèm hạn 1 giờ: xin lại định kỳ (bộ nhớ đệm token hết sau ~1 giờ thì cổng hỏi Meta token còn sống không);
// khách gỡ quyền ở Meta → cổng trả connection_missing → gỡ token khỏi process.env (mọi lệnh gọi Meta báo "chưa cấu hình").
// ============================================================
import { envSuffix } from "@/lib/settings/company-ids"
import { gatewayEnabled, GatewayError, getGatewayTokenFor } from "./gateway"
import { readConnect, type ConnectState } from "./store"

const REFRESH_MS = 20 * 60_000
const PIXEL = "NEXT_PUBLIC_META_PIXEL_ID", PAGE = "NEXT_PUBLIC_META_PAGE_ID"
/** Biến công ty do chính lớp này đặt — để gỡ đúng cái mình đặt khi khách đổi lựa chọn / ngắt kết nối. */
const owned = new Set<string>()

/** Đặt / gỡ biến định danh (tài khoản, Pixel, Trang) theo data/connect.json. Không đụng token. */
export function applyMetaIds(state: ConnectState = readConnect(), env: NodeJS.ProcessEnv = process.env): void {
  if (!gatewayEnabled()) return
  const m = state.meta
  if (m?.adAccount?.id) env.META_AD_ACCOUNT_ID = m.adAccount.id
  else delete env.META_AD_ACCOUNT_ID
  const want = new Map<string, string>()
  for (const [co, v] of Object.entries(m?.companies ?? {})) {
    if (v.pixelId) want.set(`${PIXEL}_${envSuffix(co)}`, v.pixelId)
    if (v.pageId) want.set(`${PAGE}_${envSuffix(co)}`, v.pageId)
  }
  for (const k of owned) if (!want.has(k)) { delete env[k]; owned.delete(k) }
  for (const [k, v] of want) { env[k] = v; owned.add(k) }
}

/** Xin token từ cổng → META_ACCESS_TOKEN. Chưa kết nối / kết nối chết → gỡ biến. Lỗi tạm (mạng) → giữ token cũ. */
export async function refreshMetaToken(env: NodeJS.ProcessEnv = process.env): Promise<"ok" | "none" | "dead" | "error"> {
  if (!gatewayEnabled()) return "none"
  const cid = readConnect().meta?.connectionId
  if (!cid) { delete env.META_ACCESS_TOKEN; return "none" }
  try {
    env.META_ACCESS_TOKEN = await getGatewayTokenFor(cid)
    return "ok"
  } catch (e) {
    if (e instanceof GatewayError && ["connection_missing", "install_revoked", "install_suspended", "unauthorized"].includes(e.code)) {
      delete env.META_ACCESS_TOKEN
      console.warn(`[connect.meta] Kết nối Meta không còn dùng được (${e.code}) — đã gỡ token; vào Cài đặt bấm kết nối lại.`)
      return "dead"
    }
    console.error("[connect.meta] Không xin được token Meta từ cổng:", e instanceof Error ? e.message : e)
    return "error"
  }
}

/** Gọi sau mỗi lần đổi data/connect.json phần Meta (kết nối, chọn tài sản, ngắt). */
export async function syncMetaRuntime(): Promise<void> {
  applyMetaIds()
  await refreshMetaToken()
}

let timer: ReturnType<typeof setInterval> | null = null

/** Khởi động (instrumentation.node.ts): nạp một lần + làm mới định kỳ. Bản không bật cổng: không làm gì. */
export async function startMetaRuntime(): Promise<void> {
  if (!gatewayEnabled() || timer) return
  await syncMetaRuntime()
  timer = setInterval(() => { void refreshMetaToken() }, REFRESH_MS)
  timer.unref?.()
}
