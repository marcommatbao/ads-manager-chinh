// Bộ khung công cụ MCP: kiểm công ty / khoảng ngày như route giao diện (lib/case/http requireCompany + parseRange),
// trả JSON gọn, ghi nhật ký mỗi lần gọi (không ghi nội dung trả về), lỗi → isError có câu dễ hiểu.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { isCompany, companyIds } from "@/lib/companies"
import { canAccessCompany, getCompaniesForRole } from "@/lib/permissions"
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, parseRange } from "@/lib/case/dates"
import { appendAudit } from "../store"
import type { McpContext } from "../auth"

export class ToolError extends Error {}

export function requireCo(ctx: McpContext, company: unknown): string {
  if (!isCompany(company)) throw new ToolError(`Unknown company "${String(company)}". Use list_companies. Available: ${companyIds().join(", ")}`)
  if (!canAccessCompany(ctx.user, company)) throw new ToolError(`Your AdsCommand role has no access to company ${company}`)
  return company
}

export function allowedCompanies(ctx: McpContext): string[] {
  return getCompaniesForRole(ctx.user)
}

export function range(from?: string, to?: string) {
  const pr = parseRange(from ?? null, to ?? null, { defaultDays: DEFAULT_VIEW_DAYS, maxDays: MAX_RANGE_DAYS })
  if (!pr.ok) throw new ToolError(pr.error)
  return pr.range
}

/** Cắt danh sách dài để không tràn ngữ cảnh của Claude — và NÓI RA là đã cắt. */
export function top<T>(rows: T[], n: number, key?: (r: T) => number): { items: T[]; total: number; truncated: boolean } {
  const sorted = key ? [...rows].sort((a, b) => key(b) - key(a)) : rows
  return { items: sorted.slice(0, n), total: rows.length, truncated: rows.length > n }
}

const json = (v: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(v) }] })

/** Audit metadata only: never persist credentials, URLs with query secrets, or unbounded payloads. */
function auditArgs(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]"
  if (typeof value === "string") {
    try {
      const u = new URL(value)
      u.search = u.search ? "[redacted]" : ""
      u.hash = ""
      return u.toString().slice(0, 500)
    } catch {
      return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value
    }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => auditArgs(v, depth + 1))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      if (/token|secret|password|authorization|cookie|api[_-]?key/i.test(k)) out[k] = "[redacted]"
      else out[k] = auditArgs(v, depth + 1)
    }
    return out
  }
  return value
}

/** Bọc thân công cụ: nhật ký + bắt lỗi. write=true chỉ đặt cho lần GHI THẬT thành công (đếm trần ghi/ngày). */
export function run<A>(ctx: McpContext, tool: string, fn: (args: A) => Promise<unknown>, opts: { isWrite?: (out: unknown) => boolean } = {}) {
  return async (args: A): Promise<CallToolResult> => {
    const t0 = Date.now()
    try {
      const out = await fn(args)
      await appendAudit({ at: new Date().toISOString(), keyId: ctx.key.id, userId: ctx.user.id, tool, args: auditArgs(args), ok: true, ms: Date.now() - t0, ...(opts.isWrite?.(out) ? { write: true } : {}) })
      return json(out)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await appendAudit({ at: new Date().toISOString(), keyId: ctx.key.id, userId: ctx.user.id, tool, args: auditArgs(args), ok: false, ms: Date.now() - t0, error: msg.slice(0, 300) })
      return { isError: true, content: [{ type: "text", text: e instanceof ToolError ? msg : `AdsCommand error: ${msg}` }] }
    }
  }
}
