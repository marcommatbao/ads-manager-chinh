// ============================================================
// Types cho trang /settings/health — mirror đúng JSON mà
// GET/POST /api/system/health trả về (app/api/system/health/route.ts).
// Đây là bản khai FRONTEND, không phải nguồn sự thật — nguồn thật nằm ở
// lib/jobs/*, lib/connectors/*, chỉ import type từ đó, không import giá trị
// (các module đó kéo Google Ads / Meta SDK, không chạy được ở client).
// ============================================================

import type { NumbersCheckResult } from "@/lib/jobs/numbers-check";

export type JobHealthStatus =
  | "failed"   // lần chạy cuối lỗi
  | "missed"   // lẽ ra chạy mà chưa chạy (job "auto" quá hạn)
  | "stale"    // im lâu hơn dự kiến
  | "paused"   // đang bị tạm dừng
  | "waiting"  // job "auto" chưa từng chạy lần nào
  | "never"    // job chỉ-thủ-công chưa từng được bấm chạy
  | "ok";

export type JobLastRunStatus = "success" | "failure" | "skipped" | "running" | "preflight_failed";

export type JobScheduledBy = "manual" | "entrypoint" | "tick";

export type JobRiskLevel = "low" | "medium" | "high";

export interface HealthJob {
  id: string;
  name: string;
  description: string;
  intervalLabel: string;
  cronExpr: string;
  riskLevel: JobRiskLevel;
  riskNote: string | null;
  scheduledBy: JobScheduledBy;
  enabled: boolean;
  pausedBy: string | null;
  pauseReason: string | null;
  envDisabled: boolean;
  lastRunAt: string | null;
  lastStatus: JobLastRunStatus | null;
  lastError: string | null;
  lastSummary: string | null;
  lastTriggeredBy: string | null;
  lastSuccessAt: string | null;
  nextAt: string | null;
  missedAt: string | null;
  status: JobHealthStatus;
}

export type ConnectorHealthStatus =
  | "healthy"
  | "warning"
  | "missing_config"
  | "auth_error"
  | "service_error"
  | "disabled";

export interface HealthConnector {
  id: string;
  status: ConnectorHealthStatus;
  reason: string | null;
  lastChecked: string | null;
}

export interface HealthAlertChannel {
  teams: boolean;
  telegramDisabled: boolean;
}

export interface HealthResponse {
  success: true;
  now: string;
  bootAt: string;
  jobs: HealthJob[];
  connectors: HealthConnector[];
  alertChannel: HealthAlertChannel;
  numbersCheck: NumbersCheckResult | null;
  /** Đợt 24c — phiên bản mã + kết quả kiểm data/ lúc khởi động. Bản cũ của API không có. */
  version?: { app: string; data: { status: "current" | "fresh" | "baseline" | "migrated" | "newer" | "failed"; from: number | null; to: number; target: number; backup: string | null; error: string | null } | null };
  canControl: boolean;
}

export interface TestAlertResponse {
  success: boolean;
  channel: "teams" | "telegram" | null;
  error: string | null;
}
