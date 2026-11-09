"use client";

// ============================================================
// Báo cáo quản lý tuần (Đợt 15c) — đọc GET /api/reports/weekly-summary.
// Job weekly_report dựng mỗi thứ Hai 08:30 (VN) + gửi Teams kênh Ads; trang lưu từng tuần để xem lại.
// Số tính bằng mã (lib/reports/weekly.ts); nguồn hỏng ghi "không đọc được", không hiện 0.
// ============================================================

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, CalendarRange, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { datetimeVN } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { WeeklyReport } from "@/lib/reports/weekly";

interface Resp {
  weeks: { key: string; label: string }[];
  report: (WeeklyReport & { sent?: { at: string; sent: boolean; notConfigured?: boolean; error?: string } }) | null;
  canEdit: boolean;
}

const TONE: Record<string, string> = { good: "text-green-700", bad: "text-red-700", warn: "text-amber-700" };

function WeeklyReportPage() {
  const intl = useIntlLocale();
  const t = useT();
  const sp = useSearchParams();
  const [week, setWeek] = useState<string | null>(sp.get("week"));
  const { data, error, isLoading, mutate } = useSWR<Resp>(`/api/reports/weekly-summary${week ? `?week=${week}` : ""}`, getJson);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function rebuild() {
    setBusy(true); setMsg(null);
    try { const r = await postJson("/api/reports/weekly-summary", { op: "rebuild" }); setWeek(r.report.weekKey); await mutate(); setMsg(t("overview.weekly.rebuilt")); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : t("overview.weekly.rebuildFail")); }
    finally { setBusy(false); }
  }

  const r = data?.report;
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><CalendarRange className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("overview.weekly.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("overview.weekly.desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          {!!data?.weeks.length && (
            <select aria-label={t("overview.weekly.weekAria")} value={r?.weekKey ?? ""} onChange={(e) => setWeek(e.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm">
              {data.weeks.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          )}
          {data?.canEdit && (
            <Button className="h-10" variant="outline" size="sm" disabled={busy} onClick={rebuild}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("overview.weekly.rebuild")}
            </Button>
          )}
        </div>
      </div>

      {msg && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{msg}</div>}
      {isLoading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("overview.weekly.loading")}</div>}
      {error && <EmptyState icon={AlertTriangle} title={t("overview.weekly.loadFailTitle")} description={error instanceof ApiError ? error.message : t("overview.weekly.loadFailDesc")} />}
      {data && !r && <EmptyState icon={CalendarRange} title={t("overview.weekly.emptyTitle")} description={t("overview.weekly.emptyDesc")} />}

      {r && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{r.label}</span>
            <span>{t("overview.weekly.built", { time: datetimeVN(r.builtAt, intl) })}</span>
            {r.sent && <span>{r.sent.sent ? t("overview.weekly.sentOk", { time: datetimeVN(r.sent.at, intl) }) : r.sent.notConfigured ? t("overview.weekly.sentNotConfigured") : t("overview.weekly.sentError", { error: r.sent.error ?? "" })}</span>}
          </div>
          {r.errors.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("overview.weekly.unreadable", { list: r.errors.join(" · ") })}</div>}
          {r.sections.map((s) => (
            <section key={s.title} className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-4 py-2.5 font-semibold text-slate-900">{s.title}</h2>
              <table className="w-full text-sm">
                <tbody>
                  {s.rows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className={cn("px-4 py-2 text-slate-700", row.label.startsWith("  ") && "pl-8 text-slate-500")}>{row.label.trim()}</td>
                      <td className={cn("px-4 py-2 text-right font-semibold tabular-nums", row.tone ? TONE[row.tone] : "text-slate-900")}>{row.value}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={null}><WeeklyReportPage /></Suspense>;
}
