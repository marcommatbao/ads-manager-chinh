// Dựng MCP server cho MỘT yêu cầu (không giữ phiên): công cụ đóng gói sẵn người dùng đã xác thực từ khoá.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpContext } from "./auth"
import { registerReadTools } from "./tools/read"
import { registerWriteTools } from "./tools/write"
import { registerLaunchTools } from "./tools/launch"

export const MCP_SERVER_NAME = "adscommand"

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: "1.0.0" },
    {
      instructions:
        "AdsCommand: Google Ads + Meta Ads management for this business. Always call list_companies first. " +
        "Amounts are in the ad account currency (usually VND). Dates are Vietnam time. " +
        "Read tools return real live data; prefer get_campaigns_over_target and get_today_inbox to find what matters, " +
        "then the X-ray tools for root causes, and get_change_history/get_playbook to see what worked before. " +
        "To change anything: call a propose_* tool (real dry run, nothing changes), show the user the summary, and only after they approve call apply_change with confirm=\"XAC NHAN\". Never apply without the user's explicit approval in this conversation.",
    },
  )
  registerReadTools(server, ctx)
  // Công cụ ghi luôn được liệt kê (Claude biết có thể làm gì); khoá Chỉ đọc / công tắc tắt → từ chối lúc gọi, nói rõ lý do.
  registerWriteTools(server, ctx)
  registerLaunchTools(server, ctx)
  return server
}
