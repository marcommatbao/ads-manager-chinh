// Địa chỉ công khai + tài liệu khai báo OAuth cho MCP (RFC 9728 / RFC 8414).
import { publicAppUrl } from "@/lib/app-url"

export function issuer(req: Request): string {
  return publicAppUrl() || new URL(req.url).origin
}

export function protectedResourceMetadata(req: Request) {
  const o = issuer(req)
  return { resource: `${o}/api/mcp`, authorization_servers: [o], bearer_methods_supported: ["header"], resource_name: "AdsCommand" }
}

export function authorizationServerMetadata(req: Request) {
  const o = issuer(req)
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    registration_endpoint: `${o}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  }
}
