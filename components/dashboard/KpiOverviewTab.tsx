"use client";

// ============================================================
// Dashboard → "KPI Tổng Quan": đối chiếu Kế hoạch (mục tiêu KPI theo tháng,
// nhập ở Settings → KPI) vs Thực tế (Meta/Google Ads + Odoo, live) cho cả năm.
// Read-only — chỉnh mục tiêu vẫn làm ở Settings → KPI.
// ============================================================

import { Fragment, useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { BUILTIN_AD_CHANNELS, OTHER_CHANNEL, channelLabel, type AdChannelDef } from "@/lib/settings/ad-channels-def";
import type { MonthActual, KpiActualsResponse } from "@/app/api/dashboard/kpi-actuals/route";
import { KpiAnalysisPanel } from "@/components/dashboard/KpiAnalysisPanel";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

// ── Types ─────────────────────────────────────────────────────

/** Kênh đặt được trần ngân sách (Settings → KPI) — lấy từ sổ kênh dùng chung (`channels` của GET /api/settings/kpi). */
type ChannelBudget = Record<string, number>;
type DisplayChannel = string;

const emptyChannels = (chs: AdChannelDef[]): ChannelBudget => Object.fromEntries(chs.map(c => [c.key, 0]));

interface MonthKpi {
  revenueMbc: number; adSpendMbc: number; adSpendMbi: number; ordersMbi: number;
  adSpendMbcByChannel: ChannelBudget;
  adSpendMbiByChannel: ChannelBudget;
}
const emptyMonth = (chs: AdChannelDef[]): MonthKpi => ({
  revenueMbc: 0, adSpendMbc: 0, adSpendMbi: 0, ordersMbi: 0,
  adSpendMbcByChannel: emptyChannels(chs),
  adSpendMbiByChannel: emptyChannels(chs),
});

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const QUARTERS: { label: MessageKey; months: number[] }[] = [
  { label: "overview.kpiov.q1", months: [1, 2, 3] },
  { label: "overview.kpiov.q2", months: [4, 5, 6] },
  { label: "overview.kpiov.q3", months: [7, 8, 9] },
  { label: "overview.kpiov.q4", months: [10, 11, 12] },
];

// Chỉ các khoá SỐ — keyof MonthKpi giờ kéo theo cả hai bảng kênh, mà bảng kênh
// không phải một "chỉ tiêu" vẽ được thành một dòng.
type Field = "revenueMbc" | "adSpendMbc" | "adSpendMbi" | "ordersMbi";

interface RowDef {
  field: Field;
  label: MessageKey;
  money: boolean;
  higherIsBetter: boolean; // true: doanh thu/đơn (càng cao càng tốt) | false: chi phí (vượt = xấu)
  actual: (m: MonthActual | null) => number | null;
  // true nếu tháng đó nguồn dữ liệu thực tế (Report API) lỗi/timeout — giá trị
  // actual() phía trên đã bị coerce về 0, KHÔNG phải giá trị thật bằng 0.
  sourceError?: (m: MonthActual | null) => boolean;
  /** Phần trong `actual` đến từ số nhập tay, nếu có. */
  manual?: (m: MonthActual | null) => number;
  manualLabels?: (m: MonthActual | null) => string[];
  /** Dòng chi phí chia được theo kênh: trần lấy ở đâu, chi phí thật lấy ở đâu. */
  channelBudget?: (m: MonthKpi | undefined) => ChannelBudget | undefined;
  channelActual?: (m: MonthActual | null) => Partial<Record<DisplayChannel, number>> | undefined;
  /** true khi tháng đó KHÔNG ĐO ĐƯỢC chi phí của kênh này — số 0 bên dưới là
   *  "chưa lấy được", không phải "không tiêu đồng nào". */
  channelUnavailable?: (m: MonthActual | null, ch: DisplayChannel) => boolean;
}

const ROWS: RowDef[] = [
  { field: "revenueMbc", label: "overview.kpiov.row.revenueMbc", money: true, higherIsBetter: true, actual: m => m ? m.mbc.revenue : null, sourceError: m => !!m?.mbc.revenueSourceError },
  // note: phần chi phí do người khai tay (TikTok/Zalo…) — hiện tách bạch để
  // không ai nhầm nó là số hệ thống đo được qua API.
  { field: "adSpendMbc", label: "overview.kpiov.row.adSpendMbc", money: true, higherIsBetter: false, actual: m => m ? m.mbc.totalSpend : null,
    manual: m => m?.mbc.spendManual ?? 0, manualLabels: m => (m?.mbc.manualBreakdown ?? []).map(b => b.label),
    sourceError: m => !!m?.mbc.googleSpendError || !!m?.mbc.facebookSpendError,
    channelBudget: t => t?.adSpendMbcByChannel, channelActual: m => m?.mbc.spendByChannel,
    channelUnavailable: (m, ch) =>
      (ch === "google" && !!m?.mbc.googleSpendError) || (ch === "facebook" && !!m?.mbc.facebookSpendError) },
  { field: "adSpendMbi", label: "overview.kpiov.row.adSpendMbi", money: true, higherIsBetter: false, actual: m => m ? m.mbi.totalSpend : null,
    manual: m => m?.mbi.spendManual ?? 0, manualLabels: m => (m?.mbi.manualBreakdown ?? []).map(b => b.label),
    sourceError: m => !!m?.mbi.googleSpendError || !!m?.mbi.facebookSpendError,
    channelBudget: t => t?.adSpendMbiByChannel, channelActual: m => m?.mbi.spendByChannel,
    channelUnavailable: (m, ch) =>
      (ch === "google" && !!m?.mbi.googleSpendError) || (ch === "facebook" && !!m?.mbi.facebookSpendError) },
  { field: "ordersMbi", label: "overview.kpiov.row.ordersMbi", money: false, higherIsBetter: true, actual: m => m ? m.mbi.orders : null, sourceError: m => !!m?.mbi.ordersSourceError },
];

// ── Formatters ────────────────────────────────────────────────

// Định dạng số theo ngôn ngữ đang chọn (vi-VN: 1.234.567đ).
function makeFmt(loc: string) {
  const fmt = (v: number) => v.toLocaleString(loc);
  const fmtVal = (v: number, money: boolean): string => (money ? `${fmt(v)}đ` : fmt(v));
  return { fmt, fmtVal };
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

// ── % badge — mirror kpiLine() màu trong lib/finance/kpi-report.ts ─

function PctBadge({ actual, target, higherIsBetter }: { actual: number | null; target: number; higherIsBetter: boolean }) {
  const t = useT();
  if (actual === null) return <span className="text-slate-300">—</span>;
  if (!target || target <= 0) return <span className="text-slate-300 text-[10px]">{t("overview.kpiov.noKpi")}</span>;
  const pct = Math.round((actual / target) * 100);
  const tone = higherIsBetter
    ? pct >= 100 ? "text-emerald-600 bg-emerald-50" : pct >= 80 ? "text-amber-600 bg-amber-50" : "text-red-500 bg-red-50"
    : pct > 100 ? "text-red-500 bg-red-50" : pct >= 80 ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";
  return (
    <span className={cn("inline-block rounded px-1 py-0.5 text-[10px] font-bold tabular-nums", tone)}>
      {pct}%
    </span>
  );
}

// ── Monthly Kế hoạch vs Thực tế chart ────────────────────────

function KpiMetricChart({ row, targets, actuals }: { row: RowDef; targets: MonthKpi[]; actuals: (MonthActual | null)[] }) {
  const t = useT();
  const { fmtVal } = makeFmt(useIntlLocale());
  const data = MONTHS.map((m, i) => ({
    label: t("overview.kpiov.monthShort", { m }),
    plan: targets[i]?.[row.field] ?? 0,
    actual: actuals[i] ? row.actual(actuals[i]) ?? 0 : null,
  }));

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-slate-600 mb-2">{t(row.label)}</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
          <YAxis hide />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any) => [v === null ? "—" : fmtVal(Number(v), row.money), ""] as any}
            labelStyle={{ fontSize: 10 }}
            contentStyle={{ fontSize: 10, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="plan" name={t("overview.kpiov.plan")} fill="#94a3b8" radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual" name={t("overview.kpiov.actual")} fill={row.higherIsBetter ? "#3b82f6" : "#f97316"} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────

export function KpiOverviewTab() {
  const t = useT();
  const { fmt, fmtVal } = makeFmt(useIntlLocale());
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const [channels, setChannels] = useState<AdChannelDef[]>(BUILTIN_AD_CHANNELS);
  const [targets, setTargets] = useState<MonthKpi[]>(() => MONTHS.map(() => emptyMonth(BUILTIN_AD_CHANNELS)));
  const [actuals, setActuals] = useState<(MonthActual | null)[]>(() => MONTHS.map(() => null));
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [loadingActuals, setLoadingActuals] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openChannels, setOpenChannels] = useState<Record<string, boolean>>({
    adSpendMbc: true, adSpendMbi: true,
  });

  const load = useCallback(() => {
    setError(null);

    setLoadingTargets(true);
    fetch(`/api/settings/kpi?year=${year}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error ?? t("overview.kpiov.loadTargetsError"));
        const chs: AdChannelDef[] = Array.isArray(json.channels) && json.channels.length > 0 ? json.channels : BUILTIN_AD_CHANNELS;
        setChannels(chs);
        // 12/10: so với trần THỰC TẾ (cố định + khoản chi bổ sung) — server đã cộng sẵn ở effectiveMonths.
        const src = (Array.isArray(json.effectiveMonths) ? json.effectiveMonths : json.months) as Partial<MonthKpi>[];
        setTargets(src.map(m => ({
          ...emptyMonth(chs),
          ...m,
          // Tháng lưu trước khi có phân bổ kênh không có hai trường này.
          adSpendMbcByChannel: { ...emptyChannels(chs), ...(m.adSpendMbcByChannel ?? {}) },
          adSpendMbiByChannel: { ...emptyChannels(chs), ...(m.adSpendMbiByChannel ?? {}) },
        })));
      })
      .catch(err => setError(err instanceof Error ? err.message : t("overview.kpiov.loadTargetsError")))
      .finally(() => setLoadingTargets(false));

    setLoadingActuals(true);
    fetch(`/api/dashboard/kpi-actuals?year=${year}`)
      .then(r => r.json() as Promise<KpiActualsResponse>)
      .then(json => {
        if (!json.success) throw new Error(t("overview.kpiov.loadActualsError"));
        setActuals(json.months);
      })
      .catch(err => setError(err instanceof Error ? err.message : t("overview.kpiov.loadActualsError")))
      .finally(() => setLoadingActuals(false));
  }, [year, t]);

  useEffect(() => { load(); }, [load]);

  const loading = loadingTargets || loadingActuals;

  const quarterTarget = (qMonths: number[]) => qMonths.reduce((s, m) => s + (targets[m - 1]?.revenueMbc ?? 0), 0);
  const quarterActual = (qMonths: number[]) =>
    qMonths.reduce((s, m) => {
      const a = actuals[m - 1];
      return s + (a ? a.mbc.revenue : 0);
    }, 0);

  // Cột "Cả năm". Kế hoạch cộng đủ 12 tháng; thực tế chỉ cộng những tháng ĐÃ CÓ
  // SỐ (tháng chưa tới là null, không phải 0đ). Hai vế khác số tháng nên phần
  // trăm ở cột này là "đã đi được bao nhiêu phần kế hoạch năm", không phải
  // "đạt bao nhiêu phần" — đầu bảng ghi rõ đang cộng mấy tháng.
  const monthsWithData = actuals.filter(Boolean).length;
  const yearTarget = (field: Field) => targets.reduce((s, t) => s + (t?.[field] ?? 0), 0);
  const yearActual = (row: RowDef): number | null =>
    actuals.reduce<number | null>((s, a) => {
      if (!a) return s;
      const v = row.actual(a);
      return v === null ? s : (s ?? 0) + v;
    }, null);
  const yearChannelTarget = (row: RowDef, ch: DisplayChannel) =>
    ch === "other" ? 0 : targets.reduce((s, t) => s + (row.channelBudget?.(t)?.[ch] ?? 0), 0);
  /** Tổng năm của một kênh + số tháng phải bỏ ra vì không đo được. Cộng đại
   *  tháng hụt số vào thành 0 là biến "chưa đo" thành "không tiêu". */
  const yearChannelActual = (row: RowDef, ch: DisplayChannel): { value: number | null; skipped: number } => {
    let value: number | null = null, skipped = 0;
    for (const a of actuals) {
      if (!a) continue;
      if (row.channelUnavailable?.(a, ch)) { skipped++; continue; }
      value = (value ?? 0) + (row.channelActual?.(a)?.[ch] ?? 0);
    }
    return { value, skipped };
  };
  /** Google/Facebook luôn hiện; kênh nhập tay chỉ hiện khi có trần hoặc có tiêu
   *  — bày một dòng Zalo 0đ suốt 12 tháng chỉ làm bảng dài thêm. */
  const displayChannels: DisplayChannel[] = [...channels.map(c => c.key), OTHER_CHANNEL.key];
  const isManualChannel = (key: string) => key === OTHER_CHANNEL.key || channels.find(c => c.key === key)?.source === "manual";
  const channelVisible = (row: RowDef, ch: DisplayChannel) =>
    ch === "google" || ch === "facebook" ||
    yearChannelTarget(row, ch) > 0 || (yearChannelActual(row, ch).value ?? 0) > 0;

  /** Số tháng không lấy được chi phí Meta/Google — hai dòng auto ở cuối bảng
   *  cộng từ chính những tháng đó nên cũng phải nói là đang thiếu, nếu không
   *  chúng sẽ mâu thuẫn ngay với dòng kênh phía trên đã ghi "thiếu N tháng". */
  const monthsMissingSpend = actuals.filter(
    a => a && (a.mbc.googleSpendError || a.mbc.facebookSpendError || a.mbi.googleSpendError || a.mbi.facebookSpendError),
  ).length;

  const yearTotalAdSpendActual = (): number | null =>
    actuals.reduce<number | null>((s, a) => (a ? (s ?? 0) + a.mbc.totalSpend + a.mbi.totalSpend : s), null);
  /** Tỉ lệ cả năm phải tính từ TỔNG chi / TỔNG doanh thu, không phải trung bình
   *  12 tỉ lệ tháng — tháng doanh thu bé sẽ kéo lệch con số trung bình đó. */
  const yearRatioActual = (): number | null => {
    let spend = 0, rev = 0;
    for (const a of actuals) { if (!a) continue; spend += a.mbc.totalSpend; rev += a.mbc.revenue; }
    return rev > 0 ? (spend / rev) * 100 : null;
  };

  const totalAdSpendTarget = (i: number) => (targets[i]?.adSpendMbc ?? 0) + (targets[i]?.adSpendMbi ?? 0);
  const totalAdSpendActual = (i: number) => {
    const a = actuals[i];
    return a ? a.mbc.totalSpend + a.mbi.totalSpend : null;
  };

  // Tỉ lệ Chi QC / Doanh thu — MBC only. Chi QC MBI không tính vào đây vì
  // ngân sách MBI không gắn với doanh thu MBC (2 công ty tách biệt).
  const ratioTarget = (i: number): number | null => {
    const rev = targets[i]?.revenueMbc ?? 0;
    return rev > 0 ? ((targets[i]?.adSpendMbc ?? 0) / rev) * 100 : null;
  };
  const ratioActual = (i: number): number | null => {
    const a = actuals[i];
    if (!a || a.mbc.revenue <= 0) return null;
    return (a.mbc.totalSpend / a.mbc.revenue) * 100;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-slate-800">{t("overview.kpiov.title")}</h2>
          <p className="text-sm text-slate-500">
            {t("overview.kpiov.subtitle")}
          </p>
        </div>
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-amber-400"
        >
          {[now - 1, now, now + 1].map(y => <option key={y} value={y}>{t("overview.kpiov.year", { y })}</option>)}
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 disabled:opacity-50"
          title={t("overview.kpiov.refresh")}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── Phân tích AI: đọc đúng bộ số đang hiện trên bảng bên dưới ── */}
      <KpiAnalysisPanel year={year} targets={targets} actuals={actuals} ready={!loading && !error} />

      {/* ── Bảng Kế hoạch / Thực tế ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="p-6 space-y-2">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}</div>
        ) : (
          <table className="w-full border-collapse text-sm min-w-[1980px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-slate-800 text-white text-left px-3 py-2 text-xs font-semibold">{t("overview.kpiov.colMetric")}</th>
                {QUARTERS.map(q => (
                  <th key={q.months[0]} colSpan={3} className="bg-amber-400 text-slate-900 px-2 py-1.5 text-xs font-bold text-center border-l border-white">{t(q.label)}</th>
                ))}
                <th className="bg-amber-500 text-slate-900 px-2 py-1.5 text-xs font-bold text-center border-l-2 border-white whitespace-nowrap">{t("overview.kpiov.fullYear")}</th>
              </tr>
              <tr>
                <th className="sticky left-0 z-10 bg-slate-700 text-white text-left px-3 py-1.5 text-[11px] font-semibold">{t("overview.kpiov.quarterRevenueRow")}</th>
                {QUARTERS.map(q => (
                  <th key={q.months[0]} colSpan={3} className="bg-blue-50 text-blue-700 px-2 py-1.5 text-[11px] font-bold text-center tabular-nums border-l border-white">
                    <div>{fmt(quarterTarget(q.months))}đ</div>
                    <div className="text-emerald-600 font-semibold">{fmt(quarterActual(q.months))}đ</div>
                  </th>
                ))}
                <th className="bg-blue-100 text-blue-800 px-2 py-1.5 text-[11px] font-bold text-center tabular-nums border-l-2 border-white whitespace-nowrap">
                  <div>{fmt(yearTarget("revenueMbc"))}đ</div>
                  <div className="text-emerald-700 font-semibold">{fmt(quarterActual(MONTHS))}đ</div>
                </th>
              </tr>
              <tr>
                <th className="sticky left-0 z-10 bg-slate-100 text-slate-500 text-left px-3 py-1.5 text-[11px]">{t("overview.kpiov.colMonth")}</th>
                {MONTHS.map(m => (
                  <th key={m} className={cn("px-2 py-1.5 text-[11px] font-semibold text-slate-500 text-center", m % 3 === 1 && "border-l border-slate-200")}>{t("overview.kpiov.monthShort", { m })}</th>
                ))}
                <th
                  className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 text-center border-l-2 border-slate-300 whitespace-nowrap"
                  title={t("overview.kpiov.yearColHint")}
                >
                  {t("overview.kpiov.yearColLabel", { n: monthsWithData })}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(row => (
                <Fragment key={row.field}>
                  <tr className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap">
                      {row.channelBudget ? (
                        <button
                          type="button"
                          onClick={() => setOpenChannels(o => ({ ...o, [row.field]: !o[row.field] }))}
                          className="inline-flex items-center gap-1 hover:text-amber-600"
                          title={openChannels[row.field] ? t("overview.kpiov.collapseChannels") : t("overview.kpiov.expandChannels")}
                        >
                          {openChannels[row.field] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {t(row.label)}
                        </button>
                      ) : t(row.label)}{" "}
                      <span className="text-slate-400 font-normal">{t("overview.kpiov.dashPlan")}</span>
                    </td>
                    {MONTHS.map((m, i) => (
                      <td key={m} className={cn("px-2 py-1.5 text-right text-xs text-slate-600 tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                        {fmtVal(targets[i]?.[row.field] ?? 0, row.money)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-700 tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-slate-50/70">
                      {fmtVal(yearTarget(row.field), row.money)}
                    </td>
                  </tr>
                  <tr className="bg-slate-50/60">
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap">
                      <span className="pl-2">{t("overview.kpiov.arrowActual")}</span>
                    </td>
                    {MONTHS.map((m, i) => {
                      const a = actuals[i];
                      const val = row.actual(a);
                      const hasSourceError = row.sourceError?.(a) ?? false;
                      const manualPart = row.manual?.(a) ?? 0;
                      const manualLabels = manualPart > 0 ? (row.manualLabels?.(a) ?? []) : [];
                      return (
                        <td key={m} className={cn("px-2 py-1.5 text-right tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                          <div className="text-xs font-semibold text-slate-800 flex items-center justify-end gap-1">
                            {hasSourceError && (
                              <AlertTriangle
                                className="h-3 w-3 text-amber-500 shrink-0"
                                aria-label={t("overview.kpiov.sourceErrorLabel")}
                              />
                            )}
                            {val === null ? <span className="text-slate-300">—</span> : fmtVal(val, row.money)}
                          </div>
                          {hasSourceError ? (
                            <span className="text-[10px] text-amber-600 font-semibold">{t("overview.kpiov.dataError")}</span>
                          ) : (
                            <PctBadge actual={val} target={targets[i]?.[row.field] ?? 0} higherIsBetter={row.higherIsBetter} />
                          )}
                          {/* Trong tổng này có bao nhiêu là người khai tay — phải
                              nói ra, không trộn im lặng vào số API đo được. */}
                          {manualPart > 0 && (
                            <div
                              className="text-[10px] text-blue-600"
                              title={`${t("overview.kpiov.includesManual", { amount: fmtVal(manualPart, true) })}${manualLabels.length ? ` (${manualLabels.join(", ")})` : ""}`}
                            >
                              ✍️ {fmtVal(manualPart, true)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {(() => {
                      const val = yearActual(row);
                      // Tháng nào nguồn số lỗi thì giá trị tháng đó đã bị coerce
                      // về 0 — tổng năm vì thế đang THIẾU. Vẫn hiện tổng (đó là
                      // tất cả những gì đo được) nhưng bỏ phần trăm đi: chấm %
                      // trên một cái tổng thiếu là dạy người đọc tin một con số sai.
                      const missing = actuals.filter(a => a && row.sourceError?.(a)).length;
                      return (
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-slate-100/70">
                          <div className="text-xs font-bold text-slate-800">
                            {val === null ? <span className="text-slate-300 font-normal">—</span> : fmtVal(val, row.money)}
                          </div>
                          {missing > 0 ? (
                            <span
                              className="text-[10px] font-semibold text-amber-600"
                              title={t("overview.kpiov.yearMissingHint")}
                            >
                              {t("overview.kpiov.missingMonths", { n: missing })}
                            </span>
                          ) : (
                            <PctBadge actual={val} target={yearTarget(row.field)} higherIsBetter={row.higherIsBetter} />
                          )}
                        </td>
                      );
                    })()}
                  </tr>

                  {/* Tách theo kênh — chỉ dòng chi phí mới có */}
                  {row.channelBudget && openChannels[row.field] &&
                    displayChannels.filter(ch => channelVisible(row, ch)).map(ch => {
                      const yTarget = yearChannelTarget(row, ch);
                      const { value: yActual, skipped: ySkipped } = yearChannelActual(row, ch);
                      return (
                        <tr key={`${row.field}-${ch}`} className="bg-white border-b border-slate-50 last:border-0">
                          <td className="sticky left-0 z-10 bg-white px-3 py-1 text-[11px] text-slate-500 whitespace-nowrap">
                            <span className="pl-3 text-slate-300 mr-1">└</span>
                            {channelLabel(channels, ch)}
                            {isManualChannel(ch) && (
                              <span
                                className="ml-1 text-[9px] text-amber-600"
                                title={t("overview.kpiov.channel.manualHint")}
                              >
                                {t("overview.kpiov.channel.manual")}
                              </span>
                            )}
                          </td>
                          {MONTHS.map((m, i) => {
                            const a = actuals[i];
                            const target = ch === "other" ? 0 : (row.channelBudget?.(targets[i])?.[ch] ?? 0);
                            const unavailable = a ? (row.channelUnavailable?.(a, ch) ?? false) : false;
                            const val = a && !unavailable ? (row.channelActual?.(a)?.[ch] ?? 0) : null;
                            const over = target > 0 && val !== null && val > target;
                            return (
                              <td key={m} className={cn("px-2 py-1 text-right tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                                <div className={cn("text-[11px] font-semibold", over ? "text-red-600" : "text-slate-700")}>
                                  {val === null ? (
                                    <span
                                      className={cn("font-normal", unavailable ? "text-amber-500" : "text-slate-300")}
                                      title={unavailable ? t("overview.kpiov.channel.unavailableHint") : undefined}
                                    >
                                      {unavailable ? "⚠ —" : "—"}
                                    </span>
                                  ) : fmtVal(val, true)}
                                </div>
                                {target > 0 && (
                                  <div className="text-[9px] text-slate-400" title={t("overview.kpiov.channel.monthCapHint", { m })}>
                                    {t("overview.kpiov.channel.cap", { amount: fmtVal(target, true) })}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-slate-50/70">
                            <div className={cn(
                              "text-[11px] font-bold",
                              yTarget > 0 && (yActual ?? 0) > yTarget ? "text-red-600" : "text-slate-700",
                            )}>
                              {yActual === null ? <span className="text-slate-300 font-normal">—</span> : fmtVal(yActual, true)}
                            </div>
                            {ySkipped > 0 && (
                              <div className="text-[9px] text-amber-600" title={t("overview.kpiov.channel.skippedHint")}>
                                {t("overview.kpiov.missingMonths", { n: ySkipped })}
                              </div>
                            )}
                            {yTarget > 0 && (
                              <div className="text-[9px] text-slate-400">{t("overview.kpiov.channel.cap", { amount: fmtVal(yTarget, true) })}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              ))}

              {/* Tổng Chi QC (auto) */}
              <tr className="border-t border-slate-200 bg-violet-50/40">
                <td className="sticky left-0 z-10 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 whitespace-nowrap">
                  {t("overview.kpiov.totalAdSpend")} <span className="font-normal text-violet-400">{t("overview.kpiov.dashPlan")}</span>
                </td>
                {MONTHS.map((m, i) => (
                  <td key={m} className={cn("px-2 py-2 text-right text-xs font-bold text-violet-700 tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                    {fmtVal(totalAdSpendTarget(i), true)}
                  </td>
                ))}
                <td className="px-2 py-2 text-right text-xs font-bold text-violet-700 tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-violet-100/60">
                  {fmtVal(yearTarget("adSpendMbc") + yearTarget("adSpendMbi"), true)}
                </td>
              </tr>
              <tr className="bg-violet-50/70">
                <td className="sticky left-0 z-10 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 whitespace-nowrap">
                  <span className="pl-2">{t("overview.kpiov.arrowActual")}</span>
                </td>
                {MONTHS.map((m, i) => {
                  const val = totalAdSpendActual(i);
                  return (
                    <td key={m} className={cn("px-2 py-2 text-right text-xs font-bold text-violet-800 tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                      {val === null ? <span className="text-slate-300 font-normal">—</span> : fmtVal(val, true)}
                    </td>
                  );
                })}
                {(() => {
                  const val = yearTotalAdSpendActual();
                  return (
                    <td className="px-2 py-2 text-right text-xs font-bold text-violet-800 tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-violet-100/80">
                      {val === null ? <span className="text-slate-300 font-normal">—</span> : fmtVal(val, true)}
                      {monthsMissingSpend > 0 && (
                        <div className="text-[9px] font-semibold text-amber-600" title={t("overview.kpiov.totalMissingHint")}>
                          {t("overview.kpiov.missingMonths", { n: monthsMissingSpend })}
                        </div>
                      )}
                    </td>
                  );
                })()}
              </tr>

              {/* Tỉ lệ Chi QC / Doanh thu (MBC, auto) */}
              <tr className="border-t border-slate-200 bg-teal-50/40">
                <td className="sticky left-0 z-10 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700 whitespace-nowrap">
                  {t("overview.kpiov.adRatio")} <span className="font-normal text-teal-400">{t("overview.kpiov.dashPlan")}</span>
                </td>
                {MONTHS.map((m, i) => (
                  <td key={m} className={cn("px-2 py-2 text-right text-xs font-bold text-teal-700 tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                    {fmtPct(ratioTarget(i))}
                  </td>
                ))}
                <td className="px-2 py-2 text-right text-xs font-bold text-teal-700 tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-teal-100/60">
                  {fmtPct(yearTarget("revenueMbc") > 0 ? (yearTarget("adSpendMbc") / yearTarget("revenueMbc")) * 100 : null)}
                </td>
              </tr>
              <tr className="bg-teal-50/70">
                <td className="sticky left-0 z-10 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700 whitespace-nowrap">
                  <span className="pl-2">{t("overview.kpiov.arrowActual")}</span>
                </td>
                {MONTHS.map((m, i) => {
                  const val = ratioActual(i);
                  return (
                    <td key={m} className={cn("px-2 py-2 text-right text-xs font-bold text-teal-800 tabular-nums whitespace-nowrap", m % 3 === 1 && "border-l border-slate-200")}>
                      {val === null ? <span className="text-slate-300 font-normal">—</span> : fmtPct(val)}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right text-xs font-bold text-teal-800 tabular-nums whitespace-nowrap border-l-2 border-slate-300 bg-teal-100/80">
                  {fmtPct(yearRatioActual())}
                  {monthsMissingSpend > 0 && (
                    <div className="text-[9px] font-semibold text-amber-600" title={t("overview.kpiov.ratioMissingHint")}>
                      {t("overview.kpiov.missingMonths", { n: monthsMissingSpend })}
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Biểu đồ theo từng chỉ tiêu ── */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ROWS.map(row => (
            <KpiMetricChart key={row.field} row={row} targets={targets} actuals={actuals} />
          ))}
        </div>
      )}
    </div>
  );
}
