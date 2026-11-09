// ============================================================
// Đợt 26c — Kho "tệp thắng" (data/winning-audiences.json)
// ============================================================
// Lưu NGUYÊN cấu hình nhắm chọn Meta của nhóm thắng (đã bỏ trường app không ghi được — writableTargeting) + bằng chứng
// lúc lưu (khoảng ngày, chi phí, số kết quả, so với nhóm nào). Lần sau tạo nhóm mới thì chép đúng cấu hình này.
// Tệp thắng cũng cạn dần → có hạn KIỂM LẠI (REVIEW_AFTER_DAYS) — quá hạn thì giao diện nhắc so lại trước khi dùng.
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { writableTargeting } from "@/lib/case/meta-placements"
import type { GoalKind } from "@/lib/case/goal-kind"
import type { CompareGroup, RankedAdset } from "./audience-compare"
import { targetingSummary } from "./winning-audiences-text"

export const REVIEW_AFTER_DAYS = 45

export interface WinningAudience {
  id: string
  name: string
  company: string
  goalKind: GoalKind
  note: string
  targeting: Record<string, unknown>
  /** Trường nhắm chọn bị bỏ vì app không ghi được (vd subscriber_universe) — nói rõ khi dùng lại. */
  droppedKeys: string[]
  summary: string
  source: { adsetId: string; adsetName: string; campaignId: string; campaignName: string; optEventLabel: string }
  evidence: {
    range: { from: string; to: string }
    verdict: CompareGroup["verdict"]
    spend: number; results: number; costPerResult: number | null; ctr: number | null; frequency: number | null
    comparedWith: { adsetName: string; campaignName: string; results: number; costPerResult: number | null }[]
    groupSummary: string
  }
  savedBy: string
  savedAt: string
  reviewBy: string
}

const FILE = () => path.join(process.cwd(), "data", "winning-audiences.json")
export function listWinning(company?: string): WinningAudience[] {
  try {
    const all = JSON.parse(fs.readFileSync(FILE(), "utf-8")) as WinningAudience[]
    return (Array.isArray(all) ? all : []).filter((w) => !company || w.company === company).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } catch { return [] }
}
export const getWinning = (id: string) => listWinning().find((w) => w.id === id) ?? null

export { targetingSummary } from "./winning-audiences-text"

export function buildWinning(input: { name: string; note: string; company: string; range: { from: string; to: string }; group: CompareGroup; row: RankedAdset; actor: string; now?: Date }): WinningAudience {
  const now = input.now ?? new Date()
  const { body, dropped } = writableTargeting(input.row.targeting as never)
  const r = input.row
  return {
    id: `wa_${crypto.randomBytes(6).toString("hex")}`, name: input.name.trim().slice(0, 120) || r.name, company: input.company, goalKind: input.group.goalKind,
    note: input.note.trim().slice(0, 500), targeting: body as Record<string, unknown>, droppedKeys: dropped, summary: targetingSummary(body as Record<string, unknown>),
    source: { adsetId: r.id, adsetName: r.name, campaignId: r.campaignId, campaignName: r.campaignName, optEventLabel: r.optEventLabel },
    evidence: {
      range: input.range, verdict: input.group.verdict, spend: Math.round(r.spend), results: r.results, costPerResult: r.costPerResult ? Math.round(r.costPerResult) : null,
      ctr: r.ctr, frequency: r.frequency, groupSummary: input.group.summary,
      comparedWith: input.group.rows.filter((x) => x.id !== r.id).map((x) => ({ adsetName: x.name, campaignName: x.campaignName, results: x.results, costPerResult: x.costPerResult ? Math.round(x.costPerResult) : null })),
    },
    savedBy: input.actor, savedAt: now.toISOString(), reviewBy: new Date(now.getTime() + REVIEW_AFTER_DAYS * 86_400_000).toISOString(),
  }
}

export async function saveWinning(w: WinningAudience): Promise<void> {
  await withFileLock(FILE(), async () => {
    const all = listWinning()
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    writeFileAtomicSync(FILE(), JSON.stringify([w, ...all.filter((x) => x.id !== w.id)], null, 1))
  })
}
export async function deleteWinning(id: string): Promise<boolean> {
  return withFileLock(FILE(), async () => {
    const all = listWinning()
    if (!all.some((x) => x.id === id)) return false
    writeFileAtomicSync(FILE(), JSON.stringify(all.filter((x) => x.id !== id), null, 1))
    return true
  })
}

/** Đợt 26 — khối "TỆP ĐÃ THẮNG" cho lời nhắc gợi ý đối tượng (Creative · Facebook). Chưa lưu tệp nào → "" (lời nhắc y như cũ).
 *  Chỉ số đo thật lúc lưu + nhắm chọn; tệp quá hạn kiểm lại thì ghi rõ để AI không coi là chắc chắn. */
export function winnersPromptBlock(company: string, now = new Date()): string {
  const rows = listWinning(company).slice(0, 5)
  if (!rows.length) return ""
  const word = (w: WinningAudience) => (w.goalKind === "leads" ? "lead" : "lượt mua")
  const lines = rows.map((w) => `- “${w.name}”: ${w.summary}. Đo ${w.evidence.range.from}→${w.evidence.range.to}: ${w.evidence.results} ${word(w)}${w.evidence.costPerResult ? `, ₫${w.evidence.costPerResult.toLocaleString("vi-VN")}/${word(w)}` : ""} (tool chấm: ${w.evidence.verdict === "winner" ? "thắng rõ" : "nghiêng về"})${Date.parse(w.reviewBy) < now.getTime() ? " — ĐÃ QUÁ HẠN KIỂM LẠI, có thể đã cạn" : ""}`)
  return `\n\nTỆP ĐỐI TƯỢNG ĐÃ THẮNG TRƯỚC ĐÂY (số Meta đo thật, lưu ở "So sánh tệp đối tượng"):\n${lines.join("\n")}\n` +
    `Cách dùng: đề xuất ít nhất 1 phân khúc PHÁT TRIỂN từ tệp thắng (ghi rõ dựa trên tệp nào, đổi một yếu tố như độ tuổi/khu vực/góc thông điệp) và các phân khúc còn lại phải KHÁC rõ để có cái so. Không khẳng định sở thích nào "ra đơn" — số trên là của cả tệp.`
}
