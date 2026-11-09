// Cron — nhịp điều phối mỗi phút: gọi các job "auto" trong registry chưa có dòng crontab riêng (xem lib/jobs/tick.ts).
// Không chờ job chạy xong (có job vài phút) — mỗi job tự có chốt chống chạy chồng + lịch sử ở trang Jobs.
import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { dueJobs } from "@/lib/jobs/tick"
import { recordTick } from "@/lib/jobs/heartbeat"
import { ACTIVE_JOBS } from "@/lib/jobs/registry"
import { buildJobStates } from "@/lib/jobs/state"
import { CATCHUP_HEADER, markCatchUpDone, planCatchUp, readCatchUpDone } from "@/lib/jobs/catchup"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request, "cron/tick")
  if (!auth.ok) return auth.response
  const now = new Date()
  recordTick(now) // Đợt 22b: nhịp tim bộ hẹn giờ (Cài đặt → Cron Jobs báo khi ngừng)
  const due = dueJobs(now)
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`
  if (due.length) console.log(`[cron/tick] ${now.toISOString().slice(0, 16)} gọi: ${due.map((j) => j.id).join(", ")}`)
  const call = (j: (typeof ACTIVE_JOBS)[number], extra: Record<string, string> = {}) => {
    void fetch(`${base}${j.endpoint}`, { method: j.httpMethod ?? "GET", headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`, ...extra }, signal: AbortSignal.timeout(((j.maxDurationSec ?? 300) + 30) * 1000) })
      .then((r) => { if (!r.ok && r.status !== 423) console.warn(`[cron/tick] ${j.id} → HTTP ${r.status}`) })
      .catch((e) => console.warn(`[cron/tick] ${j.id} lỗi: ${e instanceof Error ? e.message : String(e)}`))
  }
  for (const j of due) call(j)

  // Đợt 24b: chạy BÙ job hằng ngày/tuần rủi ro thấp bị lỡ lịch (vd container khởi động lại đúng giờ chạy) — lib/jobs/catchup.ts.
  let caught: { id: string; due: string }[] = []
  try {
    const states = new Map(buildJobStates().map((s) => [s.jobId as string, { enabled: s.enabled, lastRunAt: s.lastRunAt }]))
    caught = planCatchUp({ jobs: ACTIVE_JOBS, states, done: readCatchUpDone(), now }).filter((c) => !due.some((d) => d.id === c.id))
    if (caught.length) {
      markCatchUpDone(caught) // ghi TRƯỚC khi gọi — job chậm/lỗi cũng không bị bù lại mỗi phút
      console.log(`[cron/tick] chạy bù: ${caught.map((c) => `${c.id} (lịch ${c.due.slice(0, 16)}Z)`).join(", ")}`)
      for (const c of caught) { const j = ACTIVE_JOBS.find((x) => x.id === c.id); if (j) call(j, { [CATCHUP_HEADER]: c.due }) }
    }
  } catch (e) {
    console.warn(`[cron/tick] không lập được danh sách chạy bù: ${e instanceof Error ? e.message : String(e)}`)
  }
  return NextResponse.json({ success: true, at: now.toISOString(), triggered: due.map((j) => j.id), caughtUp: caught.map((c) => c.id) })
}
