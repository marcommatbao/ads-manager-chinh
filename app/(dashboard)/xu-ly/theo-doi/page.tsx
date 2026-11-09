"use client";

// ============================================================
// Theo dõi phiên xử lý (Đợt 4 · C)
// ------------------------------------------------------------
// Mọi phiên của 2 công ty × 2 nền tảng trên MỘT bảng: đang ở bước nào, đo lại
// 7/14 ngày ra sao, việc giao người còn mở bao lâu. Lọc client-side trên dữ
// liệu /api/cases/board — server đã lọc theo công ty người dùng được xem.
// ============================================================

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { AlertTriangle, ListChecks, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Kpi } from "@/components/measure/Kpi";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { vnd, ddmmyyyy } from "@/components/case/format";
import { getJson, ApiError } from "@/components/case/api";
import { STEP_LABELS } from "@/components/case/StepStepper";
import { ImportCasesDialog } from "@/components/case/ImportCasesDialog";
import { useSession } from "@/components/SessionProvider";
import { isSuperAdmin } from "@/lib/permissions";
import type { BoardRow, BoardState } from "@/lib/case/board";
import type { Company } from "@/lib/case/types";
import type { CaseStep } from "@/lib/case/store";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type BoardResponse = { success: true; companies: Company[]; rows: BoardRow[]; reminders: { enabled: boolean; overdueDays: number } };

const STATE_PILL: Record<BoardState, { tone: PillTone; text: MessageKey }> = {
  working: { tone: "blue", text: "overview.xuly.follow.pillWorking" },
  waiting: { tone: "amber", text: "overview.xuly.follow.pillWaiting" },
  reopened: { tone: "red", text: "overview.xuly.follow.pillReopened" },
  done: { tone: "green", text: "overview.xuly.follow.pillDone" },
};
const STATE_LABEL: Record<BoardState, MessageKey> = { working: "overview.xuly.follow.stateWorking", waiting: "overview.xuly.follow.stateWaiting", reopened: "overview.xuly.follow.stateReopened", done: "overview.xuly.follow.stateDone" };

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

export default function TheoDoiPage() {
  const t = useT();
  const { user } = useSession();
  const { data, error, isLoading, mutate } = useSWR<BoardResponse>("/api/cases/board", getJson);
  const [companyFilter, setCompanyFilter] = useState<"ALL" | Company>("ALL");
  const [platformFilter, setPlatformFilter] = useState<"ALL" | "google" | "facebook">("ALL");
  const [stateFilter, setStateFilter] = useState<"ALL" | BoardState>("ALL");
  const [importOpen, setImportOpen] = useState(false);
  const canImport = !!user && isSuperAdmin(user.role);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const reminders = data?.reminders ?? { enabled: false, overdueDays: 3 };

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (companyFilter === "ALL" || r.company === companyFilter) &&
          (platformFilter === "ALL" || r.platform === platformFilter) &&
          (stateFilter === "ALL" || r.state === stateFilter),
      ),
    [rows, companyFilter, platformFilter, stateFilter],
  );

  const kpi = useMemo(
    () => ({
      working: rows.filter((r) => r.state === "working").length,
      waiting: rows.filter((r) => r.state === "waiting").length,
      reopened: rows.filter((r) => r.state === "reopened").length,
      overdueTasks: rows.reduce((s, r) => s + r.tasks.overdue, 0),
    }),
    [rows],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <ListChecks className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("overview.xuly.follow.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("overview.xuly.follow.subtitle")}</p>
        </div>
        <div className="flex items-start gap-2">
          {canImport && (
            <div className="text-right">
              <Button className="h-10" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" /> {t("overview.xuly.follow.importBtn")}
              </Button>
              <div className="mt-1 text-xs text-slate-400">{t("overview.xuly.follow.superAdminOnly")}</div>
            </div>
          )}
          <Button className="h-10" variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" /> {t("overview.xuly.follow.reload")}
          </Button>
        </div>
      </div>

      {canImport && (
        <ImportCasesDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => mutate()} />
      )}

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        </div>
      )}

      {!isLoading && error && (
        <EmptyState
          icon={AlertTriangle}
          title={error instanceof ApiError ? error.message : t("overview.xuly.follow.loadFailed")}
          action={<Button className="h-10" onClick={() => mutate()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("overview.xuly.follow.retry")}</Button>}
        />
      )}

      {!isLoading && !error && data && rows.length === 0 && (
        <EmptyState
          title={t("overview.xuly.follow.emptyTitle")}
          description={t("overview.xuly.follow.emptyDesc")}
          action={<Button className="h-10" render={<Link href="/xu-ly" />}>{t("overview.xuly.follow.openOverview")}</Button>}
        />
      )}

      {!isLoading && !error && data && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={t("overview.xuly.follow.kpiOpen")} value={String(kpi.working)} />
            <Kpi label={t("overview.xuly.follow.kpiWaiting")} value={String(kpi.waiting)} />
            <Kpi label={t("overview.xuly.follow.kpiReopened")} value={String(kpi.reopened)} bad={kpi.reopened > 0} />
            <Kpi label={t("overview.xuly.follow.kpiOverdue")} value={String(kpi.overdueTasks)} sub={reminders.enabled ? t("overview.xuly.follow.teamsWillRemind") : t("overview.xuly.follow.teamsOff")} bad={kpi.overdueTasks > 0} />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-[160px]">
              <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.follow.company")}</div>
              <Select value={companyFilter} onValueChange={(v) => setCompanyFilter(v as "ALL" | Company)}>
                <SelectTrigger aria-label={t("overview.xuly.follow.company")}><SelectValue>{(v: string) => (v === "ALL" ? t("overview.xuly.follow.all") : v)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("overview.xuly.follow.all")}</SelectItem>
                  {data.companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.follow.platform")}</div>
              <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v as "ALL" | "google" | "facebook")}>
                <SelectTrigger aria-label={t("overview.xuly.follow.platform")}><SelectValue>{(v: string) => (v === "ALL" ? t("overview.xuly.follow.all") : v === "google" ? "Google" : v === "facebook" ? "Facebook" : v)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("overview.xuly.follow.all")}</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px]">
              <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.follow.status")}</div>
              <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as "ALL" | BoardState)}>
                <SelectTrigger aria-label={t("overview.xuly.follow.status")}><SelectValue>{(v: string) => (v === "ALL" ? t("overview.xuly.follow.all") : STATE_LABEL[v as BoardState] ? t(STATE_LABEL[v as BoardState]) : v)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("overview.xuly.follow.all")}</SelectItem>
                  {(Object.keys(STATE_LABEL) as BoardState[]).map((s) => <SelectItem key={s} value={s}>{t(STATE_LABEL[s])}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState compact title={t("overview.xuly.follow.noMatchTitle")} description={t("overview.xuly.follow.noMatchDesc")} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2.5 font-medium">{t("overview.xuly.follow.thCampaign")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("overview.xuly.follow.thStep")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("overview.xuly.follow.status")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("overview.xuly.follow.th7")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("overview.xuly.follow.th14")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("overview.xuly.follow.thTasks")}</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const st = STATE_PILL[r.state];
                    return (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0 align-top">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{r.campaignName}</div>
                          <div className="text-xs text-slate-400">{r.company} · {r.platform === "facebook" ? "Facebook" : "Google"}</div>
                        </td>
                        <td className="px-3 py-2.5"><Pill tone="grey">{r.step} · {t(STEP_LABELS[r.step as CaseStep])}</Pill></td>
                        <td className="px-3 py-2.5"><Pill tone={st.tone}>{t(st.text)}</Pill></td>
                        <td className="px-3 py-2.5"><RemeasureCell r={r.remeasure[0]} /></td>
                        <td className="px-3 py-2.5"><RemeasureCell r={r.remeasure[1]} /></td>
                        <td className="px-3 py-2.5">
                          {r.tasks.open === 0 ? (
                            <span className="text-xs text-slate-400">{t("overview.xuly.follow.noTasks")}</span>
                          ) : (
                            <div className="space-y-1">
                              <div className="tabular-nums text-xs text-slate-600">{t("overview.xuly.follow.tasksOpen", { open: r.tasks.open, days: r.tasks.oldestDays ?? "" })}</div>
                              {r.tasks.overdue > 0 && (
                                <Pill tone="red">{t("overview.xuly.follow.overdue", { days: reminders.overdueDays, teams: reminders.enabled ? t("overview.xuly.follow.teamsWillRemind") : t("overview.xuly.follow.teamsOff") })}</Pill>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Button size="sm" variant="outline" render={<Link href={`/xu-ly/${r.id}`} />}>{t("overview.xuly.follow.openCase")}</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows.some((r) => r.remeasure.some((rm) => rm && rm.done && rm.cpaAfter !== null)) && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              {rich(t("overview.xuly.follow.legend"))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RemeasureCell({ r }: { r: BoardRow["remeasure"][number] }) {
  const intl = useIntlLocale();
  const t = useT();
  if (!r) return <span className="text-slate-300">—</span>;
  if (!r.done) return <span className="text-xs text-slate-500">{t("overview.xuly.follow.notDue", { date: ddmmyyyy(r.due, intl) })}</span>;
  // Đợt 23: có kết quả chấm theo mục tiêu (lib/case/judge.ts) → hiện đạt / chưa rõ / xấu hơn; phiên chấm ROAS hiện ROAS.
  if (typeof r.verdict === "number") {
    const roas = r.roasAfter !== null && r.roasAfter !== undefined;
    return (
      <span className="tabular-nums text-xs text-slate-700">
        {roas ? <>ROAS {r.roasBefore ?? "—"} → {r.roasAfter}</> : <>{r.cpaBefore !== null ? vnd(r.cpaBefore, intl) : "—"} → {r.cpaAfter !== null ? vnd(r.cpaAfter, intl) : t("overview.xuly.follow.zeroOrders")}</>}{" "}
        {r.verdict === 1 && <span className="font-semibold text-emerald-600">{t("overview.xuly.follow.verdictGood")}</span>}
        {r.verdict === 0 && <span className="font-semibold text-amber-600" title={t("overview.xuly.follow.unclearTip")}>{t("overview.xuly.follow.verdictUnclear")}</span>}
        {r.verdict === -1 && <span className="font-semibold text-red-600">{t("overview.xuly.follow.verdictWorse")}</span>}
        {r.verdict === 2 && <span className="font-semibold text-slate-500" title={t("overview.xuly.follow.noDataTip")}>{t("overview.xuly.follow.verdictNoData")}</span>}
      </span>
    );
  }
  if (r.cpaBefore === null || r.cpaAfter === null) return <span className="text-slate-300">—</span>;
  return (
    <span className="tabular-nums text-xs text-slate-700">
      {vnd(r.cpaBefore, intl)} → {vnd(r.cpaAfter, intl)}{" "}
      {r.better === true && <span className="font-semibold text-emerald-600">{t("overview.xuly.follow.better")}</span>}
      {r.better === false && <span className="font-semibold text-red-600">{t("overview.xuly.follow.verdictWorse")}</span>}
      {r.better === null && <span className="text-slate-400">—</span>}
    </span>
  );
}
