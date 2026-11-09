// Khoá MCP → người dùng: vai trò + công ty lấy từ kho thành viên Y NHƯ đăng nhập (lib/auth.ts resolveSession):
// thành viên phải còn, đang hoạt động, email được phép đăng nhập, không đang bị buộc đổi mật khẩu.
import type { SessionUser } from "@/lib/auth"
import { isAllowedLoginEmail } from "@/lib/login-domain"
import { findKey, type McpKey } from "./store"

export interface McpContext { user: SessionUser; key: McpKey }

export type McpAuthResult = { ok: true; ctx: McpContext } | { ok: false; status: 401 | 403; error: string }

export async function authenticateMcp(authorization: string | null): Promise<McpAuthResult> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")
  if (!m) return { ok: false, status: 401, error: "Thiếu khoá MCP (Authorization: Bearer mcpk_…)" }
  const key = findKey(m[1])
  if (!key) return { ok: false, status: 401, error: "Khoá MCP không hợp lệ hoặc đã bị thu hồi" }
  const { getMember } = await import("@/lib/team")
  const mem = await getMember(key.userId)
  if (!mem || !mem.is_active || mem.status !== "active" || !isAllowedLoginEmail(mem.email)) {
    return { ok: false, status: 403, error: "Người dùng của khoá này không còn hoạt động" }
  }
  if (mem.must_change_password) return { ok: false, status: 403, error: "Người dùng phải đổi mật khẩu trong AdsCommand trước khi dùng MCP" }
  const user: SessionUser = { id: mem.id, name: mem.name, email: mem.email, role: mem.role, companies: mem.company_access }
  return { ok: true, ctx: { user, key } }
}
