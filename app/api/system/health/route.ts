// Đợt 14c — Sức khoẻ tool.
// GET  — mọi job (ai lên lịch, lần chạy cuối, lần tới, lỡ lịch), kết nối, kênh cảnh báo, đối chiếu số gần nhất
// POST {action: "test_alert"} — gửi một thẻ thử tới kênh cảnh báo hệ thống (chỉ super admin)
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/permissions"
import { ACTIVE_JOBS as JOB_REGISTRY } from "@/lib/jobs/registry"
import { buildJobStates } from "@/lib/jobs/state"
import { ENTRYPOINT_ENDPOINTS, missedRun, nextScheduledAt } from "@/lib/jobs/tick"
import { envDisabledJobs } from "@/lib/jobs/store"
import { snapshotAllConnectors } from "@/lib/connectors/engine"
import { isTeamsAlertConfigured } from "@/lib/teams-alert"
import { sendSystemAlert } from "@/lib/system-alert"
import { lastNumbersCheck } from "@/lib/jobs/numbers-check"
import { appVersionLabel } from "@/lib/version"
import { dataVersionResult } from "@/lib/data-version"
import { jobInInstall } from "@/lib/jobs/store"

export const dynamic = "force-dynamic"
const BOOT_AT = new Date(Date.now() - process.uptime() * 1000)

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const now = new Date()
  const states = new Map(buildJobStates().map((s) => [s.jobId, s]))
  const jobs = JOB_REGISTRY.filter((d) => jobInInstall(d.id)).map((d) => { // Đợt 25: ẩn job không thuộc bản cài
    const s = states.get(d.id)!
    const auto = d.schedulingStatus === "auto"
    const scheduledBy = !auto ? "manual" : ENTRYPOINT_ENDPOINTS.has(d.endpoint.split("?")[0]) ? "entrypoint" : "tick"
    const missed = auto && s.enabled && d.cronExpr ? missedRun({ cronExpr: d.cronExpr, maxDurationSec: d.maxDurationSec, lastRunAt: s.lastRunAt, now, bootAt: BOOT_AT }) : null
    const status = !s.enabled ? "paused" : missed ? "missed" : s.lastRun?.status === "failure" ? "failed" : s.isStale ? "stale" : !s.lastRun ? (auto ? "waiting" : "never") : "ok"
    return {
      id: d.id, name: d.displayName, description: d.description, intervalLabel: d.intervalLabel, cronExpr: d.cronExpr, riskLevel: d.riskLevel, riskNote: d.riskNote ?? null,
      scheduledBy, enabled: s.enabled, pausedBy: s.pausedBy, pauseReason: s.pauseReason, envDisabled: envDisabledJobs().has(d.id),
      lastRunAt: s.lastRunAt, lastStatus: s.lastRun?.status ?? null, lastError: s.lastRun?.errorSummary ?? null, lastSummary: s.lastRun?.resultSummary ?? null, lastTriggeredBy: s.lastRun?.triggeredBy ?? null,
      lastSuccessAt: s.lastSuccess?.startedAt ?? null, nextAt: auto && s.enabled && d.cronExpr ? nextScheduledAt(d.cronExpr, now)?.toISOString() ?? null : null,
      missedAt: missed?.toISOString() ?? null, status,
    }
  })
  let connectors: { id: string; status: string; reason: string | null; lastChecked: string | null }[] = []
  try { connectors = Object.entries(snapshotAllConnectors()).filter(([, r]) => !!r).map(([id, r]) => ({ id, status: r!.status, reason: r!.failureReason ?? null, lastChecked: r!.lastChecked ?? null })) } catch { /* hiện rỗng */ }
  return NextResponse.json({
    success: true, now: now.toISOString(), bootAt: BOOT_AT.toISOString(), jobs, connectors,
    alertChannel: { teams: isTeamsAlertConfigured(), telegramDisabled: process.env.CONNECTOR_TELEGRAM_DISABLED === "1" },
    numbersCheck: lastNumbersCheck(), canControl: isSuperAdmin(user.role),
    // Đợt 24c: phiên bản mã + phiên bản dữ liệu (kết quả kiểm lúc khởi động)
    version: { app: appVersionLabel(), data: dataVersionResult() },
  })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isSuperAdmin(user.role)) return NextResponse.json({ success: false, error: "Chỉ quản trị viên cao nhất được gửi thử" }, { status: 403 })
  const b = (await request.json().catch(() => ({}))) as { action?: string }
  if (b.action !== "test_alert") return NextResponse.json({ success: false, error: "action không hợp lệ" }, { status: 400 })
  const r = await sendSystemAlert({ level: "good", title: "🧪 Thẻ thử — kênh cảnh báo hệ thống AdsCommand", facts: [{ title: "Người gửi", value: user.email }, { title: "Lúc", value: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) }], action: "Nhận được thẻ này = kênh cảnh báo hoạt động." })
  return NextResponse.json({ success: r.sent, channel: r.channel, error: r.error ?? null }, { status: r.sent ? 200 : 502 })
}
