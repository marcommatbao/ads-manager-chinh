// ============================================================
// "Biến X có chưa" cho cả hai chế độ. Chế độ cổng không có khoá Google/Meta trong môi trường — khoá nằm ở Cổng kết nối
// Mắt Bão — nên các chỗ kiểm "đã cấu hình" (preflight job, sức khoẻ kết nối, /api/status) phải coi khoá là có khi
// đã kết nối nhà cung cấp đó qua cổng. Chế độ dán khoá (bản Mắt Bão): y như cũ — chỉ xem process.env.
// ============================================================
import { gatewayEnabled } from "./gateway"
import { readConnect } from "./store"

const VIA_GATEWAY: Record<string, "google" | "meta"> = {
  GOOGLE_ADS_CLIENT_ID: "google",
  GOOGLE_ADS_CLIENT_SECRET: "google",
  GOOGLE_ADS_REFRESH_TOKEN: "google",
  GOOGLE_ADS_DEVELOPER_TOKEN: "google",
  META_ACCESS_TOKEN: "meta",
  META_APP_ID: "meta",
  META_APP_SECRET: "meta",
}

export function envSatisfied(name: string): boolean {
  if ((process.env[name] ?? "").trim()) return true
  const provider = VIA_GATEWAY[name]
  if (!provider || !gatewayEnabled()) return false
  return !!readConnect()[provider]?.connectionId
}
