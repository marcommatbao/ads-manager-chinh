/** Client-only projection of stored job evidence; never reads stores or runs jobs. */
export interface CheckpointRun {
  status: "success" | "failure" | "skipped" | "running" | "preflight_failed"
  startedAt: string
  finishedAt: string | null
  resultSummary: string | null
}
export interface CheckpointState {
  enabled: boolean
  lastRun: CheckpointRun | null
  intervalMs: number | null
  nextExpectedAt: string | null
  isStale: boolean
}
export const CHECKPOINT_MAX_DURATION_MS = 60_000 // quality_checkpoint registry maxDurationSec=60
export const CHECKPOINT_COUNT_KEYS = ["examined", "observed", "inconclusive", "skipped", "conflicts"] as const
export function checkpointCounts(summary: string | null): Record<typeof CHECKPOINT_COUNT_KEYS[number], number> | null {
  if (!summary || summary.length > 256) return null
  const parts = summary.split(";").map(p => p.trim())
  if (parts.length !== CHECKPOINT_COUNT_KEYS.length) return null
  const counts: Partial<Record<typeof CHECKPOINT_COUNT_KEYS[number], number>> = {}
  for (const part of parts) {
    const match = /^(examined|observed|inconclusive|skipped|conflicts)=(0|[1-9]\d*)$/.exec(part)
    if (!match) return null
    const key = match[1] as typeof CHECKPOINT_COUNT_KEYS[number]
    const value = Number(match[2])
    if (counts[key] !== undefined || !Number.isSafeInteger(value)) return null
    counts[key] = value
  }
  return counts as Record<typeof CHECKPOINT_COUNT_KEYS[number], number>
}
export function checkpointVisibility(state: CheckpointState, now: number) {
  const run = state.lastRun
  const start = run ? Date.parse(run.startedAt) : NaN
  const finish = run?.finishedAt ? Date.parse(run.finishedAt) : NaN
  const startedAt = Number.isFinite(start) && start <= now ? run!.startedAt : null
  const finishedAt = startedAt && Number.isFinite(finish) && finish >= start && finish <= now ? run!.finishedAt : null
  const status: "disabled" | "never_run" | "unknown" | "suspected_stale" | CheckpointRun["status"] = !state.enabled ? "disabled" : !run ? "never_run"
    : !startedAt ? "unknown"
    : run.status === "running" ? (now - start > CHECKPOINT_MAX_DURATION_MS ? "suspected_stale" : "running")
    : run.status === "success" && !finishedAt ? "unknown" : run.status
  const next = Date.parse(state.nextExpectedAt ?? "")
  const schedule: "disabled" | "unknown" | "stale" | "overdue" | "expected" = !state.enabled ? "disabled" : state.intervalMs === null || !Number.isFinite(state.intervalMs) || state.intervalMs <= 0 || !Number.isFinite(next) ? "unknown"
    : state.isStale ? "stale" : next < now ? "overdue" : "expected"
  return { status, schedule, startedAt, finishedAt, counts: checkpointCounts(run?.resultSummary ?? null) }
}
export function checkpointHeartbeat(value?: { status: string; lastTickAt: string | null }, now = Date.now()) {
  const at = Date.parse(value?.lastTickAt ?? "")
  if (!value || !["ok", "stale", "never", "warming_up"].includes(value.status)) return "unknown"
  if (value.status === "ok" && (!Number.isFinite(at) || at > now || now - at > 300_000)) return "unknown"
  return value.status as "ok" | "stale" | "never" | "warming_up"
}
