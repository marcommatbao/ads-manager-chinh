// Sổ kinh nghiệm — chạy một lượt bóc cho cả hai công ty (job playbook_extract, hằng tuần).
import type { Company } from "@/lib/case/types"
import { collectGoogleUnits } from "./collect-google"
import { collectMetaUnits } from "./collect-meta"
import { extractAll, type Unit } from "./engine"
import { mergePlaybook, savePlaybook, type PlaybookFile } from "./store"

export const PLAYBOOK_DAYS = 180

export async function runPlaybookExtract(companies: Company[] = ["MBI", "MBC"], now: Date = new Date()): Promise<{ files: PlaybookFile[]; summary: string }> {
  const notes: string[] = []
  let meta: Unit[] = []
  try {
    const m = await collectMetaUnits(now)
    meta = m.units
    // Tài khoản Meta dùng chung MBC + MBI → ghi chú là của CẢ tài khoản, không phải riêng công ty đang xem.
    notes.push(...m.notes.map((n) => `Tài khoản Meta chung MBC + MBI: ${n}`))
  } catch (e) { notes.push(`Meta không đọc được: ${e instanceof Error ? e.message : String(e)} — giữ kinh nghiệm Meta cũ.`) }
  const files: PlaybookFile[] = []
  const parts: string[] = []
  for (const co of companies) {
    let google: Unit[] = []
    const coNotes = [...notes]
    try {
      const g = await collectGoogleUnits(co, PLAYBOOK_DAYS, now)
      google = g.units
      coNotes.push(...g.notes, `Google: ${g.units.length} đơn vị, ${g.queries} truy vấn.`)
    } catch (e) { coNotes.push(`Google không đọc được: ${e instanceof Error ? e.message : String(e)} — giữ kinh nghiệm Google cũ.`) }
    const units = [...meta.filter((u) => u.company === co), ...google]
    const { groups, findings } = extractAll(units)
    // Nền tảng nào hỏng lượt này → không coi kinh nghiệm cũ của nền tảng đó là "không thấy lại".
    const failed = new Set<string>([...(meta.length ? [] : ["facebook"]), ...(google.length ? [] : ["google"])])
    const file = await savePlaybook(co, (prev) => {
      const next = mergePlaybook({ ...prev, entries: prev.entries.filter((e) => !failed.has(e.platform)) }, findings, groups, coNotes, now)
      return { ...next, entries: [...next.entries, ...prev.entries.filter((e) => failed.has(e.platform))] }
    })
    files.push(file)
    const auto = file.entries.filter((e) => e.status === "auto").length, sug = file.entries.filter((e) => e.status === "suggested").length
    parts.push(`${co}: ${findings.length} kinh nghiệm (${auto} tự dùng, ${sug} gợi ý)`)
  }
  return { files, summary: parts.join(" · ") }
}
