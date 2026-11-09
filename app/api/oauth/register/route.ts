// POST /api/oauth/register — RFC 7591 đăng ký client động (claude.ai / Claude Code tự gọi). Chỉ nhận redirect về Claude/localhost.
import { OAuthError, registerClient } from "@/lib/mcp/oauth"

export const dynamic = "force-dynamic"
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }

function reqIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const c = await registerClient(body, reqIp(req))
    return Response.json({ ...c, client_id_issued_at: Math.floor(Date.parse(c.createdAt) / 1000), token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, { status: 201, headers: cors })
  } catch (e) {
    const err = e instanceof OAuthError ? e : new OAuthError("invalid_client_metadata", String(e))
    return Response.json({ error: err.code, error_description: err.message }, { status: 400, headers: cors })
  }
}
export function OPTIONS() { return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" } }) }
