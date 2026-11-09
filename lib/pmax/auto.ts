// ============================================================
// Đợt 10b — TỰ ĐỘNG áp các việc PMax ít rủi ro (user 28/09: "vận dụng automatic vào")
// ============================================================
// Mặc định TẮT. Bật theo từng loại (AutoKind) + từng công ty. Job pmax_auto_controls chạy hằng ngày:
// tính lại đề xuất từ số 30 ngày → lọc đúng loại đã bật + chỉ dòng tích sẵn (bằng chứng đủ) → Kiểm trước → ghi →
// đọc lại → nhật ký (hoàn tác được ở giao diện) → báo Teams. Trần MAX_AUTO_PER_DAY thao tác/ngày/công ty.
// KHÔNG BAO GIỜ tự động: loại thương hiệu (cần có Search thương hiệu), tắt mở rộng URL, loại kênh YouTube/web.

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { lastDays } from "@/lib/case/dates"
import type { Company } from "@/lib/case/types"
import { sendTeamsAlert } from "@/lib/teams-alert"
import { controlLexicon, customerIdOf, proposeControls, readControlData, runControls, PMAX_CONFIRM_TEXT, type ControlExecution } from "./controls"
import { autoKindOf, AUTO_KIND_LABEL, type AutoKind } from "./recommend"
import { pmaxXray } from "./xray"

const FILE = path.join(process.cwd(), "data", "pmax-auto.json")
export const MAX_AUTO_PER_DAY = 20
export interface AutoSettings { companies: Partial<Record<Company, AutoKind[]>>; updatedBy?: string; updatedAt?: string }

export function readAutoSettings(): AutoSettings {
  try { return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf-8")) as AutoSettings) : { companies: {} } } catch { return { companies: {} } }
}
export function saveAutoSettings(s: AutoSettings): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  writeFileAtomicSync(FILE, JSON.stringify(s, null, 1))
}
export const validAutoKinds = (x: unknown): AutoKind[] => (Array.isArray(x) ? x.filter((k): k is AutoKind => typeof k === "string" && k in AUTO_KIND_LABEL) : [])

export async function runPmaxAuto(): Promise<{ company: Company; applied: number; skipped: string; execution?: ControlExecution }[]> {
  const settings = readAutoSettings()
  const out: { company: Company; applied: number; skipped: string; execution?: ControlExecution }[] = []
  for (const co of ["MBI", "MBC"] as Company[]) {
    const kinds = settings.companies[co] ?? []
    if (!kinds.length) { out.push({ company: co, applied: 0, skipped: "Chưa bật tự động" }); continue }
    const cid = customerIdOf(co)
    if (!cid) { out.push({ company: co, applied: 0, skipped: "Thiếu mã tài khoản Google" }); continue }
    const range = lastDays(30)
    const [x, d] = await Promise.all([pmaxXray(co, range, { force: true }), readControlData(co, range)])
    const proposals = proposeControls(x, d, controlLexicon(co))
    const pick = proposals.filter((p) => p.defaultChecked && !p.warning && kinds.includes(autoKindOf(p) as AutoKind)).slice(0, MAX_AUTO_PER_DAY)
    if (!pick.length) { out.push({ company: co, applied: 0, skipped: "Không có việc mới đủ điều kiện" }); continue }
    const exec = await runControls({ company: co, proposals, ids: pick.map((p) => p.id), actor: "Tự động (PMax)", validateOnly: false, confirmText: PMAX_CONFIRM_TEXT, customerId: cid })
    out.push({ company: co, applied: exec.applied.length, skipped: "", execution: exec })
    await sendTeamsAlert({
      level: exec.status === "done" ? "good" : "warning",
      title: `${exec.status === "done" ? "✓" : "⚠"} PMax tự động · ${co}: ${exec.applied.length} việc`,
      facts: [...exec.applied.slice(0, 15).map((a) => ({ title: a.kind, value: a.label })), ...exec.errors.slice(0, 3).map((e) => ({ title: "Lỗi", value: e }))],
      action: "Xem / hoàn tác: AdsCommand → PMax Insights → X-quang → Lịch sử áp dụng.",
    }).catch(() => null)
  }
  return out
}
