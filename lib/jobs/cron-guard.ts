// ============================================================
// Lightweight cron guard for use in existing route handlers.
//
// Usage (no refactor of existing logic needed):
//
//   const guard = await startJobRun("nba_engine", "cron");
//   if (guard.blocked) return guard.response!;
//   try {
//     const result = { ... };
//     await guard.finish("success", summarize(result));
//     return NextResponse.json(result);
//   } catch (err) {
//     await guard.finish("failure", null, err);
//     throw err; // or return 500
//   }
// ============================================================

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getJobControl, appendJobRun, updateJobRun } from "./store";
import { getJobDescriptor } from "./registry";
import type { JobId, JobRunStatus } from "./types";
import { envSatisfied } from "@/lib/connect/env-satisfied";

// In-process overlap guard (shared across all route invocations)
const RUNNING: Set<JobId> = new Set();

export interface JobRunHandle {
  blocked: false;
  runId: string;
  startMs: number;
  finish(status: "success" | "failure", summary?: string | null, err?: unknown): Promise<void>;
}

export interface JobBlocked {
  blocked: true;
  response: NextResponse;
}

export async function startJobRun(
  jobId: JobId,
  triggeredBy = "cron",
): Promise<JobRunHandle | JobBlocked> {
  // Đợt 24b: lượt chạy bù do nhịp tick gửi (header x-cron-catchup) → ghi rõ trong lịch sử trang Jobs.
  if (triggeredBy === "cron") {
    try {
      const { headers } = await import("next/headers")
      if ((await headers()).get("x-cron-catchup")) triggeredBy = "cron · chạy bù"
    } catch { /* ngoài ngữ cảnh request (test) — giữ "cron" */ }
  }
  // 1. Pause check
  const control = getJobControl(jobId);
  if (!control.enabled) {
    return {
      blocked: true,
      response: NextResponse.json({
        paused: true, jobId,
        reason:    control.pauseReason ?? "Job is paused",
        pausedBy:  control.pausedBy,
        pausedAt:  control.pausedAt,
      }, { status: 423 }),
    };
  }

  // 2. Preflight — required env vars (except CRON_SECRET which is already checked)
  const desc       = getJobDescriptor(jobId);
  const missingEnv = desc.requiredEnv.filter(k => k !== "CRON_SECRET" && !envSatisfied(k));
  if (missingEnv.length > 0) {
    const runId = crypto.randomUUID();
    const now   = new Date().toISOString();
    await appendJobRun({
      runId, jobId, status: "preflight_failed",
      startedAt: now, finishedAt: now, durationMs: 0,
      resultSummary: null, errorSummary: `Missing env: ${missingEnv.join(", ")}`,
      triggeredBy,
    });
    return {
      blocked: true,
      response: NextResponse.json({
        success: false, jobId,
        error: `Preflight failed — missing env: ${missingEnv.join(", ")}`,
      }, { status: 503 }),
    };
  }

  // 3. Overlap guard
  if (RUNNING.has(jobId)) {
    const runId = crypto.randomUUID();
    const now   = new Date().toISOString();
    await appendJobRun({
      runId, jobId, status: "skipped",
      startedAt: now, finishedAt: now, durationMs: 0,
      resultSummary: "Skipped — previous run still in progress", errorSummary: null,
      triggeredBy,
    });
    return {
      blocked: true,
      response: NextResponse.json({
        success: false, jobId, skipped: true,
        reason: "Previous run still in progress",
      }, { status: 409 }),
    };
  }

  // 4. Record start
  const runId   = crypto.randomUUID();
  const startMs = Date.now();
  const startIso = new Date(startMs).toISOString();
  RUNNING.add(jobId);

  await appendJobRun({
    runId, jobId, status: "running",
    startedAt: startIso, finishedAt: null, durationMs: null,
    resultSummary: null, errorSummary: null, triggeredBy,
  });

  return {
    blocked: false,
    runId,
    startMs,
    async finish(status: JobRunStatus, summary?: string | null, err?: unknown) {
      RUNNING.delete(jobId);
      const finishMs = Date.now();
      await updateJobRun(jobId, runId, {
        status,
        finishedAt:    new Date(finishMs).toISOString(),
        durationMs:    finishMs - startMs,
        resultSummary: summary ?? null,
        errorSummary:  err instanceof Error
          ? err.message.slice(0, 200)
          : typeof err === "string" ? err.slice(0, 200) : null,
      });
    },
  };
}
