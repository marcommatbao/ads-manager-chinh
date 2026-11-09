// MCP cho Claude (task #7142, docs/mini-specs/MCP-GD1.md): Streamable HTTP, không giữ phiên — mỗi yêu cầu mang
// Authorization: Bearer mcpk_… (khoá tạo ở Cài đặt → Kết nối Claude). Không dùng cookie đăng nhập.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { authenticateMcp } from "@/lib/mcp/auth"
import { buildMcpServer } from "@/lib/mcp/server"
import { rateLimited, touchKey } from "@/lib/mcp/store"
import { issuer } from "@/lib/mcp/oauth-meta"

export const dynamic = "force-dynamic"
export const maxDuration = 120

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, { status, headers: { "Cache-Control": "no-store", ...headers } })

async function handle(req: Request): Promise<Response> {
  const auth = await authenticateMcp(req.headers.get("authorization"))
  // RFC 9728: chỉ cho client (claude.ai) chỗ tìm máy chủ OAuth.
  if (!auth.ok) return jsonRpcError(auth.status, auth.error, auth.status === 401 ? { "WWW-Authenticate": `Bearer realm="adscommand-mcp", resource_metadata="${issuer(req)}/.well-known/oauth-protected-resource"` } : {})
  if (rateLimited(auth.ctx.key.id)) return jsonRpcError(429, "Quá 60 lượt/phút cho khoá này — thử lại sau ít giây", { "Retry-After": "30" })
  void touchKey(auth.ctx.key.id)
  const server = buildMcpServer(auth.ctx)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(req)
  } finally {
    void server.close()
  }
}

export const POST = handle
export const GET = handle
export const DELETE = handle
