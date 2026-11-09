// ============================================================
// Đợt 14b — BÁO SÁNG HỆ THỐNG (08:05, Teams kênh IT): tool tự khai sức khoẻ của chính nó
// ============================================================
// Từ workspace không vào được app production (IP chặn, không đọc được data/) → tool phải TỰ gửi bằng chứng mỗi sáng: job nào
// lỗi / lỡ lịch / chưa từng chạy, kết nối nào hỏng, hôm qua tool GHI gì lên tài khoản quảng cáo, thí nghiệm nào đang chạy.
// Gửi cả khi mọi thứ ổn — không nhận được thẻ sáng = chính tool có chuyện.
import { ACTIVE_JOBS as JOB_REGISTRY } from "./registry"
import { buildJobStates } from "./state"
import { missedRun } from "./tick"
import { snapshotAllConnectors } from "@/lib/connectors/engine"
import { listWrites } from "@/lib/write-guard"
import { listControlExecutions } from "@/lib/pmax/controls"
import { listSearchExecutions } from "@/lib/search/controls"
import { listExperiments } from "@/lib/pmax/geo-experiment"
import { addDays, vnDate } from "@/lib/case/dates"
import { sendSystemAlert } from "@/lib/system-alert"
import type { Company } from "@/lib/case/types"
import { companyIds } from "@/lib/companies"
import { jobInInstall } from "./store"

export interface SystemMorning { level: "danger" | "warning" | "good"; title: string; facts: { title: string; value: string }[] }
const BOOT_AT = new Date(Date.now() - process.uptime() * 1000)

/** Soạn thẻ — HÀM THUẦN theo đầu vào đã gom. */
export function composeSystemMorning(input: { badJobs: string[]; okJobs: number; pausedJobs: number; downConnectors: string[]; writes: string[]; experiments: string[]; day: string }): SystemMorning {
  const level = input.badJobs.length || input.downConnectors.length ? "danger" : "good"
  return {
    level,
    title: `${level === "good" ? "✓ Hệ thống ổn" : `✕ ${input.badJobs.length} job có vấn đề · ${input.downConnectors.length} kết nối hỏng`} — báo sáng ${input.day}`,
    facts: [
      { title: "Job tự động", value: input.badJobs.length ? input.badJobs.join(" · ") : `${input.okJobs} job chạy đúng lịch${input.pausedJobs ? ` · ${input.pausedJobs} đang tắt` : ""}` },
      { title: "Kết nối", value: input.downConnectors.length ? input.downConnectors.join(" · ") : "Không có kết nối hỏng" },
      { title: "Hôm qua tool GHI lên tài khoản", value: input.writes.length ? input.writes.join(" · ") : "Không ghi gì" },
      { title: "Thí nghiệm đang chạy", value: input.experiments.length ? input.experiments.join(" · ") : "Không có" },
    ],
  }
}

export async function runSystemMorning(now = new Date()): Promise<{ sent: boolean; channel: string | null; error?: string; card: SystemMorning }> {
  const states = buildJobStates()
  const bad: string[] = []
  let ok = 0, paused = 0
  for (const s of states) {
    const d = JOB_REGISTRY.find((j) => j.id === s.jobId)
    if (!d || d.schedulingStatus !== "auto" || d.id === "system_morning" || !jobInInstall(d.id)) continue // Đợt 25: bỏ job không thuộc bản cài
    if (!s.enabled) { paused++; continue }
    const missed = d.cronExpr ? missedRun({ cronExpr: d.cronExpr, maxDurationSec: d.maxDurationSec, lastRunAt: s.lastRunAt, now, bootAt: BOOT_AT }) : null
    if (missed) bad.push(`${d.displayName}: ${s.lastRunAt ? "lỡ lịch" : "CHƯA TỪNG chạy"}`)
    else if (s.lastRun?.status === "failure") bad.push(`${d.displayName}: lỗi — ${(s.lastRun.errorSummary ?? "").slice(0, 80)}`)
    else if (s.isStale) bad.push(`${d.displayName}: im quá lâu`)
    else ok++
  }
  const down: string[] = []
  try { for (const [id, rec] of Object.entries(snapshotAllConnectors())) if (rec && (rec.status === "auth_error" || rec.status === "service_error")) down.push(`${id} (${rec.status})`) } catch { /* không đọc được thì bỏ qua dòng này */ }
  const y = addDays(vnDate(now), -1)
  const isY = (iso?: string) => !!iso && vnDate(new Date(iso)) === y
  const writes: string[] = []
  for (const co of companyIds()) {
    const w = listWrites(co).filter((x) => isY(x.at) && x.status === "done").length
    const p = listControlExecutions(co).filter((x) => isY(x.at) && x.mode === "write").length
    const s = listSearchExecutions(co).filter((x) => isY(x.at) && x.mode === "write").length
    if (w + p + s) writes.push(`${co}: ${[w && `${w} lần (Search/toolkit)`, p && `${p} lần PMax`, s && `${s} lần việc nên làm Search`].filter(Boolean).join(", ")}`)
  }
  const experiments = companyIds().flatMap((co) => listExperiments(co).filter((e) => e.status === "running").map((e) => `${co} ${e.label} (tới ${e.plannedEnd.split("-").reverse().join("/")}${e.lastResult?.verdict ? ` · ${e.lastResult.verdict}` : ""})`))
  const card = composeSystemMorning({ badJobs: bad, okJobs: ok, pausedJobs: paused, downConnectors: down, writes, experiments, day: vnDate(now).split("-").reverse().join("/") })
  const r = await sendSystemAlert({ ...card, action: card.level === "good" ? undefined : "Mở Cài đặt → Jobs để xem chi tiết." }).catch((e) => ({ sent: false, channel: null, error: String(e) }))
  return { sent: !!r.sent, channel: r.channel ?? null, error: r.error, card }
}
