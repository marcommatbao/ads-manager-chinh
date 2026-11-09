// ============================================================
// Ghi qua MCP — giao thức hai bước (mini-spec MCP-GD1 mục 7):
//   propose_* → AdsCommand CHẠY THỬ thật + chụp "dấu vân tay" trạng thái hiện tại → trả đề xuất (sống 15 phút)
//   apply_change(proposal_id, "XAC NHAN") → kiểm lại mọi chốt + trạng thái chưa đổi → ghi đúng nội dung đã chạy thử.
// Đề xuất lưu ở data/mcp-proposals.json (giữ bản đã dùng 7 ngày để áp luật "1 lần đổi ngân sách / đối tượng / 24h").
// ============================================================
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomic } from "@/lib/fs-atomic"

export const PROPOSAL_TTL_MS = 15 * 60_000
export const CONFIRM_TEXT = "XAC NHAN"
export const BUDGET_MAX_CHANGE = 0.3
export const BUDGET_COOLDOWN_MS = 24 * 3600_000
const KEEP_USED_MS = 7 * 24 * 3600_000

export interface Proposal {
  id: string
  keyId: string
  userId: string
  kind: string
  company: string
  /** Đối tượng bị đổi, dạng "<nền tảng>:<loại>:<id>" — dùng cho luật 24h và hiển thị. */
  target: string
  /** Bảng trước → sau, ảnh hưởng, cách hoàn tác — đúng thứ Claude trình cho người dùng. */
  summary: Record<string, unknown>
  /** Tham số thực thi (chỉ máy chủ dùng). */
  payload: Record<string, unknown>
  /** Trạng thái lúc chạy thử; lúc áp mà khác → từ chối (ai đó đã sửa trong lúc chờ). */
  fingerprint: string
  createdAt: string
  expiresAt: string
  usedAt?: string
  result?: unknown
}

const FILE = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "mcp-proposals.json")
const read = (): Proposal[] => { try { return (JSON.parse(fs.readFileSync(FILE(), "utf8")) as { proposals: Proposal[] }).proposals } catch { return [] } }

async function mutate<T>(fn: (list: Proposal[]) => T): Promise<T> {
  return withFileLock(FILE(), async () => {
    const now = Date.now()
    const list = read().filter((p) => (p.usedAt ? now - Date.parse(p.usedAt) < KEEP_USED_MS : now - Date.parse(p.expiresAt) < KEEP_USED_MS))
    const out = fn(list)
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    await writeFileAtomic(FILE(), JSON.stringify({ proposals: list }))
    return out
  })
}

export async function saveProposal(p: Omit<Proposal, "id" | "createdAt" | "expiresAt">, now = Date.now()): Promise<Proposal> {
  const full: Proposal = { ...p, id: `prop_${crypto.randomBytes(9).toString("base64url")}`, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PROPOSAL_TTL_MS).toISOString() }
  await mutate((list) => { list.push(full) })
  return full
}

/** Lấy đề xuất để áp — kiểm khoá, hạn, đã dùng. Không đánh dấu dùng (làm sau khi ghi thành công). */
export function getProposalForApply(id: string, keyId: string, now = Date.now()): Proposal {
  const p = read().find((x) => x.id === id)
  if (!p || p.keyId !== keyId) throw new ProposalError("Proposal not found for this key — call the propose_* tool again")
  if (p.usedAt) throw new ProposalError("This proposal was already applied")
  if (Date.parse(p.expiresAt) <= now) throw new ProposalError("Proposal expired (15 minutes) — call the propose_* tool again so the dry run reflects current state")
  return p
}

export async function markUsed(id: string, result: unknown): Promise<void> {
  await mutate((list) => { const p = list.find((x) => x.id === id); if (p) { p.usedAt = new Date().toISOString(); p.result = result } })
}

/** Lần ghi ngân sách gần nhất (qua MCP) lên cùng đối tượng — luật 1 lần / 24h. */
export function lastBudgetChangeAt(target: string): number | null {
  const t = read().filter((p) => p.kind === "budget" && p.target === target && p.usedAt).map((p) => Date.parse(p.usedAt!))
  return t.length ? Math.max(...t) : null
}

export class ProposalError extends Error {}

/** Mọi đề xuất còn lưu (đã dùng ≤7 ngày) — để kiểm "chiến dịch này do Claude tạo" khi hoàn tác. */
export function listProposals(): Proposal[] { return read() }

/** Luật ngân sách: tối đa ±30% mỗi lần, 1 lần / đối tượng / 24h. Trả lý do từ chối hoặc null. */
export function budgetRuleViolation(current: number, next: number, target: string, now = Date.now()): string | null {
  if (!(current > 0)) return "Current budget unknown or zero — change it in AdsCommand/Ads Manager instead"
  if (!(next > 0)) return "New budget must be greater than zero"
  const change = (next - current) / current
  if (Math.abs(change) > BUDGET_MAX_CHANGE + 1e-9) {
    const lo = Math.ceil(current * (1 - BUDGET_MAX_CHANGE)), hi = Math.floor(current * (1 + BUDGET_MAX_CHANGE))
    return `Budget change ${Math.round(change * 100)}% exceeds the ±30% limit per change. Allowed range now: ${lo}–${hi}`
  }
  const last = lastBudgetChangeAt(target)
  if (last !== null && now - last < BUDGET_COOLDOWN_MS) {
    return `This budget was already changed via Claude at ${new Date(last).toISOString()} — wait 24h between changes (lets Google/Meta re-learn)`
  }
  return null
}
