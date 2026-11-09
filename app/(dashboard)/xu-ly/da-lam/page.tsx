"use client";

// ============================================================
// Đã làm & kết quả (Đợt 15b)
// ------------------------------------------------------------
// Mọi lần tool ghi lên Google/Meta + kết quả đo lại sau 7 và 14 ngày.
// Dữ liệu từ GET /api/writes?days=N; lọc/tìm kiếm chạy client-side.
// ============================================================

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { AlertTriangle, ChevronDown, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Kpi } from "@/components/measure/Kpi";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { vnd, ddmmyyyy } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { companyLabel } from "@/lib/companies/registry";
import type { WriteEvent } from "@/lib/writes/feed";
import type { Verdict } from "@/lib/writes/verdict";
import { prettyWriteLabel } from "@/lib/writes/labels";
import type { WindowResult } from "@/lib/writes/outcome";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TFunction } from "@/lib/i18n/translate";

type WindowState = "done" | "case" | "skip" | "pending_job" | "not_due";
type WindowRow = {
  days: 7 | 14;
  state: WindowState;
  dueOn: string;
  result?: WindowResult | Record<string, number | null> | null;
  note?: string | null;
};
type WriteRow = WriteEvent & { windows: WindowRow[] };
type WritesResponse = { success: true; days: number; rows: WriteRow[]; errors: string[] };

type VerdictFilter = "ALL" | "xau" | "tot" | "chua_ro" | "chua_do";
type PlatformFilter = "ALL" | "google" | "meta";

const VERDICT_TONE: Record<Verdict, PillTone> = { tot: "green", xau: "red", khong_doi: "grey", chua_ro: "amber" };
const RANGES = [7, 30, 90, 180] as const;
const VERDICT_FILTER_LABEL: Record<VerdictFilter, MessageKey> = { ALL: "overview.xuly.done.filterAll", xau: "overview.xuly.done.filterBad", tot: "overview.xuly.done.filterGood", chua_ro: "overview.xuly.done.filterUnclear", chua_do: "overview.xuly.done.filterUnmeasured" };
const PLATFORM_LABEL: Record<PlatformFilter, MessageKey> = { ALL: "overview.xuly.done.filterAll", google: "overview.xuly.done.platGoogle", meta: "overview.xuly.done.platMeta" };
const VERDICT_LABEL_KEY: Record<Verdict, MessageKey> = { tot: "overview.xuly.done.verdictGood", xau: "overview.xuly.done.verdictBad", khong_doi: "overview.xuly.done.verdictSame", chua_ro: "overview.xuly.done.verdictUnclear" };

function isWindowResult(r: WindowRow["result"]): r is WindowResult {
  return !!r && typeof (r as WindowResult).verdict === "string";
}

/** Phán quyết quy về một khoá chung (kể cả kết quả từ phiên xử lý); null = chưa đo. */
function verdictOf(w: WindowRow | undefined): Verdict | null {
  if (!w) return null;
  if (w.state === "done" && isWindowResult(w.result)) return w.result.verdict;
  if (w.state === "case" && w.result && !isWindowResult(w.result)) {
    const v = w.result.verdict;
    if (v === 1) return "tot";
    if (v === 0) return "chua_ro";
    if (v === -1) return "xau";
  }
  return null;
}

const vnDateTime = (iso: string, loc: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat(loc, {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (ty: string) => p.find((x) => x.type === ty)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
};
const vnDayMonth = (iso: string, loc: string): string => vnDateTime(iso, loc).slice(0, 5);

export default function DaLamPage() {
  const t = useT();
  const loc = useIntlLocale();
  const [days, setDays] = useState<number>(30);
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("ALL");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("ALL");
  const [search, setSearch] = useState("");
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoMsg, setUndoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { data, error, isLoading, mutate } = useSWR<WritesResponse>(`/api/writes?days=${days}`, getJson);

  const rows = useMemo(() => [...(data?.rows ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (platformFilter !== "ALL" && r.platform !== platformFilter) return false;
      if (q && !prettyWriteLabel(r.label).toLowerCase().includes(q)) return false;
      if (verdictFilter !== "ALL") {
        const v = verdictOf(r.windows.find((w) => w.days === 14));
        if (verdictFilter === "chua_do" ? v !== null : v !== verdictFilter) return false;
      }
      return true;
    });
  }, [rows, platformFilter, search, verdictFilter]);

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { tot: 0, xau: 0, khong_doi: 0, chua_ro: 0 };
    let waiting = 0;
    for (const r of rows) {
      const v = verdictOf(r.windows.find((w) => w.days === 14));
      if (v) c[v] += 1;
      else waiting += 1;
    }
    return { ...c, waiting };
  }, [rows]);

  const errors = data?.errors ?? [];

  // Đợt 23 (3c): hoàn tác bật/tắt / đổi ngân sách — máy chủ tự kiểm giá trị hiện tại, đã bị sửa tiếp thì từ chối.
  const undo = async (r: WriteRow) => {
    if (!window.confirm(t("overview.xuly.done.undoConfirm", { label: prettyWriteLabel(r.label), platform: r.platform === "meta" ? "Meta" : "Google" }))) return;
    setUndoing(r.id);
    setUndoMsg(null);
    try {
      await postJson("/api/writes/undo", { id: r.id });
      setUndoMsg({ ok: true, text: t("overview.xuly.done.undoOk") });
      await mutate();
    } catch (e) {
      setUndoMsg({ ok: false, text: e instanceof Error ? e.message : t("overview.xuly.done.undoFailed") });
    } finally {
      setUndoing(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <History className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("overview.xuly.done.title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            {t("overview.xuly.done.subtitle")}
          </p>
        </div>
        <Button className="h-10" variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
          <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" /> {t("overview.xuly.done.reload")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px]">
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.done.range")}</div>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger aria-label={t("overview.xuly.done.range")}><SelectValue>{(v: string) => t("overview.xuly.done.lastDays", { n: v })}</SelectValue></SelectTrigger>
            <SelectContent>
              {RANGES.map((d) => <SelectItem key={d} value={String(d)}>{t("overview.xuly.done.lastDays", { n: d })}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px]">
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.done.result14")}</div>
          <Select value={verdictFilter} onValueChange={(v) => setVerdictFilter(v as VerdictFilter)}>
            <SelectTrigger aria-label={t("overview.xuly.done.filterResult14")}><SelectValue>{(v: string) => (VERDICT_FILTER_LABEL[v as VerdictFilter] ? t(VERDICT_FILTER_LABEL[v as VerdictFilter]) : v)}</SelectValue></SelectTrigger>
            <SelectContent>
              {(Object.keys(VERDICT_FILTER_LABEL) as VerdictFilter[]).map((k) => <SelectItem key={k} value={k}>{t(VERDICT_FILTER_LABEL[k])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[150px]">
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.done.platform")}</div>
          <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v as PlatformFilter)}>
            <SelectTrigger aria-label={t("overview.xuly.done.platform")}><SelectValue>{(v: string) => (PLATFORM_LABEL[v as PlatformFilter] ? t(PLATFORM_LABEL[v as PlatformFilter]) : v)}</SelectValue></SelectTrigger>
            <SelectContent>
              {(Object.keys(PLATFORM_LABEL) as PlatformFilter[]).map((k) => <SelectItem key={k} value={k}>{t(PLATFORM_LABEL[k])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.done.search")}</div>
          <Input
            className="h-10"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("overview.xuly.done.searchPlaceholder")}
            aria-label={t("overview.xuly.done.search")}
          />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        </div>
      )}

      {!isLoading && error && (
        <EmptyState
          icon={AlertTriangle}
          title={error instanceof ApiError ? error.message : t("overview.xuly.done.loadFailed")}
          action={<Button className="h-10" onClick={() => mutate()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("overview.xuly.done.retry")}</Button>}
        />
      )}

      {!isLoading && !error && data && (
        <>
          {undoMsg && (
            <div role="status" className={`rounded-xl border p-3 text-sm ${undoMsg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
              {undoMsg.text}
            </div>
          )}
          {errors.length > 0 && (
            <details className="group rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {t("overview.xuly.done.sourceErrors", { n: errors.length })}
                <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title={t("overview.xuly.done.emptyTitle", { days: data.days })}
              description={t("overview.xuly.done.emptyDesc")}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Kpi label={t("overview.xuly.done.kpiGood")} value={String(counts.tot)} />
                <Kpi label={t("overview.xuly.done.kpiBad")} value={String(counts.xau)} bad={counts.xau > 0} />
                <Kpi label={t("overview.xuly.done.kpiSame")} value={String(counts.khong_doi)} />
                <Kpi label={t("overview.xuly.done.kpiUnclear")} value={String(counts.chua_ro)} />
                <Kpi label={t("overview.xuly.done.kpiWaiting")} value={String(counts.waiting)} />
              </div>

              {filtered.length === 0 ? (
                <EmptyState compact title={t("overview.xuly.done.noMatchTitle")} description={t("overview.xuly.done.noMatchDesc")} />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t("overview.xuly.done.thDate")}</th>
                        <th className="px-3 py-2.5 font-medium">{t("overview.xuly.done.thCompany")}</th>
                        <th className="px-3 py-2.5 font-medium">{t("overview.xuly.done.platform")}</th>
                        <th className="px-3 py-2.5 font-medium">{t("overview.xuly.done.thAction")}</th>
                        <th className="px-3 py-2.5 font-medium">{t("overview.xuly.done.th7")}</th>
                        <th className="px-3 py-2.5 font-medium">{t("overview.xuly.done.th14")}</th>
                        <th className="px-3 py-2.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const w7 = r.windows.find((w) => w.days === 7);
                        const w14 = r.windows.find((w) => w.days === 14);
                        const bad = verdictOf(w14) === "xau";
                        return (
                          <tr key={r.id} className={`border-b border-slate-50 last:border-0 align-top ${bad ? "border-l-4 border-l-red-500 bg-red-50/30" : ""}`}>
                            <td className="px-4 py-2.5 tabular-nums whitespace-nowrap text-slate-600">{vnDateTime(r.at, loc)}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{r.company === "MBC" || r.company === "MBI" ? r.company : companyLabel(r.company)}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{r.platform === "meta" ? "Meta" : "Google"}</td>
                            <td className="max-w-md px-3 py-2.5">
                              <div className="font-semibold text-slate-800">{prettyWriteLabel(r.label)}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                                <span>{r.sourceLabel}</span>
                                {r.undoneAt && <Pill tone="grey">{t("overview.xuly.done.undone", { date: vnDayMonth(r.undoneAt, loc) })}</Pill>}
                              </div>
                            </td>
                            <td className="px-3 py-2.5"><WindowCell w={w7} link={r.link} t={t} loc={loc} /></td>
                            <td className="px-3 py-2.5"><WindowCell w={w14} link={r.link} t={t} loc={loc} /></td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1.5">
                                {r.undoable && !r.undoneAt && (
                                  <Button size="sm" variant="outline" disabled={undoing !== null} onClick={() => undo(r)}>
                                    {undoing === r.id ? t("overview.xuly.done.undoing") : t("overview.xuly.done.undo")}
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" render={<Link href={r.link} />}>{t("overview.xuly.done.open")}</Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function WindowCell({ w, link, t, loc }: { w: WindowRow | undefined; link: string; t: TFunction; loc: string }) {
  const intl = useIntlLocale();
  if (!w) return <span className="text-slate-300">—</span>;

  if (w.state === "done" && isWindowResult(w.result)) {
    const r = w.result;
    return (
      <div className="space-y-1" title={w.note ?? r.note}>
        <Pill tone={VERDICT_TONE[r.verdict]}>{t(VERDICT_LABEL_KEY[r.verdict])}</Pill>
        <div className="tabular-nums text-xs text-slate-700">
          {r.cpaBefore !== null ? vnd(r.cpaBefore, intl) : t("overview.xuly.done.zeroOrders")} → {r.cpaAfter !== null ? vnd(r.cpaAfter, intl) : t("overview.xuly.done.zeroOrders")}
        </div>
        {(w.note ?? r.note) && <div className="max-w-[240px] text-xs text-slate-400">{w.note ?? r.note}</div>}
      </div>
    );
  }

  if (w.state === "case") {
    const res = w.result && !isWindowResult(w.result) ? w.result : null;
    const v = res?.verdict;
    return (
      <div className="space-y-1 text-xs">
        <div className="text-slate-600">{t("overview.xuly.done.byCase")}</div>
        {v === 1 && <span className="font-semibold text-emerald-600">{t("overview.xuly.done.caseGood")}</span>}
        {v === 0 && <span className="font-semibold text-amber-600">{t("overview.xuly.done.caseUnclear")}</span>}
        {v === -1 && <span className="font-semibold text-red-600">{t("overview.xuly.done.caseWorse")}</span>}
        {typeof res?.cpa === "number" && <div className="tabular-nums text-slate-700">CPA {vnd(res.cpa, intl)}</div>}
        {typeof res?.roas === "number" && <div className="tabular-nums text-slate-700">ROAS {res.roas.toLocaleString(loc, { maximumFractionDigits: 2 })}</div>}
        <div><Link href={link} className="text-blue-600 hover:underline">{t("overview.xuly.done.viewCase")}</Link></div>
      </div>
    );
  }

  if (w.state === "not_due") return <span className="text-xs text-slate-500">{t("overview.xuly.done.measureOn", { date: ddmmyyyy(w.dueOn, intl) })}</span>;
  if (w.state === "pending_job") return <span className="text-xs text-slate-500">{t("overview.xuly.done.pendingJob")}</span>;
  if (w.state === "skip") {
    return (
      <span className="text-xs text-slate-400" title={w.note ?? undefined}>
        {t("overview.xuly.done.skipped")}{w.note ? <span className="block max-w-[220px] text-slate-400">{w.note}</span> : null}
      </span>
    );
  }
  return <span className="text-slate-300">—</span>;
}
