// POST /api/oauth/authorize — người dùng (đã đăng nhập AdsCommand) bấm Đồng ý / Từ chối trên trang /oauth/authorize.
import { getCurrentUser } from "@/lib/auth"
import { hasPermission } from "@/lib/permissions"
import { issueCode, OAuthError, validateAuthorize, type AuthorizeParams } from "@/lib/mcp/oauth"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return new Response("Unauthorized", { status: 401 })
  const f = await req.formData()
  const p: AuthorizeParams = {
    clientId: String(f.get("client_id") ?? ""), redirectUri: String(f.get("redirect_uri") ?? ""), state: String(f.get("state") ?? ""),
    codeChallenge: String(f.get("code_challenge") ?? ""), method: String(f.get("code_challenge_method") ?? ""), responseType: String(f.get("response_type") ?? ""),
  }
  try { validateAuthorize(p) } catch (e) { return new Response(e instanceof OAuthError ? e.message : "invalid request", { status: 400 }) }
  const back = new URL(p.redirectUri)
  if (p.state) back.searchParams.set("state", p.state)
  if (f.get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied")
    return Response.redirect(back.toString(), 303)
  }
  // Mức Ghi chỉ khi vai trò có quyền sửa — chọn Ghi mà không có quyền thì hạ về Chỉ đọc.
  const mode = f.get("mode") === "write" && hasPermission(user.role, "can_edit") ? "write" : "read"
  back.searchParams.set("code", await issueCode(p, user.id, mode))
  return Response.redirect(back.toString(), 303)
}
