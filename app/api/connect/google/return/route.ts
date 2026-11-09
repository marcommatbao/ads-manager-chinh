// GET /api/connect/google/return?provider=google&ok=1&cid=…  (hoặc ok=0&reason=…) — cổng chuyển trình duyệt về đây.
// Xác nhận bằng nonce (lib/connect/flow.ts), lưu mã kết nối vào data/connect.json.
import type { NextRequest } from "next/server"
import { returnConnect } from "@/lib/connect/flow"
import { readConnect, writeConnect } from "@/lib/connect/store"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  return returnConnect(req, "google", async (cid, user) => {
    const prev = readConnect()
    // Giữ các tài khoản đã chọn — trang chọn tài khoản kiểm lại.
    writeConnect({ ...prev, google: { connectionId: cid, createdAt: new Date().toISOString(), createdBy: user.email, accounts: prev.google?.accounts ?? [] } })
    await writeAuditEntry("credentials_google", user, "update", "gateway_connect", null, null, "ALL")
  })
}
