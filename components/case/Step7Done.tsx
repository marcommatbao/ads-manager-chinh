// ============================================================
// Bước 7 — Hoàn thành. Đóng phiên + tự đo lại sau 7/14 ngày. Số "sau" chỉ
// hiện khi đã tới ngày đo — không ước đoán trước.
// ============================================================
"use client";

import { useState } from "react";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vnd, num, ddmmyyyy } from "./format";
import { postJson, ApiError } from "./api";
import type { CampaignCase } from "@/lib/case/store";
import { NextStepsPanel } from "./NextStepsPanel";
import { evidenceGoalKind } from "@/lib/case/goal-kind";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

const cpa = (n: number | null | undefined, loc?: string) => (n === null || n === undefined ? "—" : vnd(n, loc));
const numL = (n: number | null | undefined, loc?: string) => num(n, undefined, loc);
const freq = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(2));

/** "2026-10-04" → "04/10" (không kèm năm — khớp mockup d6-so-nhom). */
function ddmm(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

const MOC_LABELS: MessageKey[] = ["overview.step7.moc.7", "overview.step7.moc.14"];

/** Đợt 6 · B2 — phiên Facebook có tạo nhóm mới (adset_created): mỗi mốc đo lại
 *  ĐÃ đo sẽ có thêm newCost/oldCost… trong `result` (xem lib/case/service.ts
 *  newAdsetComparison). Phát hiện qua chính `result` — không tự suy đoán field khác. */
const hasAdsetKeys = (result?: Record<string, number | null>): boolean => !!result && "newCost" in result;

interface RemeasureColumn { key: string; label: MessageKey; fmt: (n: number | null | undefined, loc: string) => string }

const GOOGLE_REMEASURE_COLUMNS: RemeasureColumn[] = [
  { key: "cost", label: "overview.step7.col.cost", fmt: vnd },
  { key: "orders", label: "overview.step7.col.orders", fmt: numL },
  { key: "cpa", label: "overview.step7.col.cpo", fmt: cpa },
  { key: "competitorSpend", label: "overview.step7.col.competitor", fmt: vnd },
];

const META_REMEASURE_COLUMNS: RemeasureColumn[] = [
  { key: "cost", label: "overview.step7.col.cost", fmt: vnd },
  { key: "orders", label: "overview.step7.col.purchases", fmt: numL },
  { key: "cpa", label: "overview.step7.col.cpp", fmt: cpa },
  { key: "orderValue", label: "overview.step7.col.metaRevenue", fmt: vnd },
  { key: "frequency", label: "overview.step7.col.frequency", fmt: freq },
];
// Đợt 23 (3d): phiên thu lead — "orders"/"cpa" của kết quả đo lại là lead / chi phí mỗi lead.
const META_LEAD_REMEASURE_COLUMNS: RemeasureColumn[] = [
  { key: "cost", label: "overview.step7.col.cost", fmt: vnd },
  { key: "orders", label: "overview.step7.col.leads", fmt: numL },
  { key: "cpa", label: "overview.step7.col.cpl", fmt: cpa },
  { key: "frequency", label: "overview.step7.col.frequency", fmt: freq },
];
const GOOGLE_LEAD_REMEASURE_COLUMNS: RemeasureColumn[] = [
  { key: "cost", label: "overview.step7.col.cost", fmt: vnd },
  { key: "orders", label: "overview.step7.col.leads", fmt: numL },
  { key: "cpa", label: "overview.step7.col.cpl", fmt: cpa },
  { key: "competitorSpend", label: "overview.step7.col.competitor", fmt: vnd },
];

export function Step7Done({
  c,
  onRefresh,
  onBack,
}: {
  c: CampaignCase;
  onRefresh: (next: CampaignCase) => void;
  onBack: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const [closing, setClosing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = c.actions.filter((a) => a.selected);
  const hasDone = c.executions.some((e) => e.status === "done");
  const doneCount = hasDone ? selected.length : 0;
  const openTasks = c.manualTasks.filter((mt) => mt.status === "open").length;
  const doneTasks = c.manualTasks.length - openTasks;
  const leads = evidenceGoalKind(c.evidence) === "leads";
  const remeasureColumns = c.platform === "facebook"
    ? (leads ? META_LEAD_REMEASURE_COLUMNS : META_REMEASURE_COLUMNS)
    : (leads ? GOOGLE_LEAD_REMEASURE_COLUMNS : GOOGLE_REMEASURE_COLUMNS);

  async function closeCase() {
    setClosing(true);
    setErr(null);
    try {
      const json = await postJson(`/api/cases/${c.id}/close`);
      onRefresh(json.case);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("overview.step7.err.close"));
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t("overview.step7.kpi.toolDone")} value={`${doneCount}/${selected.length}`} />
        <Kpi label={t("overview.step7.kpi.assigned")} value={t("overview.step7.kpi.openTasks", { n: openTasks })} sub={c.manualTasks.length > 0 ? t("overview.step7.kpi.tasksDone", { done: doneTasks, total: c.manualTasks.length }) : undefined} />
        {c.remeasure.map((r, i) => (
          <Kpi key={i} label={t("overview.step7.kpi.remeasureN", { n: i + 1 })} value={ddmmyyyy(r.due, intl)} sub={r.status === "done" ? t("overview.step7.measured") : t("overview.step7.pending")} />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step7.effect")}</div>
        {c.remeasure.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-400">{t("overview.step7.noSchedule")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("overview.step7.th.remeasure")}</th>
                <th className="px-3 py-2 font-medium">{t("overview.step7.th.status")}</th>
                {remeasureColumns.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-right font-medium">{t(col.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.remeasure.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 text-slate-800">{ddmmyyyy(r.due, intl)}</td>
                  <td className="px-3 py-2.5">
                    {r.status === "done" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("overview.step7.measured")}</span>
                    ) : (
                      <span className="text-slate-400">{t("overview.step7.waiting", { date: ddmmyyyy(r.due, intl) })}</span>
                    )}
                  </td>
                  {r.status === "done" && r.result ? (
                    <>
                      {remeasureColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2.5 text-right tabular-nums">{col.fmt(r.result![col.key], intl)}</td>
                      ))}
                    </>
                  ) : (
                    <td className="px-3 py-2.5 text-slate-400" colSpan={remeasureColumns.length}>{t("overview.step7.waiting", { date: ddmmyyyy(r.due, intl) })}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("overview.step7.note")}
        </div>
      </div>

      <NextStepsPanel c={c} onRefresh={onRefresh} />

      {c.platform === "facebook" && c.remeasure.some((r) => r.status === "done" && hasAdsetKeys(r.result)) && (
        <div className="space-y-4">
          {c.remeasure.slice(0, 2).map((r, i) => (
            <AdsetComparisonCard key={i} label={t(MOC_LABELS[i])} r={r} />
          ))}
        </div>
      )}

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="flex justify-between">
        <Button className="h-10" variant="outline" onClick={onBack}>{t("overview.step7.back")}</Button>
        <div className="flex gap-2">
          {c.status !== "done" && (
            <Button className="h-10" onClick={closeCase} disabled={closing}>
              {closing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("overview.step7.closeCase")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/** Đợt 6 · B2 — bảng "Nhóm mới vs Nhóm cũ" cho một mốc đo lại (7 hoặc 14 ngày). */
function AdsetComparisonCard({ label, r }: { label: string; r: CampaignCase["remeasure"][number] }) {
  const intl = useIntlLocale();
  const t = useT();
  const result = r.status === "done" ? r.result : undefined;
  const done = hasAdsetKeys(result);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{t("overview.step7.cmp.title", { label })}</div>
      {!done ? (
        <p className="px-4 py-4 text-sm text-slate-400">{t("overview.step7.cmp.notYet", { date: ddmm(r.due) })}</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("overview.step7.cmp.adset")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.step7.col.cost")}</th>
                <th className="px-3 py-2 font-medium">{t("overview.step7.cmp.results")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.step7.cmp.cpr")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overview.step7.col.purchases")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-50">
                <td className="px-4 py-2.5 font-semibold text-slate-800">{t("overview.step7.cmp.new")}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cpa(result!.newCost, intl)}</td>
                <td className="px-3 py-2.5 tabular-nums">{num(result!.newResults, undefined, intl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cpa(result!.newCostPerResult, intl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(result!.newPurchases, undefined, intl)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-slate-800">{t("overview.step7.cmp.old")}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cpa(result!.oldCost, intl)}</td>
                <td className="px-3 py-2.5 tabular-nums">{num(result!.oldResults, undefined, intl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cpa(result!.oldCostPerResult, intl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(result!.oldPurchases, undefined, intl)}</td>
              </tr>
            </tbody>
          </table>
          <AdsetVerdictLine result={result!} label={label} />
        </>
      )}
    </div>
  );
}

function AdsetVerdictLine({ result, label }: { result: Record<string, number | null>; label: string }) {
  const intl = useIntlLocale();
  const t = useT();
  const n = result.newCostPerResult, o = result.oldCostPerResult;
  if (n === null || n === undefined || o === null || o === undefined || !o) return null;
  const pctChange = Math.round(((n - o) / o) * 100);
  const cheaper = pctChange <= 0;
  return (
    <div className={`border-t border-slate-100 px-4 py-2.5 text-sm ${cheaper ? "text-emerald-700" : "text-red-700"}`}>
      <b>{cheaper ? t("overview.step7.verdict.cheaper", { pct: Math.abs(pctChange) }) : t("overview.step7.verdict.pricier", { pct: pctChange })}</b> — {t("overview.step7.verdict.tail", { old: vnd(o, intl), new: vnd(n, intl), label })}
    </div>
  );
}
