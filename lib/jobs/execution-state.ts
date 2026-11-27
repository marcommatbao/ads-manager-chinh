/** Same-process observation only. Not a durable/distributed execution lease. */
import type { JobId } from "./types"
export const RUNNING_JOBS = new Set<JobId>()
