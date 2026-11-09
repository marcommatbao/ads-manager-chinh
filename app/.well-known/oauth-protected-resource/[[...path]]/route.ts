// RFC 9728 — Claude tìm máy chủ uỷ quyền của /api/mcp ở đây (cả dạng có hậu tố đường dẫn /.well-known/…/api/mcp).
import { protectedResourceMetadata } from "@/lib/mcp/oauth-meta"

export const dynamic = "force-dynamic"
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(req), { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } })
}
