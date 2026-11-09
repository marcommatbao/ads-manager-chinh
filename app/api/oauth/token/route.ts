// POST /api/oauth/token — đổi mã uỷ quyền (PKCE) lấy khoá MCP. Nhận form-urlencoded (chuẩn) hoặc JSON.
import { exchangeCode, OAuthError } from "@/lib/mcp/oauth"

export const dynamic = "force-dynamic"
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", Pragma: "no-cache" }

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? ""
  const raw = ct.includes("application/json") ? ((await req.json().catch(() => ({}))) as Record<string, string>) : Object.fromEntries(new URLSearchParams(await req.text()))
  try {
    if (raw.grant_type !== "authorization_code") throw new OAuthError("unsupported_grant_type", "only authorization_code")
    const r = await exchangeCode({ code: String(raw.code ?? ""), clientId: String(raw.client_id ?? ""), redirectUri: String(raw.redirect_uri ?? ""), verifier: String(raw.code_verifier ?? "") })
    return Response.json({ access_token: r.accessToken, token_type: "Bearer", scope: r.mode === "write" ? "mcp mcp:write" : "mcp" }, { headers: cors })
  } catch (e) {
    const err = e instanceof OAuthError ? e : new OAuthError("server_error", String(e), 500)
    return Response.json({ error: err.code, error_description: err.message }, { status: err.status, headers: cors })
  }
}
export function OPTIONS() { return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" } }) }
