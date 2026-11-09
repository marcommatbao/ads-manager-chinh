// ============================================================
// Badge màu + nhãn dùng chung cho các bảng ở /settings/health.
// Cùng phong cách với hàm Badge() cục bộ trong components/search/SearchXrayTab.tsx.
// ============================================================

import { cn } from "@/lib/utils";
import type {
  JobHealthStatus, ConnectorHealthStatus, JobRiskLevel, JobScheduledBy,
} from "./types";
import type { NumberCheck } from "@/lib/jobs/numbers-check";
import type { MessageKey } from "@/lib/i18n/messages";

export function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {children}
    </span>
  );
}

export const JOB_STATUS_META: Record<JobHealthStatus, { label: MessageKey; cls: string }> = {
  failed:  { label: "overview.health.badge.job.failed", cls: "bg-red-50 text-red-700 border-red-200" },
  missed:  { label: "overview.health.badge.job.missed", cls: "bg-red-50 text-red-700 border-red-200" },
  stale:   { label: "overview.health.badge.job.stale", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  paused:  { label: "overview.health.badge.job.paused", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  waiting: { label: "overview.health.badge.job.waiting", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  never:   { label: "overview.health.badge.job.never", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  ok:      { label: "overview.health.badge.job.ok", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export const CONNECTOR_STATUS_META: Record<ConnectorHealthStatus, { label: MessageKey; cls: string }> = {
  healthy:         { label: "overview.health.badge.conn.healthy", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  auth_error:      { label: "overview.health.badge.conn.auth_error", cls: "bg-red-50 text-red-700 border-red-200" },
  service_error:   { label: "overview.health.badge.conn.service_error", cls: "bg-red-50 text-red-700 border-red-200" },
  missing_config:  { label: "overview.health.badge.conn.missing_config", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  disabled:        { label: "overview.health.badge.conn.disabled", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  warning:         { label: "overview.health.badge.conn.warning", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

export const RISK_META: Record<JobRiskLevel, { label: string; cls: string }> = {
  low:    { label: "LOW",    cls: "bg-slate-100 text-slate-600" },
  medium: { label: "MEDIUM", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  high:   { label: "HIGH",   cls: "bg-red-50 text-red-700 border border-red-200" },
};

export const NUMBERS_STATUS_META: Record<NumberCheck["status"], { label: MessageKey; cls: string }> = {
  ok:   { label: "overview.health.badge.num.ok", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lech: { label: "overview.health.badge.num.lech", cls: "bg-red-50 text-red-700 border-red-200" },
  loi:  { label: "overview.health.badge.num.loi", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

export const SCHEDULED_BY_LABEL: Record<JobScheduledBy, MessageKey> = {
  entrypoint: "overview.health.badge.by.entrypoint",
  tick: "overview.health.badge.by.tick",
  manual: "overview.health.badge.by.manual",
};
