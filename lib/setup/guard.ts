// Đợt 21 A6 — cổng chung của /api/setup/*: bản cài KHÔNG bật trình thiết lập → 404 (bản Mắt Bão); chỉ super_admin.
import { NextResponse } from "next/server"
import { getCurrentUser, type SessionUser } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/permissions"
import { setupEnabled } from "./state"

export async function requireSetupAdmin(): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
  if (!setupEnabled()) return { ok: false, response: NextResponse.json({ success: false, error: "Bản cài này không bật trình thiết lập" }, { status: 404 }) }
  const user = await getCurrentUser()
  if (!user) return { ok: false, response: NextResponse.json({ success: false, error: "Chưa đăng nhập" }, { status: 401 }) }
  if (!isSuperAdmin(user.role)) return { ok: false, response: NextResponse.json({ success: false, error: "Chỉ quản trị cao nhất (Super Admin) được thiết lập" }, { status: 403 }) }
  return { ok: true, user }
}
