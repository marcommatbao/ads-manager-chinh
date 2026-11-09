// ============================================================
// Đợt 22b — nhịp tim bộ hẹn giờ (crond → /api/cron/tick mỗi phút)
// ============================================================
// Vì sao: crond khởi động lỗi / chết thì docker-entrypoint.sh chỉ cảnh báo, web vẫn chạy → MỌI job tự động im lặng, kể cả
// job_health_monitor (nó cũng chạy bằng crontab nên không tự báo được). Tick ghi thời điểm; trang Cài đặt → Cron Jobs đọc
// lại — đường đọc là yêu cầu của người dùng, KHÔNG phụ thuộc crond.

import fs from "fs"
import path from "path"
import { writeFileAtomicSync } from "@/lib/fs-atomic"

const FILE = () => path.join(process.cwd(), "data", "cron-tick.json")
/** Tick chạy mỗi phút; quá ngưỡng này coi như bộ hẹn giờ đã ngừng. */
export const TICK_STALE_SEC = 5 * 60
/** Vừa khởi động: chưa kịp có tick đầu → chưa kết luận. */
const WARMUP_SEC = 3 * 60

export function recordTick(now = new Date()): void {
  try { writeFileAtomicSync(FILE(), JSON.stringify({ lastTickAt: now.toISOString() })) } catch { /* không ghi được thì thôi — không chặn tick */ }
}

export interface SchedulerHealth {
  lastTickAt: string | null
  ageSec: number | null
  /** ok | stale (quá ngưỡng) | warming_up (mới khởi động, chưa có tick) | never (chưa từng có tick sau khởi động đủ lâu) */
  status: "ok" | "stale" | "warming_up" | "never"
}

export function schedulerHealth(now = new Date(), uptimeSec = process.uptime()): SchedulerHealth {
  let lastTickAt: string | null = null
  try { lastTickAt = (JSON.parse(fs.readFileSync(FILE(), "utf8")) as { lastTickAt?: string }).lastTickAt ?? null } catch { /* chưa có tệp */ }
  const ageSec = lastTickAt ? Math.max(0, Math.round((now.getTime() - Date.parse(lastTickAt)) / 1000)) : null
  if (ageSec === null) return { lastTickAt, ageSec, status: uptimeSec < WARMUP_SEC ? "warming_up" : "never" }
  if (ageSec <= TICK_STALE_SEC) return { lastTickAt, ageSec, status: "ok" }
  // Tệp cũ từ trước lần khởi động này + mới khởi động → chờ tick đầu.
  return { lastTickAt, ageSec, status: uptimeSec < WARMUP_SEC ? "warming_up" : "stale" }
}
