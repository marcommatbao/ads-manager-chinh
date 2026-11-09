// RFC 8414 — điểm cuối OAuth của AdsCommand cho MCP.
import { authorizationServerMetadata } from "@/lib/mcp/oauth-meta"

export const dynamic = "force-dynamic"
export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(req), { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } })
}
