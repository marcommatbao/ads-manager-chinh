"use client";

// ============================================================
// Dashboard → KPI Tổng Quan → khối "Phân tích AI".
// ------------------------------------------------------------
// Hai loại nội dung trong khối này, và chúng được vẽ khác nhau CÓ CHỦ Ý:
//   • Con số (ô thống kê, trạng thái từng tháng, chỗ hụt số liệu) — do hệ thống
//     tính, luôn hiện, kể cả khi AI hỏng.
//   • Văn xuôi (tóm tắt, nhận định, đề xuất) — do AI viết, có nhãn rõ.
// Trộn hai thứ vào cùng một khung không phân biệt là cách nhanh nhất để một câu
// AI đoán sai trông y hệt một con số hệ thống đo được.
// ============================================================

import { useState } from "react";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";
import {
  Sparkles, RefreshCw, AlertTriangle, TrendingUp, Wallet,
  ShoppingCart, CheckCircle2, CircleAlert, XCircle, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
// Chỉ import từ .shared.ts: kpi-analysis-facts.ts kéo theo fs qua kpi-store,
// import vào đây là gói client gãy lúc build.
import { MONTH_STATUS_LABEL, type KpiFacts, type MonthStatus, type KpiAiNarrative } from "@/lib/finance/kpi-analysis.shared";
import type { KpiAnalysisResponse } from "@/app/api/dashboard/kpi-analysis/route";

interface Props {
  year: number;
  targets: unknown[];
  actuals: unknown[];
  /** Bảng đã tải xong chưa — chưa xong thì không cho bấm, tránh phân tích bảng rỗng. */
  ready: boolean;
}

// ── Định dạng ─────────────────────────────────────────────────

const fullLoc = (n: number, loc: string) => `${n.toLocaleString(loc)}đ`;

/** Rút gọn cho ô thống kê; số đầy đủ vẫn nằm ở tooltip. */
function shortLoc(n: number, loc: string, t: TFunction): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return t("overview.kpian.unitB", { v: (n / 1_000_000_000).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  if (abs >= 1_000_000) return t("overview.kpian.unitM", { v: Math.round(n / 1_000_000).toLocaleString(loc) });
  return n.toLocaleString(loc);
}

const STATUS_STYLE: Record<MonthStatus, string> = {
  dat: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suyt_dat: "bg-amber-50 text-amber-700 border-amber-200",
  khong_dat: "bg-rose-50 text-rose-700 border-rose-200",
  dang_chay: "bg-sky-50 text-sky-700 border-sky-200",
  chua_do_duoc: "bg-slate-100 text-slate-500 border-slate-200",
  thieu_muc_tieu: "bg-slate-100 text-slate-500 border-slate-200",
  chua_toi: "bg-slate-50 text-slate-400 border-slate-200",
};

const OVERALL: Record<KpiAiNarrative["status"], { label: MessageKey; cls: string; Icon: typeof CheckCircle2 }> = {
  on_track: { label: "overview.kpian.overallOnTrack", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  at_risk: { label: "overview.kpian.overallAtRisk", cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: CircleAlert },
  off_track: { label: "overview.kpian.overallOffTrack", cls: "bg-rose-50 text-rose-700 border-rose-200", Icon: XCircle },
};

const PRIORITY_STYLE: Record<string, string> = {
  "cao": "bg-rose-100 text-rose-700",
  "trung bình": "bg-amber-100 text-amber-700",
  "thấp": "bg-slate-100 text-slate-600",
};

function StatBox({ Icon, label, value, title, sub, tone }: {
  Icon: typeof TrendingUp; label: string; value: string; title?: string; sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div
        title={title}
        className={cn(
          "mt-1 text-lg font-bold",
          tone === "good" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
          tone === "bad" && "text-rose-600",
          !tone && "text-slate-800",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Khối chính ────────────────────────────────────────────────

export function KpiAnalysisPanel({ year, targets, actuals, ready }: Props) {
  const t = useT();
  const loc = useIntlLocale();
  const full = (n: number) => fullLoc(n, loc);
  const short = (n: number) => shortLoc(n, loc, t);
  const [data, setData] = useState<KpiAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/kpi-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, targets, actuals, force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t("overview.kpian.errStatus", { status: res.status }));
      setData(json as KpiAnalysisResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("overview.kpian.errFallback"));
    } finally {
      setLoading(false);
    }
  };

  const facts: KpiFacts | null = data?.facts ?? null;
  const ai = data?.ai ?? null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      {/* ── Thanh đầu ── */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" /> {t("overview.kpian.title")}
          </h3>
          <p className="text-sm text-slate-500">
            {t("overview.kpian.desc", { year })}
          </p>
        </div>
        <button
          onClick={() => run(data !== null)}
          disabled={loading || !ready}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white",
            "bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          title={!ready ? t("overview.kpian.loadingTitle") : undefined}
        >
          {loading
            ? <><RefreshCw className="h-4 w-4 animate-spin" /> {t("overview.kpian.analyzing")}</>
            : <><Sparkles className="h-4 w-4" /> {data ? t("overview.kpian.reanalyze") : t("overview.kpian.analyze")}</>}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {!data && !loading && !error && (
          <p className="text-sm text-slate-500">
            {t("overview.kpian.intro").split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {facts && (
          <>
            {/* ── Số hệ thống tính ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatBox
                Icon={TrendingUp}
                label={t("overview.kpian.statRevenueMbc", { n: facts.ytd.coverage.revenue.length })}
                value={facts.ytd.revenueMbc.pct !== null ? `${facts.ytd.revenueMbc.pct}%` : "—"}
                sub={`${short(facts.ytd.revenueMbc.actual ?? 0)} / ${short(facts.ytd.revenueMbc.target)}`}
                title={t("overview.kpian.statRevenueTitle", { actual: full(facts.ytd.revenueMbc.actual ?? 0), target: full(facts.ytd.revenueMbc.target) })}
                tone={facts.ytd.revenueMbc.pct === null ? undefined : facts.ytd.revenueMbc.pct >= 100 ? "good" : facts.ytd.revenueMbc.pct >= 95 ? "warn" : "bad"}
              />
              <StatBox
                Icon={ShoppingCart}
                label={t("overview.kpian.statOrdersMbi")}
                value={facts.ytd.ordersMbi.pct !== null ? `${facts.ytd.ordersMbi.pct}%` : "—"}
                sub={t("overview.kpian.statOrdersSub", { actual: (facts.ytd.ordersMbi.actual ?? 0).toLocaleString(loc), target: facts.ytd.ordersMbi.target.toLocaleString(loc) })}
                tone={facts.ytd.ordersMbi.pct === null ? undefined : facts.ytd.ordersMbi.pct >= 100 ? "good" : facts.ytd.ordersMbi.pct >= 95 ? "warn" : "bad"}
              />
              <StatBox
                Icon={Wallet}
                label={t("overview.kpian.statSpent", { n: facts.ytd.coverage.totalSpend.length })}
                value={`${short(facts.ytd.yearSpentSoFar)}`}
                sub={t("overview.kpian.statCap", { v: short(facts.ytd.yearBudgetTotal) })}
                title={`${full(facts.ytd.yearSpentSoFar)} / ${full(facts.ytd.yearBudgetTotal)}`}
              />
              <StatBox
                Icon={Wallet}
                label={t("overview.kpian.statBudgetLeft")}
                value={short(facts.ytd.yearBudgetRemaining)}
                sub={facts.ytd.ratioQcDt.actual !== null ? t("overview.kpian.statRatio", { p: facts.ytd.ratioQcDt.actual }) : undefined}
                title={full(facts.ytd.yearBudgetRemaining)}
                tone={facts.ytd.yearBudgetRemaining < 0 ? "bad" : undefined}
              />
            </div>

            {/* ── Nhận định AI ── */}
            {ai ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const o = OVERALL[ai.status];
                    return (
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", o.cls)}>
                        <o.Icon className="h-3.5 w-3.5" /> {t(o.label)}
                      </span>
                    );
                  })()}
                  <p className="font-semibold text-slate-800">{ai.headline}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {ai.kpiAssessment && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                      <div className="text-xs font-semibold text-slate-500 mb-1">{t("overview.kpian.kpiAssess")}</div>
                      <p className="text-sm text-slate-700 whitespace-pre-line">{ai.kpiAssessment}</p>
                    </div>
                  )}
                  {ai.budgetAssessment && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                      <div className="text-xs font-semibold text-slate-500 mb-1">{t("overview.kpian.budgetAssess")}</div>
                      <p className="text-sm text-slate-700 whitespace-pre-line">{ai.budgetAssessment}</p>
                    </div>
                  )}
                </div>

                {ai.recommendations.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 mb-2">{t("overview.kpian.todo")}</div>
                    <ol className="space-y-2">
                      {ai.recommendations.map((r, i) => (
                        <li key={i} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY_STYLE[r.priority] ?? PRIORITY_STYLE["trung bình"])}>
                              {r.priority}
                            </span>
                            <span className="font-semibold text-slate-800 text-sm">{r.title}</span>
                          </div>
                          {r.detail && <p className="text-sm text-slate-600 mt-1.5">{r.detail}</p>}
                          {r.expectedImpact && (
                            <p className="text-xs text-emerald-700 mt-1">{t("overview.kpian.expected", { v: r.expectedImpact })}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {ai.watchOuts.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-semibold text-amber-800 mb-1">{t("overview.kpian.watch")}</div>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-amber-900">
                      {ai.watchOuts.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              data?.aiError && (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{t("overview.kpian.aiErrPrefix")} {data.aiError} <br />{t("overview.kpian.aiErrSuffix")}</span>
                </div>
              )
            )}

            {/* ── Từng tháng: trạng thái do hệ thống, câu nhận xét do AI ── */}
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">{t("overview.kpian.byMonth")}</div>
              <div className="space-y-1.5">
                {facts.months.filter(m => m.status !== "chua_toi").map(m => {
                  const note = ai?.monthNotes.find(n => n.month === m.month)?.note;
                  return (
                    <div key={m.month} className="flex flex-wrap items-start gap-2 text-sm">
                      <span className="w-8 shrink-0 font-semibold text-slate-700">{t("overview.kpian.monthShort", { m: m.month })}</span>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[m.status])}>
                        {MONTH_STATUS_LABEL[m.status]}
                        {m.monthProgressPct !== null && t("overview.kpian.monthProgress", { p: m.monthProgressPct })}
                      </span>
                      {m.revenueMbc.pct !== null && (
                        <span className="shrink-0 text-xs text-slate-500">{t("overview.kpian.revShort", { p: m.revenueMbc.pct })}</span>
                      )}
                      {m.flags.length > 0 && (
                        <span className="text-xs text-rose-600">{m.flags.join(" ")}</span>
                      )}
                      {note && <span className="text-slate-600 flex-1 min-w-[12rem]">{note}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Chỗ hụt số liệu ── */}
            {facts.dataGaps.length > 0 && (
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" /> {t("overview.kpian.gaps")}
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-sm text-slate-600">
                  {facts.dataGaps.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            )}

            <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
              {t("overview.kpian.footer")}
              {data?.model && ` · ${data.model}`}
              {data?.generatedAt && t("overview.kpian.footAt", { time: new Date(data.generatedAt).toLocaleString(loc) })}
              {data?.cached && t("overview.kpian.footCached")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
