// ============================================================
// Cron / Job Observability — shared types
// ============================================================

// Removed 2026-07-13: budget_check, cpl_monitor, anomaly_check,
// auto_apply, audience_compare, cleanup_drafts — each pointed at an
// app/api route that was never built (empty directory, 404 on trigger).
// vercel.json's own comment already documented this drift; this is the
// same cleanup applied to the registry that actually drives /settings/jobs.
// Their underlying capabilities aren't all gone: anomaly detection still
// runs live inside lib/morning-briefing.ts, CPL/budget checks run inside
// nba_engine's pipeline — only the standalone cron endpoints were dead.
export type JobId =
  | "google_monitor"
  | "google_budget_optimizer"
  | "quality_score_mbc"
  | "quality_score_mbi"
  | "weekly_report"
  | "alerts_digest"
  | "nba_engine"            // main /api/cron orchestrator
  | "automation_sim_apply"  // /api/cron/automation-sim-apply
  | "decision_memory_eval"  // /api/cron/decision-memory-eval
  | "leads_notify"          // /api/cron/leads-notify
  | "orders_notify"         // /api/cron/orders-notify
  | "kpi_report"            // /api/cron/kpi-report
  | "ab_test_auto_stop"     // /api/cron/ab-test-auto-stop
  | "improvements_auto_apply" // /api/cron/improvements-auto-apply
  | "alert_scan"            // /api/cron/alert-scan
  | "policy_radar_scan"     // /api/cron/policy-radar-scan
  | "job_health_monitor"    // /api/cron/job-health-monitor
  | "case_remeasure"        // /api/cron/case-remeasure
  | "measure_monitor"       // /api/cron/measure-monitor
  | "playbook_meta_sync"    // /api/cron/playbook-meta-sync
  | "playbook_extract"      // /api/cron/playbook-extract
  | "lead_flow_watch"       // /api/cron/lead-flow-watch
  | "playbook_outcomes"     // /api/cron/playbook-outcomes
  | "pmax_auto_controls"    // /api/cron/pmax-auto-controls
  | "pmax_experiments"      // /api/cron/pmax-experiments
  | "lead_quality_upload"   // /api/cron/lead-quality-upload
  | "lead_flow_morning"     // /api/cron/lead-flow-morning
  | "system_morning"        // /api/cron/system-morning
  | "numbers_check"         // /api/cron/numbers-check
  | "inbox_build"           // /api/cron/inbox-build
  | "inbox_digest"          // /api/cron/inbox-digest
  | "write_outcomes"        // /api/cron/write-outcomes
  | "real_orders_sync"      // /api/cron/real-orders-sync
  | "split_tracking"        // /api/cron/split-tracking
  | "query_smoke";          // /api/cron/query-smoke

export type JobRunStatus =
  | "success"    // completed without error
  | "failure"    // threw or returned error
  | "skipped"    // paused or overlap guard fired
  | "running"    // currently executing (persisted for crash detection)
  | "preflight_failed"; // env/config not ready

export type JobRiskLevel =
  | "low"    // read-only, no side effects
  | "medium" // writes internal data, no external API mutations
  | "high";  // triggers real ad-account mutations

// Whether docker-entrypoint.sh actually schedules this job automatically,
// or whether it only ever runs via the manual "Run" button in
// /settings/jobs — distinct states so the UI never implies a cadence that
// doesn't exist (see docs/RBAC-AUDIT.md-adjacent cron cleanup, 2026-07-13).
export type JobSchedulingStatus =
  | "auto"               // wired into docker-entrypoint.sh's crontab
  | "manual_only";        // real route, deliberately not auto-scheduled

// ── Per-run record ─────────────────────────────────────────

export interface JobRunRecord {
  runId: string;         // uuid-style unique id per execution
  jobId: JobId;
  status: JobRunStatus;
  startedAt: string;     // ISO
  finishedAt: string | null;
  durationMs: number | null;
  /** One-line human-readable summary — no secrets */
  resultSummary: string | null;
  /** Error message (trimmed, no stack, no secrets) */
  errorSummary: string | null;
  /** Who triggered: "cron" | "manual:<actor_email>" */
  triggeredBy: string;
}

// ── Job control (pause / resume / config) ─────────────────

export interface JobControlRecord {
  jobId: JobId;
  enabled: boolean;         // false = paused
  pausedAt: string | null;  // ISO when paused
  pausedBy: string | null;  // actor email
  pauseReason: string | null;
  /** Manual override for max retries / timeout — null = use registry default */
  overrideMaxDuration?: number;
  note?: string;
}

// ── Aggregated job state (read model) ─────────────────────

export interface JobState {
  jobId: JobId;
  enabled: boolean;
  pauseReason: string | null;
  pausedBy: string | null;
  pausedAt: string | null;
  lastRun: JobRunRecord | null;
  lastSuccess: JobRunRecord | null;
  lastFailure: JobRunRecord | null;
  /** ISO of last run start, or null */
  lastRunAt: string | null;
  /** Approximate next fire time (from cron expr + last run) */
  nextExpectedAt: string | null;
  /** Khoảng lặp của job, suy từ cron expr (ms). null = không suy được. */
  intervalMs: number | null;
  /**
   * Job đã QUÁ HẠN chạy: quá nextExpectedAt cộng thêm một khoảng ân hạn.
   * Thêm 17/09/2026 sau sự cố cron thông báo lead/đơn hàng chết 16 tiếng mà
   * không ai biết — màn hình Jobs lúc đó không có cách nào nói "job này đã im".
   */
  isStale: boolean;
  /** Đã im bao lâu (ms) tính từ lần chạy cuối. null nếu chưa từng chạy hoặc không trễ. */
  staleForMs: number | null;
  recentHistory: JobRunRecord[];
}

// ── Persisted files ─────────────────────────────────────────

export interface JobControlFile {
  updatedAt: string;
  controls: Partial<Record<JobId, JobControlRecord>>;
}

export interface JobHistoryFile {
  updatedAt: string;
  /** Per-job rolling history, max MAX_HISTORY_PER_JOB entries */
  history: Partial<Record<JobId, JobRunRecord[]>>;
}
