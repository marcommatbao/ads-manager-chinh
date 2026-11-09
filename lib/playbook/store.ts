// ============================================================
// Sổ kinh nghiệm — lưu trữ + gộp kết quả tuần mới (giữ quyết định của người)
// ============================================================
// data/playbook/<company>.json. Mỗi lần bóc (hằng tuần) GỘP vào sổ:
//   - dòng mới: tin cậy cao → "auto" (tool TỰ DÙNG — user chốt 27/09), trung bình → "suggested";
//   - dòng người đã "approved"/"rejected" → GIỮ quyết định; "rejected" chỉ mở lại thành "suggested"
//     khi bằng chứng (số kết quả) tăng ≥ gấp đôi so với lúc bị bỏ;
//   - dòng tuần này không còn thấy → giữ nguyên, quá 90 ngày không thấy lại → "expired".

import { createHash } from "crypto"
import fs from "fs"
import path from "path"
import { withFileLock } from "@/lib/file-lock"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import type { Company } from "@/lib/case/types"
import type { Finding, Metric } from "./engine"

const DIR = path.join(process.cwd(), "data", "playbook")
export const EXPIRE_DAYS = 90

export type EntryStatus = "auto" | "suggested" | "approved" | "rejected" | "expired"
export interface PlaybookEntry extends Finding {
  id: string
  status: EntryStatus
  firstSeen: string
  lastSeen: string
  decidedBy?: string
  decidedAt?: string
  /** Số kết quả lúc bị bỏ — để biết khi nào bằng chứng đủ mạnh mở lại. */
  rejectedAtResults?: number
  /** 7c (chỉ khi hiển thị, KHÔNG lưu vào tệp Sổ) — kết quả chấm sau 14/28 ngày của các chiến dịch đã dùng dòng này. */
  outcome?: { confirmed: number; refuted: number; neutral: number; campaigns: number; lastAt: string | null; demoted: boolean }
  /** 7c — bị bác ≥ 2 chiến dịch → "tự dùng" tạm hạ xuống "gợi ý". */
  demoted?: boolean
}
export interface PlaybookFile {
  company: Company
  updatedAt: string | null
  groups: { key: string; metric: Metric | null; median: number; units: number }[]
  notes: string[]
  entries: PlaybookEntry[]
}

const fileOf = (co: Company) => path.join(DIR, `${co}.json`)
/** Mã dòng = băm của KHOÁ ĐẦY ĐỦ. Bản 7a lấy 40 ký tự base64 đầu (chỉ phủ "MBC|Tên miền|facebook|adset")
 *  + độ dài khoá → đo 28/09: 9 mã trùng trên 58 dòng MBC ("Nhóm tuổi 18-24" và "25-34" chung mã), bấm
 *  Duyệt/Bỏ một dòng là đổi luôn dòng kia. */
export const idOf = (key: string) => `pb_${createHash("sha1").update(key).digest("hex").slice(0, 20)}`

export function readPlaybook(co: Company): PlaybookFile {
  try {
    if (fs.existsSync(fileOf(co))) {
      const p = JSON.parse(fs.readFileSync(fileOf(co), "utf-8")) as PlaybookFile
      // Tệp ghi bằng bản 7a mang mã có thể trùng → luôn tính lại từ khoá khi đọc.
      return { ...p, entries: p.entries.map((e) => ({ ...e, id: idOf(e.key) })) }
    }
  } catch (e) { console.error("[playbook] không đọc được sổ:", e) }
  return { company: co, updatedAt: null, groups: [], notes: [], entries: [] }
}

/** Hàm thuần: sổ cũ + kết quả bóc mới → sổ mới. */
export function mergePlaybook(prev: PlaybookFile, findings: Finding[], groups: PlaybookFile["groups"], notes: string[], now: Date = new Date()): PlaybookFile {
  const at = now.toISOString()
  const byKey = new Map(prev.entries.map((e) => [e.key, e]))
  const seen = new Set<string>()
  const entries: PlaybookEntry[] = []
  for (const f of findings) {
    seen.add(f.key)
    const old = byKey.get(f.key)
    const fresh: EntryStatus = f.confidence === "high" ? "auto" : "suggested"
    let status: EntryStatus = fresh
    if (old?.status === "approved") status = "approved"
    else if (old?.status === "rejected") status = f.stat.results >= 2 * (old.rejectedAtResults ?? 0) && f.stat.results > 0 ? "suggested" : "rejected"
    entries.push({ ...f, id: idOf(f.key), status, firstSeen: old?.firstSeen ?? at, lastSeen: at,
      ...(old?.decidedBy ? { decidedBy: old.decidedBy, decidedAt: old.decidedAt } : {}),
      ...(status === "rejected" ? { rejectedAtResults: old?.rejectedAtResults } : {}) })
  }
  for (const e of prev.entries) {
    if (seen.has(e.key)) continue
    const stale = now.getTime() - Date.parse(e.lastSeen) > EXPIRE_DAYS * 86_400_000
    entries.push(stale && e.status !== "rejected" ? { ...e, status: "expired" } : e)
  }
  return { company: prev.company, updatedAt: at, groups, notes, entries }
}

export async function savePlaybook(co: Company, fn: (prev: PlaybookFile) => PlaybookFile): Promise<PlaybookFile> {
  return withFileLock(fileOf(co), async () => {
    const next = fn(readPlaybook(co))
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true })
    writeFileAtomicSync(fileOf(co), JSON.stringify(next, null, 1))
    return next
  })
}

/** Người duyệt / bỏ một dòng. */
export async function decideEntry(co: Company, id: string, decision: "approved" | "rejected" | "suggested", actor: string): Promise<PlaybookEntry | null> {
  let hit: PlaybookEntry | null = null
  await savePlaybook(co, (p) => ({
    ...p, entries: p.entries.map((e) => {
      if (e.id !== id) return e
      hit = { ...e, status: decision, decidedBy: actor, decidedAt: new Date().toISOString(), ...(decision === "rejected" ? { rejectedAtResults: e.stat.results } : {}) }
      return hit
    }),
  }))
  return hit
}

/** Dòng đang được DÙNG (tự dùng + đã duyệt) — cho 7b. */
export const activeEntries = (p: PlaybookFile) => p.entries.filter((e) => e.status === "auto" || e.status === "approved")
