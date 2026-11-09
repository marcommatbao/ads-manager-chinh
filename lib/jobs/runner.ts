// ============================================================
// Job execution wrapper — withJobTracing()
//
// Wrap any cron handler body:
//   return withJobTracing("nba_engine", "cron", async () => {
//     // ...existing logic...
//     return { success: true, ... };
//   });
//
// The wrapper:
//   1. Checks if job is paused → returns 423 (locked/paused) with explanation
//   2. Runs preflight (required env vars)
//   3. Guards against overlapping execution (in-process flag)
//   4. Records start → persists "running" entry
//   5. Runs fn(); captures result summary / error
//   6. Finalizes history entry with status + duration
//   7. Returns { wrapped: true, jobId, runId, ... } merged with fn result
// ============================================================

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getJobControl, appendJobRun, updateJobRun } from "./store";
import { getJobDescriptor } from "./registry";
import type { JobId, JobRunStatus, JobRunRecord } from "./types";
import { envSatisfied } from "@/lib/connect/env-satisfied";

// ── In-process overlap guard ──────────────────────────────

const RUNNING_JOBS = new Set<JobId>();

// ── Public API ────────────────────────────────────────────

export interface JobTracingOpts {
  /** Who triggered this run. Defaults to "cron" */
  triggeredBy?: string;
}

/**
 * Wrap a cron handler. Returns a NextResponse on early exit (paused / overlap / preflight),
 * or the fn result wrapped with job tracing metadata.
 */
export async function withJobTracing<T>(
  jobId: JobId,
  fn: () => Promise<T>,
  opts: JobTracingOpts = {},
): Promise<NextResponse | (T & { _job: { runId: string; jobId: JobId; durationMs: number } })> {
  const triggeredBy = opts.triggeredBy ?? "cron";
  const desc        = getJobDescriptor(jobId);
  const control     = getJobControl(jobId);

  // ── 1. Pause check ─────────────────────────────────────
  if (!control.enabled) {
    return NextResponse.json({
      paused: true,
      jobId,
      reason: control.pauseReason ?? "Job is paused",
      pausedBy: control.pausedBy,
      pausedAt: control.pausedAt,
    }, { status: 423 }); // 423 Locked
  }

  // ── 2. Preflight — required env vars ───────────────────
  const missingEnv = desc.requiredEnv.filter(k => !envSatisfied(k) && k !== "CRON_SECRET");
  if (missingEnv.length > 0) {
    const runId = crypto.randomUUID();
    const now   = new Date().toISOString();
    await appendJobRun({
      runId, jobId, status: "preflight_failed",
      startedAt: now, finishedAt: now, durationMs: 0,
      resultSummary: null,
      errorSummary:  `Missing env vars: ${missingEnv.join(", ")}`,
      triggeredBy,
    });
    return NextResponse.json({
      success: false,
      jobId,
      error:   `Preflight failed — missing: ${missingEnv.join(", ")}`,
    }, { status: 503 });
  }

  // ── 3. Overlap guard ───────────────────────────────────
  if (RUNNING_JOBS.has(jobId)) {
    const runId = crypto.randomUUID();
    const now   = new Date().toISOString();
    await appendJobRun({
      runId, jobId, status: "skipped",
      startedAt: now, finishedAt: now, durationMs: 0,
      resultSummary: "Skipped — previous run still in progress",
      errorSummary: null,
      triggeredBy,
    });
    return NextResponse.json({
      success: false,
      jobId,
      skipped: true,
      reason: "Previous run still in progress",
    }, { status: 409 });
  }

  // ── 4. Record start ────────────────────────────────────
  const runId    = crypto.randomUUID();
  const startMs  = Date.now();
  const startIso = new Date(startMs).toISOString();

  const startRecord: JobRunRecord = {
    runId, jobId, status: "running",
    startedAt: startIso, finishedAt: null, durationMs: null,
    resultSummary: null, errorSummary: null, triggeredBy,
  };
  await appendJobRun(startRecord);
  RUNNING_JOBS.add(jobId);

  // ── 5. Execute ─────────────────────────────────────────
  let runStatus: JobRunStatus = "success";
  let resultSummary: string | null = null;
  let errorSummary:  string | null = null;
  let result: T | undefined;

  try {
    result = await fn();
    // Best-effort: extract summary from common result shapes
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      if (typeof r.summary === "string") resultSummary = r.summary;
      else if (typeof r.message === "string") resultSummary = r.message;
      else if (r.nba && typeof r.nba === "object") {
        const nba = r.nba as Record<string, unknown>;
        resultSummary = `NBA: ${nba.generated ?? 0} generated, ${nba.applied ?? 0} applied (${nba.mode ?? "?"})`;
      }
    }
  } catch (err) {
    runStatus    = "failure";
    errorSummary = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
  } finally {
    RUNNING_JOBS.delete(jobId);
  }

  // ── 6. Finalize ────────────────────────────────────────
  const finishMs  = Date.now();
  const durationMs = finishMs - startMs;
  const finishIso  = new Date(finishMs).toISOString();

  await updateJobRun(jobId, runId, {
    status:        runStatus,
    finishedAt:    finishIso,
    durationMs,
    resultSummary,
    errorSummary,
  });

  if (runStatus === "failure") {
    // Re-throw so the cron route can return 500 — but history is already persisted
    throw new Error(errorSummary ?? "Job failed");
  }

  // Merge _job metadata into the result object
  const jobMeta = { runId, jobId, durationMs };
  return { ...(result as object), _job: jobMeta } as T & { _job: typeof jobMeta };
}
