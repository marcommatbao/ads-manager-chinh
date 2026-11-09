// ============================================================
// Bảng theo dõi phiên (Đợt 4 · C) + nhắc việc giao người quá hạn
// ============================================================
// Mọi phiên của 2 công ty × 2 nền tảng trên một bảng: đang ở bước nào, đo lại
// 7/14 ngày ra sao, việc giao người còn mở bao lâu. Trước đây chỉ xem được
// từng phiên một, nên không ai thấy phiên nào có hiệu quả.
//
// Nhắc việc qua Microsoft Teams (user đổi từ Telegram sang Teams 27/09): TẮT
// cho tới khi đặt CASE_TASK_TEAMS_WEBHOOK — kênh RIÊNG, không dùng chung kênh
// cảnh báo hệ thống. Mỗi việc nhắc tối đa 1 lần/ngày.

import { sendTeamsAlert } from "@/lib/teams-alert"

export const REMINDER_SETUP_HINT = "Nhắc việc đang TẮT: lấy link Incoming Webhook của kênh Teams muốn nhận (Teams → kênh → … → Workflows/Connectors → Incoming Webhook), đặt biến CASE_TASK_TEAMS_WEBHOOK trong Coolify rồi deploy lại."
export const remindersEnabled = () => !!(process.env.CASE_TASK_TEAMS_WEBHOOK ?? "").trim()
import { listCases, updateCase, type CampaignCase } from "./store"
import type { Company } from "./types"
import { rejudge } from "./next-steps"

export const TASK_OVERDUE_DAYS = 3
const DAY = 86_400_000

export type BoardState = "working" | "waiting" | "reopened" | "done"

export interface BoardRemeasure { due: string; done: boolean; cpaBefore: number | null; cpaAfter: number | null; better: boolean | null
  /** Đợt 23: kết quả chấm theo mục tiêu (lib/case/judge.ts) — 1 đạt · 0 chưa rõ · -1 xấu đi · 2 chưa đủ dữ liệu (14/10);
   *  null = đo theo cách cũ / chưa đo. Lần đo đã lưu được CHẤM LẠI theo luật hiện hành (next-steps.ts rejudge). */
  verdict?: number | null; roasBefore?: number | null; roasAfter?: number | null }

export interface BoardRow {
  id: string
  company: Company
  platform: "google" | "facebook"
  campaignId: string
  campaignName: string
  step: number
  state: BoardState
  executedAt: string | null
  remeasure: [BoardRemeasure | null, BoardRemeasure | null]
  tasks: { open: number; oldestDays: number | null; overdue: number }
  updatedAt: string
}

/** CPA lúc mở phiên, theo nền tảng. */
function cpaBefore(c: CampaignCase): number | null {
  const ev = c.evidence
  if (!ev) return null
  if (ev.kind === "meta") return ev.campaign.purchases > 0 ? ev.campaign.cost / ev.campaign.purchases : null
  return ev.campaign.orders > 0 ? ev.campaign.cost / ev.campaign.orders : null
}

export function boardState(c: CampaignCase): BoardState {
  if (c.status === "reopened") return "reopened"
  if (c.status === "done") return c.remeasure.some((r) => r.status === "pending") ? "waiting" : "done"
  const wrote = c.executions.some((e) => e.mode !== "validate" && e.status === "done" && !e.undoneAt)
  return wrote && c.remeasure.some((r) => r.status === "pending") ? "waiting" : "working"
}

export function boardRow(c: CampaignCase, now: number = Date.now()): BoardRow {
  const before = cpaBefore(c)
  // 14/10: hiện VÒNG ĐO MỚI NHẤT (cùng `start` với mốc cuối) — phiên mở lại rồi làm tiếp không còn hiện số của vòng cũ.
  // Mốc đo thêm (extended) thế chỗ mốc cuối của vòng.
  const last = c.remeasure[c.remeasure.length - 1]
  const cycle = c.remeasure.filter((r) => r.start === last?.start)
  const shown = cycle.length > 2 ? [cycle[0], cycle[cycle.length - 1]] : cycle
  const rm = shown.map((r): BoardRemeasure => {
    const after = r.result?.cpa ?? null
    const v = r.status === "done" ? rejudge(c, r) : null
    // Đợt 23: có kết quả chấm mới thì dùng nó; kết quả đo trước Đợt 23 (không có verdict) giữ cách so cũ.
    const better = r.status !== "done" ? null : v !== null ? v === 1 : after !== null && before !== null ? after < before : null
    return { due: r.due, done: r.status === "done", cpaBefore: before, cpaAfter: after, better, verdict: v, roasBefore: r.result?.roasBefore ?? null, roasAfter: r.result?.roas ?? null }
  })
  const open = c.manualTasks.filter((t) => t.status === "open")
  const ages = open.map((t) => Math.floor((now - Date.parse(t.createdAt)) / DAY))
  const exec = c.executions.filter((e) => e.mode !== "validate" && !e.undoneAt).map((e) => e.at).sort()[0] ?? null
  return {
    id: c.id, company: c.company, platform: c.platform ?? "google", campaignId: c.campaignId, campaignName: c.campaignName,
    step: c.step, state: boardState(c), executedAt: exec,
    remeasure: [rm[0] ?? null, rm[1] ?? null],
    tasks: { open: open.length, oldestDays: ages.length ? Math.max(...ages) : null, overdue: ages.filter((a) => a > TASK_OVERDUE_DAYS).length },
    updatedAt: c.updatedAt,
  }
}

export function caseBoard(companies: Company[], now: number = Date.now()): BoardRow[] {
  const order: Record<BoardState, number> = { reopened: 0, working: 1, waiting: 2, done: 3 }
  return listCases().filter((c) => companies.includes(c.company)).map((c) => boardRow(c, now))
    .sort((a, b) => order[a.state] - order[b.state] || b.tasks.overdue - a.tasks.overdue || b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Nhắc việc giao người quá TASK_OVERDUE_DAYS ngày. Gọi từ job đo lại hằng ngày.
 * Không có CASE_TASK_TEAMS_WEBHOOK → không gửi, báo "tắt". Một thẻ Teams gộp mọi phiên.
 */
export async function remindOverdueTasks(now: number = Date.now()): Promise<{ enabled: boolean; sent: number; tasks: number; error?: string }> {
  const webhookUrl = (process.env.CASE_TASK_TEAMS_WEBHOOK ?? "").trim()
  const due: { c: CampaignCase; taskIds: string[]; lines: string[] }[] = []
  for (const c of listCases()) {
    if (c.status === "done") continue
    const tasks = c.manualTasks.filter((t) => t.status === "open" && now - Date.parse(t.createdAt) > TASK_OVERDUE_DAYS * DAY
      && (!t.lastRemindedAt || now - Date.parse(t.lastRemindedAt) >= DAY))
    if (tasks.length) due.push({ c, taskIds: tasks.map((t) => t.id), lines: tasks.map((t) => `${t.title}${t.assignee ? ` — ${t.assignee}` : ""} (${Math.floor((now - Date.parse(t.createdAt)) / DAY)} ngày)`) })
  }
  const count = due.reduce((s, d) => s + d.taskIds.length, 0)
  if (!webhookUrl) return { enabled: false, sent: 0, tasks: count }
  if (!count) return { enabled: true, sent: 0, tasks: 0 }
  const r = await sendTeamsAlert({
    webhookUrl, setupHint: REMINDER_SETUP_HINT, level: "warning",
    title: `Việc giao người quá ${TASK_OVERDUE_DAYS} ngày chưa xong (${count})`,
    facts: due.map((d) => ({ title: `${d.c.company} · ${d.c.platform === "facebook" ? "Facebook" : "Google"} · ${d.c.campaignName}`, value: d.lines.join(" · ") })),
    action: "Mở AdsCommand → Theo dõi phiên để xem và đánh dấu xong.",
  })
  if (!r.sent) return { enabled: true, sent: 0, tasks: count, error: r.error ?? "Gửi Teams thất bại" }
  const at = new Date(now).toISOString()
  for (const d of due) {
    await updateCase(d.c.id, async (cur) => ({ next: { ...cur, manualTasks: cur.manualTasks.map((t) => (d.taskIds.includes(t.id) ? { ...t, lastRemindedAt: at } : t)) }, result: null }))
  }
  return { enabled: true, sent: 1, tasks: count }
}
