// ============================================================
// Đợt 24b — chạy BÙ job hằng ngày / hằng tuần bị lỡ lịch
// ============================================================
// Rủi ro ghi ở kiểm tra 05/10 (W4): container khởi động lại (mỗi lần deploy) đúng giờ một job hằng ngày → hôm đó job không
// chạy, không ai biết (missedRun() chỉ xét lịch SAU lúc khởi động nên cũng không báo). Nhịp tick mỗi phút gọi planCatchUp():
//   • CHỈ job riskLevel "low" (chỉ đọc / gửi thông báo) — job ghi lên tài khoản quảng cáo KHÔNG bao giờ chạy bù
//     (không tự sửa quảng cáo vào giờ lạ);
//   • chỉ job thưa (cách nhau ≥ 12 giờ) — job dày tự hồi ở lượt kế;
//   • lịch bị lỡ trong vòng CATCHUP_WINDOW_MS (bản tin sáng gửi lúc nửa đêm là vô nghĩa), sau thời gian ân hạn của job;
//   • mỗi lịch bù MỘT lần (ghi data/job-catchup.json — khởi động lại không bù lại).
import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"
import { lastScheduledAt, nextScheduledAt } from "./tick"
import type { JobDescriptor } from "./registry"

export const CATCHUP_WINDOW_MS = 6 * 3_600_000
export const MIN_INTERVAL_MS = 12 * 3_600_000
/** Header lượt chạy bù — startJobRun ghi nguồn "cron · chạy bù" vào lịch sử. */
export const CATCHUP_HEADER = "x-cron-catchup"

/** Khoảng cách giữa hai lần chạy liên tiếp của lịch (ước theo 2 lần tới) — HÀM THUẦN. */
export function scheduleInterval(expr: string, from: Date): number | null {
  const a = nextScheduledAt(expr, from)
  const b = a ? nextScheduledAt(expr, a) : null
  return a && b ? b.getTime() - a.getTime() : null
}

export function catchUpEligible(d: Pick<JobDescriptor, "riskLevel" | "schedulingStatus" | "cronExpr" | "endpoint">, now: Date): boolean {
  if (d.schedulingStatus !== "auto" || d.riskLevel !== "low" || !d.cronExpr || !d.endpoint) return false
  const gap = scheduleInterval(d.cronExpr, now)
  return gap !== null && gap >= MIN_INTERVAL_MS
}

export interface CatchUpInput {
  jobs: Pick<JobDescriptor, "id" | "riskLevel" | "schedulingStatus" | "cronExpr" | "endpoint" | "maxDurationSec">[]
  states: Map<string, { enabled: boolean; lastRunAt: string | null }>
  done: Record<string, string>
  now: Date
}

/** Job cần chạy bù ngay bây giờ + lịch nó bị lỡ — HÀM THUẦN. */
export function planCatchUp(input: CatchUpInput): { id: string; due: string }[] {
  const out: { id: string; due: string }[] = []
  for (const j of input.jobs) {
    if (!catchUpEligible(j, input.now)) continue
    const s = input.states.get(j.id)
    if (!s?.enabled) continue
    const graceMs = Math.max(15 * 60_000, ((j.maxDurationSec ?? 300) + 300) * 1000)
    const due = lastScheduledAt(j.cronExpr!, new Date(input.now.getTime() - graceMs), new Date(input.now.getTime() - CATCHUP_WINDOW_MS))
    if (!due) continue
    const dueIso = due.toISOString()
    if (input.done[j.id] === dueIso) continue // đã bù lịch này
    if (s.lastRunAt && Date.parse(s.lastRunAt) >= due.getTime() - 60_000) continue // đã chạy (đúng giờ, tay hoặc bù)
    out.push({ id: j.id, due: dueIso })
  }
  return out
}

const FILE = () => path.join(process.cwd(), "data", "job-catchup.json")
export function readCatchUpDone(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(FILE(), "utf-8")) as Record<string, string> } catch { return {} }
}
export function markCatchUpDone(entries: { id: string; due: string }[]): void {
  if (!entries.length) return
  const cur = readCatchUpDone()
  for (const e of entries) cur[e.id] = e.due
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  writeFileAtomicSync(FILE(), JSON.stringify(cur, null, 1))
}
