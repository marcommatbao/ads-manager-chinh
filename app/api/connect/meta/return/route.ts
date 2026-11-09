// GET /api/connect/meta/return — cổng chuyển trình duyệt về sau hộp thoại Facebook. Xác nhận bằng nonce (lib/connect/flow.ts),
// lưu mã kết nối, nạp token vào máy chủ ngay. Tài sản đã chọn trước đó được giữ — trang chọn tài sản kiểm lại.
import type { NextRequest } from "next/server"
import { returnConnect } from "@/lib/connect/flow"
import { syncMetaRuntime } from "@/lib/connect/meta-runtime"
import { readConnect, writeConnect } from "@/lib/connect/store"
import { writeAuditEntry } from "@/lib/settings/audit"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  return returnConnect(req, "meta", async (cid, user) => {
    const prev = readConnect()
    writeConnect({ ...prev, meta: { ...prev.meta, connectionId: cid, createdAt: new Date().toISOString(), createdBy: user.email } })
    await syncMetaRuntime()
    await writeAuditEntry("credentials_meta", user, "update", "gateway_connect", null, null, "ALL")
  })
}
