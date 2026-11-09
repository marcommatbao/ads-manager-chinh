// ============================================================
// Nhịp điều phối job (29/09) — mọi job "auto" trong registry mà docker-entrypoint.sh KHÔNG có dòng crontab riêng
// ============================================================
// SỰ CỐ: crontab trong container được viết TAY trong docker-entrypoint.sh (14 dòng). Các job thêm sau (canh đường lead, báo
// sáng, Sổ kinh nghiệm, canh đo lường, PMax tự động, thí nghiệm PMax, gửi lại chất lượng lead…) có trong registry với
// schedulingStatus "auto" và cronExpr, trang Jobs hiển thị "tự động" — nhưng CHƯA TỪNG được gọi. Hậu quả thật: form MBI → Odoo
// đứt từ 25/09 mà không cảnh báo nào chạy. Nhịp này (crontab mỗi phút) đọc registry → job nào khớp phút hiện tại thì gọi
// endpoint của nó (kèm CRON_SECRET). Job đã có dòng riêng trong entrypoint thì bỏ qua để không chạy đôi.
import { ACTIVE_JOBS as JOB_REGISTRY } from "./registry"

/** Endpoint đã có dòng crontab riêng trong docker-entrypoint.sh — KHỚP danh sách *_URL ở đó. */
export const ENTRYPOINT_ENDPOINTS = new Set([
  "/api/cron", "/api/cron/leads-notify", "/api/cron/orders-notify", "/api/cron/kpi-report", "/api/alerts/digest",
  "/api/cron/ab-test-auto-stop", "/api/cron/improvements-auto-apply", "/api/cron/decision-memory-eval", "/api/cron/alert-scan",
  "/api/cron/policy-radar-scan", "/api/cron/job-health-monitor", "/api/cron/case-remeasure", "/api/google/toolkit/quality-score",
])

function fieldMatches(field: string, value: number, min: number): boolean {
  return field.split(",").some((part) => {
    const [range, stepRaw] = part.split("/")
    const step = stepRaw ? Number(stepRaw) : 1
    if (!(step >= 1)) return false
    let lo: number, hi: number
    if (range === "*") { lo = min; hi = Number.MAX_SAFE_INTEGER }
    else if (range.includes("-")) { const [a, b] = range.split("-").map(Number); lo = a; hi = b }
    else { lo = Number(range); hi = stepRaw ? Number.MAX_SAFE_INTEGER : lo }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false
    return value >= lo && value <= hi && (value - lo) % step === 0
  })
}

/** Biểu thức cron 5 trường (UTC) khớp phút `d` không — HÀM THUẦN. Hỗ trợ: sao, sao/bước, a-b, a-b/bước, danh sách. */
export function cronMatches(expr: string, d: Date): boolean {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return false
  const [mi, h, dom, mo, dow] = f
  const domOk = fieldMatches(dom, d.getUTCDate(), 1), dowOk = fieldMatches(dow, d.getUTCDay(), 0) || (d.getUTCDay() === 0 && fieldMatches(dow, 7, 0)) // 7 = Chủ nhật, cả trong danh sách "5,7" / "1-7"
  // Luật cron chuẩn: cả hai ngày đều hạn chế → khớp một trong hai.
  const dayOk = dom !== "*" && dow !== "*" ? domOk || dowOk : domOk && dowOk
  return fieldMatches(mi, d.getUTCMinutes(), 0) && fieldMatches(h, d.getUTCHours(), 0) && fieldMatches(mo, d.getUTCMonth() + 1, 1) && dayOk
}

/** Job cần gọi ở phút `d` — HÀM THUẦN. */
export function dueJobs(d: Date) {
  return JOB_REGISTRY.filter((j) => j.schedulingStatus === "auto" && j.endpoint && !ENTRYPOINT_ENDPOINTS.has(j.endpoint.split("?")[0]) && j.cronExpr && cronMatches(j.cronExpr, d))
}

/** Lần gần nhất (≤ `upTo`) mà lịch cron LẼ RA phải chạy, không sớm hơn `since` (tối đa lùi 8 ngày) — HÀM THUẦN. */
export function lastScheduledAt(expr: string, upTo: Date, since: Date): Date | null {
  const floor = Math.max(since.getTime(), upTo.getTime() - 8 * 86_400_000)
  const d = new Date(Math.floor(upTo.getTime() / 60_000) * 60_000)
  while (d.getTime() >= floor) { if (cronMatches(expr, d)) return new Date(d); d.setTime(d.getTime() - 60_000) }
  return null
}

/** Job "auto" lỡ lịch: lẽ ra chạy (sau khi server khởi động, trừ thời gian ân hạn) mà không có lần chạy nào từ đó — HÀM THUẦN.
 *  Bắt được đúng điểm mù 29/09: job chưa từng chạy thì trước đây không bao giờ bị coi là "im". */
export function missedRun(input: { cronExpr: string; maxDurationSec?: number; lastRunAt: string | null; now: Date; bootAt: Date }): Date | null {
  const graceMs = Math.max(15 * 60_000, ((input.maxDurationSec ?? 300) + 300) * 1000)
  const due = lastScheduledAt(input.cronExpr, new Date(input.now.getTime() - graceMs), input.bootAt)
  if (!due) return null
  return !input.lastRunAt || Date.parse(input.lastRunAt) < due.getTime() - 60_000 ? due : null
}

/** Lần tới lịch cron sẽ chạy (tìm tối đa 8 ngày) — HÀM THUẦN. */
export function nextScheduledAt(expr: string, from: Date): Date | null {
  const d = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000)
  const end = from.getTime() + 8 * 86_400_000
  while (d.getTime() <= end) { if (cronMatches(expr, d)) return new Date(d); d.setTime(d.getTime() + 60_000) }
  return null
}
