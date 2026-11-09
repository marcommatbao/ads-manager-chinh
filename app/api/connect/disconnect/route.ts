// POST /api/connect/disconnect { provider } — ngắt kết nối: cổng xoá token + thu hồi ở Google/Meta; bản cài xoá mã kết nối.
import { NextResponse, type NextRequest } from "next/server"
import { clearGatewayTokenCache, gatewayFetch, GatewayError } from "@/lib/connect/gateway"
import { readConnect, writeConnect } from "@/lib/connect/store"
import { connectError, connectGuard } from "@/lib/connect/route-kit"
import { syncMetaRuntime } from "@/lib/connect/meta-runtime"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const g = await connectGuard()
  if ("res" in g) return g.res
  const provider = ((await req.json().catch(() => ({}))) as { provider?: string }).provider
  if (provider !== "google" && provider !== "meta") return NextResponse.json({ error: "provider phải là google hoặc meta" }, { status: 400 })
  const conn = readConnect()
  const id = conn[provider]?.connectionId
  if (!id) return NextResponse.json({ ok: true, already: true })
  try {
    await gatewayFetch(`/api/v1/connections/${id}`, { method: "DELETE" })
  } catch (e) {
    // Cổng không còn kết nối này (đã bị thu hồi / thay) → vẫn xoá phía bản cài. Lỗi khác: báo, không xoá.
    if (!(e instanceof GatewayError && (e.status === 404 || e.code === "connection_missing"))) return connectError(e)
  }
  const next = { ...conn }
  delete next[provider]
  writeConnect(next)
  clearGatewayTokenCache()
  if (provider === "meta") await syncMetaRuntime() // gỡ token + tài khoản/Pixel/Trang khỏi máy chủ ngay
  await writeAuditEntry(provider === "google" ? "credentials_google" : "credentials_meta", g.user, "update", "gateway_disconnect", null, null, "ALL")
  return NextResponse.json({ ok: true })
}
