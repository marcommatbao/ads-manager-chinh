"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Play, Pause, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock, SkipForward, AlertCircle, Search, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";

// ── Types ────────────────────────────────────────────────

type JobRunStatus = "success" | "failure" | "skipped" | "running" | "preflight_failed";
type RiskLevel = "low" | "medium" | "high";
type SchedulingStatus = "auto" | "manual_only";

interface JobRunRecord {
  runId: string; jobId: string; status: JobRunStatus;
  startedAt: string; finishedAt: string | null; durationMs: number | null;
  resultSummary: string | null; errorSummary: string | null; triggeredBy: string;
}
interface JobState {
  jobId: string; enabled: boolean; pauseReason: string | null; pausedBy: string | null; pausedAt: string | null;
  lastRun: JobRunRecord | null; lastSuccess: JobRunRecord | null; lastFailure: JobRunRecord | null;
  lastRunAt: string | null; nextExpectedAt: string | null; recentHistory: JobRunRecord[];
  intervalMs: number | null; isStale: boolean; staleForMs: number | null;
}
interface JobMeta {
  id: string; displayName: string; description: string; cronExpr: string; intervalLabel: string;
  riskLevel: RiskLevel; riskNote: string | null; endpoint: string; manualTriggerAllowed: boolean;
  schedulingStatus: SchedulingStatus;
}
interface JobsResponse {
  states: JobState[]; meta: JobMeta[]; canControl: boolean; nbaAutoApply: string;
  /** Đợt 22b: nhịp tim bộ hẹn giờ (crond → tick mỗi phút). Bản cũ của API không có → bỏ qua. */
  scheduler?: { lastTickAt: string | null; ageSec: number | null; status: "ok" | "stale" | "warming_up" | "never" };
}

// ── Helpers ───────────────────────────────────────────────

function relTime(iso: string | null, t: TFunction): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (d < 60)    return t("creative.settingsJobs.ago.s", { n: d });
  if (d < 3600)  return t("creative.settingsJobs.ago.m", { n: Math.floor(d / 60) });
  if (d < 86400) return t("creative.settingsJobs.ago.h", { n: Math.floor(d / 3600) });
  return t("creative.settingsJobs.ago.d", { n: Math.floor(d / 86400) });
}

function absTime(iso: string | null, loc: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(loc, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const RUN_STATUS: Record<JobRunStatus, { icon: React.ReactNode; cls: string }> = {
  success:         { icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: "text-emerald-600" },
  failure:         { icon: <XCircle className="h-3.5 w-3.5" />,      cls: "text-red-600" },
  skipped:         { icon: <SkipForward className="h-3.5 w-3.5" />,  cls: "text-slate-400" },
  running:         { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, cls: "text-blue-500" },
  preflight_failed:{ icon: <AlertCircle className="h-3.5 w-3.5" />,  cls: "text-amber-600" },
};

const RISK_COLORS: Record<RiskLevel, string> = {
  low:    "bg-slate-100 text-slate-600",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
  high:   "bg-red-50 text-red-700 border border-red-200",
};

// ── Orders-notify event log panel ───────────────────────────
// Answers "why wasn't order X notified?" from the browser — see
// lib/orders-notify.ts logNotifyEvent / GET /api/cron/orders-notify/events.

interface NotifyEvent {
  ts: string;
  pipeline: "draft" | "paid" | "cancel";
  action: "sent" | "skipped_permanent" | "skipped_retry" | "skipped_dedup" | "error";
  orderId: number;
  orderName: string;
  reason: string | null;
}

const EVENT_ACTION_STYLE: Record<NotifyEvent["action"], string> = {
  sent:              "text-emerald-700 bg-emerald-50 border-emerald-200",
  skipped_permanent: "text-red-700 bg-red-50 border-red-200",
  skipped_retry:     "text-amber-700 bg-amber-50 border-amber-200",
  skipped_dedup:     "text-slate-500 bg-slate-100 border-slate-200",
  error:             "text-red-700 bg-red-50 border-red-200",
};

const EVENT_ACTION_LABEL: Record<NotifyEvent["action"], MessageKey> = {
  sent: "creative.settingsJobs.ev.sent", skipped_permanent: "creative.settingsJobs.ev.skipPerm", skipped_retry: "creative.settingsJobs.ev.skipRetry",
  skipped_dedup: "creative.settingsJobs.ev.skipDedup", error: "creative.settingsJobs.ev.error",
};

function OrdersNotifyEventLog() {
  const t = useT();
  const [query, setQuery]     = useState("");
  const [events, setEvents]   = useState<NotifyEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = q.trim() ? `/api/cron/orders-notify/events?order=${encodeURIComponent(q.trim())}` : "/api/cron/orders-notify/events";
      const res = await fetch(url);
      if (res.ok) setEvents((await res.json() as { events: NotifyEvent[] }).events);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(query); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FileSearch className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          {t("creative.settingsJobs.log.title")}
        </p>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            className="w-full rounded-lg border border-slate-200 pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
            placeholder={t("creative.settingsJobs.log.placeholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") load(query); }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => load(query)} disabled={loading} className="h-auto px-2 text-xs">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("creative.settingsJobs.log.search")}
        </Button>
      </div>
      {events && events.length === 0 && (
        <p className="text-xs text-slate-400 italic">
          {query ? t("creative.settingsJobs.log.notFound", { q: query }) : t("creative.settingsJobs.log.none")}
        </p>
      )}
      {events && events.length > 0 && (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {events.map((e, i) => (
            <div key={`${e.orderId}-${e.ts}-${i}`} className="flex items-start gap-2 text-xs rounded-lg border border-slate-100 bg-white px-2 py-1.5">
              <span className={cn("shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border", EVENT_ACTION_STYLE[e.action])}>
                {t(EVENT_ACTION_LABEL[e.action])}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-mono font-semibold text-slate-700">{e.orderName}</span>
                <span className="text-slate-400 mx-1">·</span>
                <span className="text-slate-500">{e.pipeline}</span>
                {e.reason && <p className="text-slate-500 mt-0.5 break-words">{e.reason}</p>}
              </div>
              <span className="shrink-0 text-[10px] text-slate-400">{relTime(e.ts, t)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Teams webhooks panel ─────────────────────────────────
//
// Trước đây đổi link webhook Teams (leads_notify/orders_notify/
// job_health_monitor) phải sửa biến môi trường ở Coolify hoặc nhờ sửa code
// + deploy lại. Panel này gọi /api/settings/teams-webhooks để đổi ngay tại
// đây — có hiệu lực tức thì, không cần deploy. Biến môi trường (nếu đã đặt)
// vẫn ưu tiên hơn, giống mọi credential khác trong app — route đã tự nói rõ
// điều đó qua `source`/`overriddenByEnv` nên không cần giải thích lại ở UI.

interface TeamsWebhookRow {
  key: string; label: string; value: string; connected: boolean; source: "settings" | "env" | "none";
}

function TeamsWebhooksPanel() {
  const t = useT();
  // null = đang tải HOẶC không có quyền xem (guardViewCredentials 403) HOẶC
  // lỗi mạng — cả ba trường hợp panel đều ẩn, không cần state "canView" riêng.
  const [rows, setRows]       = useState<TeamsWebhookRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  const loadWebhooks = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/teams-webhooks");
      const json = res.ok ? await res.json() as { webhooks: TeamsWebhookRow[] } : null;
      setRows(json?.webhooks ?? null);
    } catch { /* ignore — panel just stays hidden */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadWebhooks(); }, [loadWebhooks]);

  const startEdit  = (key: string) => setEditing(e => ({ ...e, [key]: "" }));
  const cancelEdit = (key: string) => setEditing(e => {
    const rest = { ...e };
    delete rest[key];
    return rest;
  });

  const save = async (key: string) => {
    const value = editing[key]?.trim();
    if (!value) return;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const res = await fetch("/api/settings/teams-webhooks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const json = await res.json() as { ok?: boolean; message?: string };
      if (json.ok) { showToast(json.message ?? t("creative.settingsJobs.tw.saved")); cancelEdit(key); await loadWebhooks(); }
      else showToast(json.message ?? t("creative.settingsJobs.tw.saveErr"), false);
    } catch { showToast("Network error", false); }
    setSaving(s => ({ ...s, [key]: false }));
  };

  // Skeleton chỉ trong lúc TẢI LẦN ĐẦU — tải xong mà rows vẫn null (không có
  // quyền xem hoặc lỗi mạng) thì ẩn hẳn panel, không hiện khung rỗng mãi.
  if (loading && !rows) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }
  if (!rows) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">{t("creative.settingsJobs.tw.title")}</p>
          <a href="/guide/ket-noi#teams" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
            {t("creative.settingsJobs.tw.guide")}
          </a>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {t("creative.settingsJobs.tw.desc")}
        </p>
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.key} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700">{row.label}</p>
              {editing[row.key] !== undefined ? (
                <input
                  autoFocus
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder={t("creative.settingsJobs.tw.paste")}
                  value={editing[row.key]}
                  onChange={e => setEditing(ed => ({ ...ed, [row.key]: e.target.value }))}
                />
              ) : (
                <p className="text-xs font-mono text-slate-500 truncate">
                  {row.connected ? row.value : t("creative.settingsJobs.tw.notSet")}
                  {row.connected && (
                    <span className={cn("ml-1.5 text-[10px] font-sans", row.source === "env" ? "text-slate-400" : "text-emerald-600")}
                      title={row.source === "env" ? t("creative.settingsJobs.tw.envTip") : t("creative.settingsJobs.tw.hereTip")}>
                      {row.source === "env" ? t("creative.settingsJobs.tw.env") : t("creative.settingsJobs.tw.here")}
                    </span>
                  )}
                </p>
              )}
            </div>
            {editing[row.key] !== undefined ? (
              <div className="flex gap-1 shrink-0">
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => cancelEdit(row.key)}>{t("creative.settingsJobs.cancel")}</Button>
                <Button size="sm" className="h-7 px-2 text-xs bg-amber-600 text-white hover:bg-amber-700"
                  disabled={!editing[row.key]?.trim() || saving[row.key]} onClick={() => save(row.key)}>
                  {saving[row.key] ? <Loader2 className="h-3 w-3 animate-spin" /> : t("creative.settingsJobs.save")}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => startEdit(row.key)}>
                {t("creative.settingsJobs.edit")}
              </Button>
            )}
          </div>
        ))}
      </div>
      {toast && (
        <p className={cn("text-xs font-medium", toast.ok ? "text-emerald-600" : "text-red-600")}>{toast.msg}</p>
      )}
    </div>
  );
}

// ── Pause dialog ─────────────────────────────────────────

function PauseDialog({ jobId, onConfirm, onCancel }: { jobId: string; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl space-y-4">
        <p className="font-semibold text-slate-800">{t("creative.settingsJobs.pd.title")} <span className="font-mono text-sm text-slate-600">{jobId}</span></p>
        <p className="text-xs text-slate-500">{t("creative.settingsJobs.pd.hint")}</p>
        <textarea
          className="w-full rounded-lg border border-slate-200 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          rows={3}
          placeholder={t("creative.settingsJobs.pd.placeholder")}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>{t("creative.settingsJobs.cancel")}</Button>
          <Button size="sm" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}
            className="bg-amber-600 text-white hover:bg-amber-700">
            {t("creative.settingsJobs.pd.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Job row ───────────────────────────────────────────────

function JobRow({
  state, meta, canControl,
  onPause, onResume, onTrigger,
  acting, triggering,
}: {
  state: JobState; meta: JobMeta; canControl: boolean;
  onPause: () => void; onResume: () => void; onTrigger: () => void;
  acting: boolean; triggering: boolean;
}) {
  const t = useT();
  const loc = useIntlLocale();
  const [expanded, setExpanded] = useState(false);
  const lastRun = state.lastRun;
  const runStatus = lastRun?.status;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50/50"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Enabled indicator */}
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0 mt-0.5",
          !state.enabled ? "bg-amber-400" :
          runStatus === "failure" ? "bg-red-500" :
          runStatus === "success" ? "bg-emerald-500 animate-pulse" :
          "bg-slate-300"
        )} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800 truncate">{meta.displayName}</p>
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", RISK_COLORS[meta.riskLevel])}>
              {meta.riskLevel.toUpperCase()}
            </span>
            {meta.schedulingStatus === "manual_only" && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
                title={t("creative.settingsJobs.manualTip")}
              >
                {t("creative.settingsJobs.manualOnly")}
              </span>
            )}
            <span className="text-xs text-slate-400">{meta.intervalLabel}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{meta.description}</p>
        </div>

        {/* Last run status */}
        <div className="text-right shrink-0 min-w-[90px]">
          {lastRun ? (
            <div className={cn("flex items-center gap-1 justify-end", RUN_STATUS[lastRun.status].cls)}>
              {RUN_STATUS[lastRun.status].icon}
              <span className="text-xs font-medium">{relTime(lastRun.startedAt, t)}</span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">{t("creative.settingsJobs.neverRun")}</span>
          )}
          {lastRun?.durationMs != null && (
            <p className="text-[10px] text-slate-400">{(lastRun.durationMs / 1000).toFixed(1)}s</p>
          )}
        </div>

        {/* Controls */}
        {canControl && (
          <div className="flex gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
            {state.enabled ? (
              <Button variant="outline" size="sm" onClick={onPause} disabled={acting}
                className="h-7 px-2 text-xs gap-1 border-amber-200 text-amber-700 hover:bg-amber-50">
                {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                Pause
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onResume} disabled={acting}
                className="h-7 px-2 text-xs gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Resume
              </Button>
            )}
            {meta.manualTriggerAllowed && state.enabled && (
              <Button variant="outline" size="sm" onClick={onTrigger} disabled={triggering}
                className="h-7 px-2 text-xs gap-1 border-slate-200 hover:bg-slate-50">
                {triggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Run
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/30 px-4 py-3 space-y-3">

          {/* Job ĐÁNG LẼ phải chạy mà không chạy. Thêm 17/09/2026: hai cron
              thông báo lead/đơn hàng chết 16 tiếng, màn hình này lúc đó không
              có gì nói ra điều đó — "Next expected" bị tính sai thành +24h cho
              job 5 phút/lần nên không bao giờ trông như trễ. */}
          {state.isStale && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-300 p-3">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-800">
                  {t("creative.settingsJobs.stale.title", { dur: fmtDuration(state.staleForMs, t), interval: meta.intervalLabel?.toLowerCase() ?? t("creative.settingsJobs.onSchedule") })}
                </p>
                <p className="text-xs text-red-700 mt-0.5">
                  {t("creative.settingsJobs.stale.desc")}
                </p>
              </div>
            </div>
          )}
          {!state.enabled && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">{t("creative.settingsJobs.paused")}</p>
                {state.pauseReason && <p className="text-xs text-amber-700 mt-0.5">{state.pauseReason}</p>}
                {state.pausedBy && <p className="text-[10px] text-amber-600 mt-0.5">{t("creative.settingsJobs.pausedBy", { by: state.pausedBy, when: relTime(state.pausedAt, t) })}</p>}
              </div>
            </div>
          )}

          {meta.riskNote && meta.riskLevel === "high" && (
            <p className="text-xs text-red-600"><span className="font-semibold">Risk: </span>{meta.riskNote}</p>
          )}

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-slate-500 font-medium">Last success</p>
              <p className="text-emerald-700 mt-0.5">{absTime(state.lastSuccess?.startedAt ?? null, loc)}</p>
            </div>
            <div>
              <p className="text-slate-500 font-medium">Last failure</p>
              <p className="text-red-600 mt-0.5">{absTime(state.lastFailure?.startedAt ?? null, loc)}</p>
            </div>
            <div>
              <p className="text-slate-500 font-medium">Next expected</p>
              <p className="text-slate-700 mt-0.5">{absTime(state.nextExpectedAt, loc)}</p>
            </div>
          </div>

          {/* Recent history */}
          {state.recentHistory.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Recent runs</p>
              {state.recentHistory.map(r => (
                <div key={r.runId} className="flex items-center gap-2 text-xs">
                  <span className={cn("shrink-0", RUN_STATUS[r.status].cls)}>{RUN_STATUS[r.status].icon}</span>
                  <span className="text-slate-500 w-20 shrink-0">{relTime(r.startedAt, t)}</span>
                  {r.durationMs != null && <span className="text-slate-400 w-12 shrink-0">{(r.durationMs / 1000).toFixed(1)}s</span>}
                  <span className="text-slate-600 truncate">{r.resultSummary ?? r.errorSummary ?? r.status}</span>
                  <span className="text-slate-400 ml-auto shrink-0 text-[10px]">{r.triggeredBy}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-400 font-mono">{meta.endpoint}</p>

          {state.jobId === "orders_notify" && <OrdersNotifyEventLog />}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────

/** 5400000 → "1 giờ 30 phút". Dùng cho cảnh báo job im. */
function fmtDuration(ms: number | null, t: TFunction): string {
  if (ms === null || ms <= 0) return "—";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return t("creative.settingsJobs.dur.m", { m });
  return m === 0 ? t("creative.settingsJobs.dur.h", { h }) : t("creative.settingsJobs.dur.hm", { h, m });
}

export default function JobsPage() {
  const t = useT();
  const loc = useIntlLocale();
  const [data, setData]           = useState<JobsResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [pauseTarget, setPauseTarget] = useState<string | null>(null);
  const [acting, setActing]       = useState<Record<string, boolean>>({});
  const [triggering, setTriggering] = useState<Record<string, boolean>>({});
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // 29/09: bấm Refresh trước đây tải lại âm thầm (không xoay, không báo) → user tưởng nút hỏng. Nay có trạng thái + giờ cập nhật + lỗi.
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (res.ok) { setData(await res.json() as JobsResponse); setLoadError(null); setLoadedAt(new Date().toLocaleTimeString(loc, { timeZone: "Asia/Ho_Chi_Minh" })); }
      else setLoadError(t("creative.settingsJobs.err.http", { status: res.status }));
    } catch { setLoadError(t("creative.settingsJobs.err.net")); }
    finally { setLoading(false); setRefreshing(false); }
  }, [t, loc]);

  useEffect(() => { load(); }, [load]);

  const handlePause = async (jobId: string, reason: string) => {
    setPauseTarget(null);
    setActing(a => ({ ...a, [jobId]: true }));
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", reason }),
      });
      if (res.ok) { showToast(t("creative.settingsJobs.toast.paused", { id: jobId })); await load(); }
      else showToast(t("creative.settingsJobs.toast.pauseErr"), false);
    } catch { showToast("Network error", false); }
    setActing(a => ({ ...a, [jobId]: false }));
  };

  const handleResume = async (jobId: string) => {
    setActing(a => ({ ...a, [jobId]: true }));
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (res.ok) { showToast(t("creative.settingsJobs.toast.resumed", { id: jobId }), true); await load(); }
      else showToast(t("creative.settingsJobs.toast.resumeErr"), false);
    } catch { showToast("Network error", false); }
    setActing(a => ({ ...a, [jobId]: false }));
  };

  const handleTrigger = async (jobId: string) => {
    setTriggering(t => ({ ...t, [jobId]: true }));
    try {
      const res = await fetch(`/api/jobs/${jobId}/trigger`, { method: "POST" });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) { showToast(`Job triggered: ${jobId}`); setTimeout(load, 2000); }
      else showToast(json.error ?? "Trigger failed", false);
    } catch { showToast("Network error", false); }
    setTriggering(t => ({ ...t, [jobId]: false }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }
  if (!data) return null;

  const metaById = Object.fromEntries(data.meta.map(m => [m.id, m]));
  const pausedCount  = data.states.filter(s => !s.enabled).length;
  const failedCount  = data.states.filter(s => s.lastRun?.status === "failure").length;
  const staleCount   = data.states.filter(s => s.isStale).length;
  const highRiskJobs = data.meta.filter(m => m.riskLevel === "high").length;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Cron Jobs &amp; Background Tasks</p>
          <div className="flex items-center gap-4 mt-1 text-xs">
            <span className="text-slate-500">{data.states.length} jobs</span>
            {pausedCount > 0 && <span className="text-amber-700 font-medium">{pausedCount} paused</span>}
            {failedCount > 0 && <span className="text-red-700 font-medium">{failedCount} last-failed</span>}
            {staleCount > 0 && <span className="text-red-700 font-bold">{t("creative.settingsJobs.silent", { n: staleCount })}</span>}
            <span className="text-slate-400">NBA_AUTO_APPLY = <span className={cn("font-semibold font-mono", data.nbaAutoApply === "on" ? "text-red-600" : "text-slate-600")}>{data.nbaAutoApply}</span></span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loadError ? <span className="text-[11px] text-red-600">{loadError}</span> : loadedAt && <span className="text-[11px] text-slate-400">{t("creative.settingsJobs.updatedAt", { time: loadedAt })}</span>}
          <Button variant="outline" size="sm" onClick={load} disabled={refreshing} className="gap-1.5 text-xs border-slate-200">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> {refreshing ? t("creative.settingsJobs.loadingEllipsis") : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Đợt 22b: bộ hẹn giờ ngừng → MỌI job tự động im lặng (kể cả job canh sức khoẻ) — chỉ trang này báo được. */}
      {(data.scheduler?.status === "stale" || data.scheduler?.status === "never") && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">{t("creative.settingsJobs.sched.title")}</p>
            <p className="text-xs text-red-700 mt-0.5">
              {t("creative.settingsJobs.sched.body", { head: data.scheduler.status === "never" ? t("creative.settingsJobs.sched.never") : t("creative.settingsJobs.sched.age", { n: Math.round((data.scheduler.ageSec ?? 0) / 60) }) })}
            </p>
          </div>
        </div>
      )}

      {/* High-risk warning if NBA_AUTO_APPLY=on */}
      {data.nbaAutoApply === "on" && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">NBA_AUTO_APPLY = on</p>
            <p className="text-xs text-red-700 mt-0.5">
              {t("creative.settingsJobs.nba", { n: highRiskJobs })}
            </p>
          </div>
        </div>
      )}

      <TeamsWebhooksPanel />

      {/* Job list */}
      <div className="space-y-2">
        {data.states.map(state => {
          const meta = metaById[state.jobId];
          if (!meta) return null;
          return (
            <JobRow
              key={state.jobId}
              state={state}
              meta={meta}
              canControl={data.canControl}
              onPause={() => setPauseTarget(state.jobId)}
              onResume={() => handleResume(state.jobId)}
              onTrigger={() => handleTrigger(state.jobId)}
              acting={!!acting[state.jobId]}
              triggering={!!triggering[state.jobId]}
            />
          );
        })}
      </div>

      {/* Pause dialog */}
      {pauseTarget && (
        <PauseDialog
          jobId={pauseTarget}
          onConfirm={reason => handlePause(pauseTarget, reason)}
          onCancel={() => setPauseTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 shadow-lg text-sm font-medium",
          toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white",
        )}>
          {toast.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
