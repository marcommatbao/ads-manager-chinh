"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, Play, TrendingUp, TrendingDown, AlertTriangle,
  Search, CheckCircle, XCircle, ChevronDown, ChevronUp, Plus, Ban,
  Zap, BarChart3, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { resolveMatchType } from "@/lib/google-ads-helpers";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { useGuardedWrite, type GuardedCall } from "@/components/ConfirmWriteDialog";
import { companyIds, companyLabel, orderedCompanyIds } from "@/lib/companies/registry";

// ── Types ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJSON = any;

interface BudgetHistoryItem {
  company: string;
  campaignName: string;
  action: string;
  oldBudget: number;
  newBudget: number;
  cpl: number;
  reason: string;
  appliedAt: string;
}

interface GoogleAlert {
  type: string;
  company: string;
  campaignName: string;
  metric: string;
  value: number | string;
  message: string;
  action: string;
  createdAt: string;
}

interface KeywordPerf {
  keyword: string;
  matchType: string;
  campaignName: string;
  cost: number;
  conversions: number;
  cpl: number;
  cpc: number;
  clicks: number;
  ctr: string;
  adGroupName: string;
  campaignId: string;
}

interface SearchTermItem {
  searchTerm: string;
  campaignName: string;
  campaignId: string;
  adGroupId: string;
  clicks: number;
  conversions: number;
  cost: number;
  ctr: string;
}

// ── Helpers ──

function fmtMoneyL(val: number, tr: TFunction, loc: string): string {
  if (val >= 1_000_000) return tr("panels.gautomation.money.m", { n: (val / 1_000_000).toFixed(1) });
  if (val >= 1_000) return `₫${Math.round(val / 1000)}K`;
  return `₫${val.toLocaleString(loc)}`;
}

function fmtRelativeL(iso: string, tr: TFunction): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return tr("panels.gautomation.rel.now");
  if (mins < 60) return tr("panels.gautomation.rel.min", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tr("panels.gautomation.rel.hour", { n: hours });
  return tr("panels.gautomation.rel.day", { n: Math.floor(hours / 24) });
}

const CPL_THRESHOLDS = {
  MBC: { good: 130_000, warning: 180_000, danger: 190_000 },
  MBI: { good: 180_000, warning: 190_000, danger: 230_000 },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function GoogleAutomationTab() {
  const tr = useT();
  const loc = useIntlLocale();
  const fmtMoney = (v: number) => fmtMoneyL(v, tr, loc);
  const fmtRelative = (iso: string) => fmtRelativeL(iso, tr);
  const [company, setCompany] = useState<string>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [loading, setLoading] = useState(true);

  // Data
  const [budgetHistory, setBudgetHistory] = useState<BudgetHistoryItem[]>([]);
  const [alerts, setAlerts] = useState<GoogleAlert[]>([]);
  const [keywordPerf, setKeywordPerf] = useState<{ topPerformers: KeywordPerf[]; shouldPause: KeywordPerf[] }>({ topPerformers: [], shouldPause: [] });
  const [searchTerms, setSearchTerms] = useState<{ suggestAdd: SearchTermItem[]; suggestNegative: SearchTermItem[] }>({ suggestAdd: [], suggestNegative: [] });

  // UI State
  const [runningMonitor, setRunningMonitor] = useState(false);
  const [runningBudget, setRunningBudget] = useState(false);
  const [addingKeywords, setAddingKeywords] = useState(false);
  const [addingNegatives, setAddingNegatives] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["budget", "alerts"]));
  const { toast } = useToast();
  const guard = useGuardedWrite();

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Fetch All Data ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // The monitor endpoint used to be pinged here on every load and its
      // result thrown away — it is cron-authenticated, so the call was a
      // guaranteed 401 that fetched nothing. Alerts come from the stored
      // JSON below, which is what actually feeds this tab.
      const [bh, kp, st] = await Promise.allSettled([
        fetch("/api/automation/google/budget-history?limit=20").then(r => r.json()),
        fetch(`/api/google/keywords/performance?company=${company}`).then(r => r.json()),
        fetch(`/api/google/search-terms?company=${company}`).then(r => r.json()),
      ]);

      if (bh.status === "fulfilled" && bh.value.success) {
        setBudgetHistory(bh.value.data);
      }
      // Load alerts from JSON file
      try {
        const alertRes = await fetch("/api/automation/google/alerts?limit=20");
        if (alertRes.ok) {
          const alertData = await alertRes.json();
          if (alertData.success) setAlerts(alertData.data);
        }
      } catch { /* alerts endpoint may not exist yet */ }

      if (kp.status === "fulfilled" && kp.value.success) {
        setKeywordPerf(kp.value.data);
      }
      if (st.status === "fulfilled" && st.value.success) {
        setSearchTerms(st.value.data);
      }
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Manual job runs ──
  //
  // Both of these buttons used to call the cron endpoints
  // (/api/automation/google/budget-optimizer, /api/automation/google/monitor)
  // straight from the browser. Those routes require
  // `Authorization: Bearer $CRON_SECRET` (lib/cron-auth.ts, header-only, never
  // a query param), which a browser cannot send — so every click returned 401,
  // the `data.success` check quietly failed, and the button spun and then did
  // nothing at all. /api/jobs/[id]/trigger is the app's real manual-trigger
  // path: it is session-authenticated, attaches CRON_SECRET server-side, and
  // both jobs are already registered with manualTriggerAllowed: true.
  const runJob = async (jobId: "google_budget_optimizer" | "google_monitor"): Promise<AnyJSON | null> => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/trigger`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        toast({
          title: tr("panels.gautomation.jobFail"),
          description: data.error ?? data.result?.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return null;
      }
      return data.result ?? null;
    } catch {
      toast({ title: tr("panels.gautomation.jobConn"), variant: "error" });
      return null;
    }
  };

  const handleRunBudget = async () => {
    setRunningBudget(true);
    try {
      const result = await runJob("google_budget_optimizer");
      if (!result) return;
      const actions: AnyJSON[] = result.actions ?? [];
      if (actions.length > 0) {
        setBudgetHistory(prev => [...actions.map((a: AnyJSON) => ({
          ...a, appliedAt: a.appliedAt || new Date().toISOString(),
        })), ...prev]);
      }
      toast({
        title: actions.length > 0
          ? tr("panels.gautomation.budgetOk", { n: actions.length })
          : tr("panels.gautomation.budgetNone"),
      });
    } finally {
      setRunningBudget(false);
    }
  };

  const handleRunMonitor = async () => {
    setRunningMonitor(true);
    try {
      const result = await runJob("google_monitor");
      if (!result) return;
      const details: AnyJSON[] = result.details ?? [];
      if (details.length > 0) setAlerts(details);
      toast({
        title: details.length > 0
          ? tr("panels.gautomation.monitorOk", { n: details.length })
          : tr("panels.gautomation.monitorNone"),
      });
    } finally {
      setRunningMonitor(false);
    }
  };

  // ── Add keywords / negatives ──
  //
  // These write real ad group criteria into the live Google Ads account.
  // Đợt 11d-UI: đi qua lớp ghi an toàn dùng chung — Kiểm trước (validateOnly,
  // không ghi) → hộp thoại gõ "XAC NHAN" → ghi thật → toast kèm nút Hoàn tác.
  // Trước đây gọi thẳng, không kiểm trước, không hoàn tác được.
  const pushKeywords = async (
    call: GuardedCall,
    dialogTitle: string,
    successLabel: (added: number) => string,
    setBusy: (v: boolean) => void,
  ) => {
    setBusy(true);
    try {
      await guard.run(
        [call],
        { title: dialogTitle, company },
        {
          onValidateFail: (message) => toast({ title: tr("panels.gautomation.validateFail"), description: message, variant: "error" }),
          onSuccess: (results) => {
            const data = results[0].raw;
            const added = (data.added as number | undefined) ?? 0;
            const failed = data.failed as number | undefined;
            toast({
              title: successLabel(added),
              description: failed ? tr("panels.gautomation.failedItems", { n: failed }) : undefined,
              variant: failed ? "error" : "success",
              action: guard.undoAction(company, [results[0].writeId]),
            });
            fetchAll();
          },
          onFailure: (results) => {
            toast({ title: tr("panels.gautomation.applyFail"), description: results[0].error, variant: "error" });
            fetchAll();
          },
        }
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAddKeywords = async () => {
    if (!searchTerms.suggestAdd.length) return;
    await pushKeywords(
      {
        url: "/api/google/keywords/add",
        payload: {
          company,
          keywords: searchTerms.suggestAdd.map(t => ({
            keyword: t.searchTerm,
            matchType: "PHRASE",
            campaignId: t.campaignId,
            adGroupId: t.adGroupId,
          })),
        },
        label: tr("panels.gautomation.addKwLabel", { n: searchTerms.suggestAdd.length, list: `${searchTerms.suggestAdd.slice(0, 5).map(t => t.searchTerm).join(", ")}${searchTerms.suggestAdd.length > 5 ? "…" : ""}` }),
      },
      tr("panels.gautomation.addKwTitle", { n: searchTerms.suggestAdd.length }),
      (added) => tr("panels.gautomation.addKwDone", { n: added }),
      setAddingKeywords,
    );
  };

  const handleAddNegatives = async () => {
    if (!searchTerms.suggestNegative.length) return;
    await pushKeywords(
      {
        url: "/api/google/keywords/negative",
        payload: {
          company,
          negatives: searchTerms.suggestNegative.map(t => ({
            keyword: t.searchTerm,
            matchType: "PHRASE",
            campaignId: t.campaignId,
          })),
        },
        label: tr("panels.gautomation.addNegLabel", { n: searchTerms.suggestNegative.length, list: `${searchTerms.suggestNegative.slice(0, 5).map(t => t.searchTerm).join(", ")}${searchTerms.suggestNegative.length > 5 ? "…" : ""}` }),
      },
      tr("panels.gautomation.addNegTitle", { n: searchTerms.suggestNegative.length }),
      (added) => tr("panels.gautomation.addNegDone", { n: added }),
      setAddingNegatives,
    );
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-red-500 mx-auto" />
          <p className="text-sm text-slate-500">{tr("panels.gautomation.loading")}</p>
        </div>
      </div>
    );
  }

  // ── Today's budget actions ──
  const todayBudget = budgetHistory.filter(b => {
    const d = new Date(b.appliedAt);
    const now = new Date();
    // Year included — day+month alone matched the same date in any earlier
    // year, so a kept action from last year showed up as "hôm nay".
    return d.getDate() === now.getDate()
      && d.getMonth() === now.getMonth()
      && d.getFullYear() === now.getFullYear();
  });

  return (
    <>
    <div className="space-y-6">
      {/* Company Selector */}
      <div className="flex items-center gap-2">
        {companyIds().map(c => (
          <button
            key={c}
            onClick={() => setCompany(c)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-all border-2",
              company === c
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            )}
          >
            {c === "MBC" ? "🌐 Mắt Bão (MBC)" : c === "MBI" ? "🧾 Matbao Invoice (MBI)" : companyLabel(c)}
          </button>
        ))}
      </div>

      {/* Chỉ đường tới nơi đặt quy tắc.
          Tab Google chỉ có BA việc tự động dựng sẵn (Budget Optimizer, CPL
          Monitor, Keyword Performance) — không có danh sách quy tắc. Danh sách
          đó nằm ở tab Facebook, và nó CÓ áp cho Google: biểu mẫu tạo quy tắc
          cho chọn Facebook / Google / Cả hai, còn lib/automation-engine.ts
          nhánh `rule.platform === "google"` gọi fetchGoogleCampaigns() rồi
          hành động thật. Không nói ra thì người dùng sang tab Google, không
          thấy quy tắc đâu, và kết luận là tool không đặt được quy tắc cho
          Google — đúng câu hỏi nhận được ngày 22/09/2026. */}
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
        {tr("panels.gautomation.hintA")} <b>{tr("panels.gautomation.hintB")}</b>{tr("panels.gautomation.hintC")} <b>{tr("panels.gautomation.hintD")}</b> {tr("panels.gautomation.hintE")} <b>Facebook</b> {tr("panels.gautomation.hintF")} <b>Google</b> {tr("panels.gautomation.hintG")} <b>{tr("panels.gautomation.hintH")}</b> {tr("panels.gautomation.hintI")}
      </p>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* BUDGET OPTIMIZER                        */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection("budget")}
          className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 hover:from-blue-100 hover:to-indigo-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500 p-2 shadow-sm">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-bold text-slate-800">🤖 Budget Optimizer</h3>
              <p className="text-[10px] text-slate-500">{tr("panels.gautomation.budget.sub")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-blue-600 bg-blue-100 rounded-full px-3 py-1">
              {tr("panels.gautomation.budget.today", { n: todayBudget.length })}
            </span>
            {expandedSections.has("budget")
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />
            }
          </div>
        </button>

        {expandedSections.has("budget") && (
          <div className="p-6">
            {todayBudget.length > 0 ? (
              <div className="space-y-3 mb-4">
                <p className="text-xs font-semibold text-slate-600">
                  {tr("panels.gautomation.budget.todayLine", { n: todayBudget.length })}
                </p>
                {todayBudget.map((b, i) => {
                  const isIncrease = b.action.startsWith("INCREASE");
                  const pct = isIncrease
                    ? `+${Math.round(((b.newBudget - b.oldBudget) / b.oldBudget) * 100)}%`
                    : `${Math.round(((b.newBudget - b.oldBudget) / b.oldBudget) * 100)}%`;

                  return (
                    <div key={i} className={cn(
                      "rounded-lg border p-4",
                      isIncrease ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"
                    )}>
                      <div className="flex items-center gap-2 mb-1">
                        {isIncrease
                          ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                          : <TrendingDown className="h-4 w-4 text-amber-500" />
                        }
                        <span className="text-sm font-bold text-slate-700">{b.campaignName}</span>
                        <span className={cn(
                          "text-xs font-bold rounded px-1.5 py-0.5",
                          isIncrease ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {pct}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        {fmtMoney(b.oldBudget)} → <strong>{fmtMoney(b.newBudget)}</strong>
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        CPL {fmtMoney(b.cpl)} — {b.reason}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <BarChart3 className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">{tr("panels.gautomation.budget.none")}</p>
              </div>
            )}

            {/* Budget history (older) */}
            {budgetHistory.length > todayBudget.length && (
              <details className="mt-4">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                  {tr("panels.gautomation.budget.history", { n: budgetHistory.length - todayBudget.length })}
                </summary>
                <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto">
                  {budgetHistory.slice(todayBudget.length).map((b, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 px-4 py-2 text-xs">
                      <span className={b.action.startsWith("INCREASE") ? "text-emerald-500" : "text-amber-500"}>
                        {b.action.startsWith("INCREASE") ? "↑" : "↓"}
                      </span>
                      <span className="flex-1 text-slate-600 truncate">{b.campaignName}</span>
                      <span className="text-slate-400">
                        {fmtMoney(b.oldBudget)} → {fmtMoney(b.newBudget)}
                      </span>
                      <span className="text-[10px] text-slate-300">{fmtRelative(b.appliedAt)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                disabled={runningBudget}
                onClick={handleRunBudget}
              >
                {runningBudget
                  ? <><RefreshCw className="h-3 w-3 animate-spin" /> {tr("panels.gautomation.budget.running")}</>
                  : <><Play className="h-3 w-3" /> {tr("panels.gautomation.budget.run")}</>
                }
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* CPL MONITOR                             */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection("alerts")}
          className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-slate-200 hover:from-amber-100 hover:to-orange-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500 p-2 shadow-sm">
              <AlertTriangle className="h-4 w-4 text-white" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-bold text-slate-800">🔔 CPL Monitor</h3>
              <p className="text-[10px] text-slate-500">{tr("panels.gautomation.mon.sub")}</p>
            </div>
          </div>
          {expandedSections.has("alerts")
            ? <ChevronUp className="h-4 w-4 text-slate-400" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />
          }
        </button>

        {expandedSections.has("alerts") && (
          <div className="p-6 space-y-4">
            {/* Threshold display */}
            <div className="grid grid-cols-2 gap-3">
              {companyIds().map(c => {
                const t = (CPL_THRESHOLDS as Record<string, typeof CPL_THRESHOLDS["MBC"] | undefined>)[c];
                if (!t) return null;
                return (
                  <div key={c} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold text-slate-600 mb-1">{c}:</p>
                    <div className="flex gap-2 text-[10px]">
                      <span className="bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">{tr("panels.gautomation.mon.good")} &lt;{fmtMoney(t.good)}</span>
                      <span className="bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">⚠️ {fmtMoney(t.warning)}</span>
                      <span className="bg-red-100 text-red-700 rounded px-1.5 py-0.5">🔴 {fmtMoney(t.danger)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Alerts list */}
            {alerts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">{tr("panels.gautomation.mon.recent")}</p>
                {/* Bảng này CHỈ được ghi thêm khi có alert. Lượt kiểm chạy xong
                    mà không phát hiện gì thì không ghi gì cả — nên danh sách
                    giữ nguyên tin cũ và trông như "việc gần đây nhất là hỏng".
                    Gặp thật 22/09/2026: 8 dòng lỗi từ 98–137 ngày trước nằm
                    đó, trong khi truy vấn chạy lại hôm nay vẫn tốt. Nói rõ
                    tuổi của dòng mới nhất thay vì để người đọc tự suy. */}
                {(() => {
                  const newest = alerts[0]?.createdAt ? new Date(alerts[0].createdAt).getTime() : 0;
                  const days = newest ? Math.floor((Date.now() - newest) / 86_400_000) : 0;
                  if (!newest || days < 7) return null;
                  return (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-600">
                      {tr("panels.gautomation.mon.staleA")} <b>{tr("panels.gautomation.mon.staleDays", { n: days })}</b> {tr("panels.gautomation.mon.staleB")} <b>{tr("panels.gautomation.mon.staleC")}</b> {tr("panels.gautomation.mon.staleD")}
                    </p>
                  );
                })()}
                {alerts.slice(0, 10).map((a, i) => (
                  <div key={i} className={cn(
                    "rounded-lg border px-4 py-2.5 text-xs flex items-center gap-2",
                    a.type === "DANGER" ? "border-red-200 bg-red-50" :
                    a.type === "WARNING" ? "border-amber-200 bg-amber-50" :
                    "border-emerald-200 bg-emerald-50"
                  )}>
                    <span>
                      {a.type === "DANGER" ? "🔴" : a.type === "WARNING" ? "🟡" : "🟢"}
                    </span>
                    <span className="flex-1 text-slate-600">{a.message}</span>
                    {a.createdAt && (
                      <span className="text-[10px] text-slate-300 shrink-0">{fmtRelative(a.createdAt)}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <CheckCircle className="h-8 w-8 text-emerald-300 mx-auto mb-2" />
                <p className="text-xs text-slate-400">{tr("panels.gautomation.mon.none")}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                disabled={runningMonitor}
                onClick={handleRunMonitor}
              >
                {runningMonitor
                  ? <><RefreshCw className="h-3 w-3 animate-spin" /> {tr("panels.gautomation.mon.running")}</>
                  : <><Play className="h-3 w-3" /> {tr("panels.gautomation.mon.run")}</>
                }
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* KEYWORD PERFORMANCE                     */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection("keywords")}
          className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-slate-200 hover:from-emerald-100 hover:to-teal-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500 p-2 shadow-sm">
              <BarChart3 className="h-4 w-4 text-white" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-bold text-slate-800">📊 Keyword Performance</h3>
              <p className="text-[10px] text-slate-500">{tr("panels.gautomation.kw.sub", { company })}</p>
            </div>
          </div>
          {expandedSections.has("keywords")
            ? <ChevronUp className="h-4 w-4 text-slate-400" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />
          }
        </button>

        {expandedSections.has("keywords") && (
          <div className="p-6 space-y-5">
            {/* Top performers */}
            {keywordPerf.topPerformers.length > 0 && (
              <div>
                <p className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> {tr("panels.gautomation.kw.top")}
                </p>
                <div className="space-y-1">
                  {keywordPerf.topPerformers.slice(0, 10).map((kw, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/30 px-3 py-2 text-xs">
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold",
                        resolveMatchType(kw.matchType) === "EXACT" ? "bg-emerald-100 text-emerald-700" :
                        resolveMatchType(kw.matchType) === "PHRASE" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {resolveMatchType(kw.matchType).toLowerCase()}
                      </span>
                      <span className="flex-1 text-slate-700 font-medium truncate">{kw.keyword}</span>
                      <span className="text-emerald-600 font-bold">CPL {fmtMoney(kw.cpl)}</span>
                      <span className="text-slate-400">{kw.conversions} conv</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Should pause */}
            {keywordPerf.shouldPause.length > 0 && (
              <div>
                <p className="text-xs font-bold text-red-700 mb-2 flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" /> {tr("panels.gautomation.kw.pause")}
                </p>
                <div className="space-y-1">
                  {keywordPerf.shouldPause.slice(0, 10).map((kw, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50/30 px-3 py-2 text-xs">
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold",
                        resolveMatchType(kw.matchType) === "EXACT" ? "bg-emerald-100 text-emerald-700" :
                        resolveMatchType(kw.matchType) === "PHRASE" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {resolveMatchType(kw.matchType).toLowerCase()}
                      </span>
                      <span className="flex-1 text-slate-700 font-medium truncate">{kw.keyword}</span>
                      <span className="text-red-600 font-bold">CPC {fmtMoney(kw.cpc)}</span>
                      <span className="text-slate-400">{kw.clicks} clicks | 0 conv</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {keywordPerf.topPerformers.length === 0 && keywordPerf.shouldPause.length === 0 && (
              <div className="text-center py-8">
                <Search className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">{tr("panels.gautomation.kw.none")}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* SEARCH TERM REPORT                      */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection("search-terms")}
          className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-violet-50 to-purple-50 border-b border-slate-200 hover:from-violet-100 hover:to-purple-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-violet-500 p-2 shadow-sm">
              <Search className="h-4 w-4 text-white" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-bold text-slate-800">📝 Search Term Report</h3>
              <p className="text-[10px] text-slate-500">{tr("panels.gautomation.st.sub", { company })}</p>
            </div>
          </div>
          {expandedSections.has("search-terms")
            ? <ChevronUp className="h-4 w-4 text-slate-400" />
            : <ChevronDown className="h-4 w-4 text-slate-400" />
          }
        </button>

        {expandedSections.has("search-terms") && (
          <div className="p-6 space-y-5">
            {/* Suggest Add */}
            {searchTerms.suggestAdd.length > 0 && (
              <div>
                <p className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" /> {tr("panels.gautomation.st.add")}
                </p>
                <div className="space-y-1">
                  {searchTerms.suggestAdd.slice(0, 10).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/30 px-3 py-2 text-xs">
                      <span className="flex-1 text-slate-700 font-medium">"{t.searchTerm}"</span>
                      <span className="text-slate-500">{t.clicks} clicks</span>
                      <span className="text-emerald-600 font-bold">{t.conversions} conv</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-1.5 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                  disabled={addingKeywords}
                  onClick={handleAddKeywords}
                >
                  {addingKeywords
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> {tr("panels.gautomation.st.adding")}</>
                    : <><Plus className="h-3 w-3" /> {tr("panels.gautomation.st.addAll")}</>
                  }
                </Button>
              </div>
            )}

            {/* Suggest Negative */}
            {searchTerms.suggestNegative.length > 0 && (
              <div>
                <p className="text-xs font-bold text-red-700 mb-2 flex items-center gap-1.5">
                  <Ban className="h-3.5 w-3.5" /> {tr("panels.gautomation.st.neg")}
                </p>
                <div className="space-y-1">
                  {searchTerms.suggestNegative.slice(0, 10).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50/30 px-3 py-2 text-xs">
                      <span className="flex-1 text-slate-700 font-medium">"{t.searchTerm}"</span>
                      <span className="text-slate-500">{t.clicks} clicks</span>
                      <span className="text-red-600 font-bold">0 conv</span>
                      <span className="text-slate-400">{fmtMoney(t.cost)}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-1.5 text-xs text-red-700 border-red-200 hover:bg-red-50"
                  disabled={addingNegatives}
                  onClick={handleAddNegatives}
                >
                  {addingNegatives
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> {tr("panels.gautomation.st.adding")}</>
                    : <><Ban className="h-3 w-3" /> {tr("panels.gautomation.st.negAll")}</>
                  }
                </Button>
              </div>
            )}

            {searchTerms.suggestAdd.length === 0 && searchTerms.suggestNegative.length === 0 && (
              <div className="text-center py-8">
                <Search className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">{tr("panels.gautomation.st.none")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    {guard.dialog}
    </>
  );
}
