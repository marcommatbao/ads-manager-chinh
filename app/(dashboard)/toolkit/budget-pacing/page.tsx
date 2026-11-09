"use client";

import { useState, useEffect } from "react";
import { resolveCompanyScope } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, AlertCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/SessionProvider";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface CampaignPacing {
  id: string;
  name: string;
  spent: number;
  budget: number;
  dailyBudget: number;
  expectedPct: number;
  actualPct: number;
  clicks: number;
  conversions: number;
  recentDailyAvg: number;
  projectedSpend: number;
  projectedPct: number;
  willExceedBudget: boolean;
  daysUntilCapped: number | null;
}

interface ApiResponse {
  success: boolean;
  company: string;
  campaigns: CampaignPacing[];
  elapsedPct: number;
  dayOfMonth: number;
  daysInMonth: number;
  error?: string;
}

function formatVND(v: number) {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B₫`;
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(0)}M₫`;
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K₫`;
  return `${v}₫`;
}

function paceStatus(actualPct: number, expectedPct: number): { label: MessageKey; color: string; bar: string } {
  const diff = actualPct - expectedPct;
  if (diff > 10)  return { label: "google.budgetPacing.statusOver", color: "text-red-600", bar: "bg-red-400" };
  if (diff < -15) return { label: "google.budgetPacing.statusSlow", color: "text-amber-600", bar: "bg-amber-400" };
  return { label: "google.budgetPacing.statusOnTrack", color: "text-emerald-600", bar: "bg-emerald-400" };
}

function CampaignRow({ c }: { c: CampaignPacing }) {
  const t = useT();
  const status = paceStatus(c.actualPct, c.expectedPct);
  return (
    <div className="space-y-1.5 py-2.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700 truncate" title={c.name}>{c.name}</span>
        <span className={cn("shrink-0 text-[11px] font-semibold", status.color)}>{t(status.label)}</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-slate-100">
        <div className={cn("h-2 rounded-full transition-all", status.bar)} style={{ width: `${Math.min(100, c.actualPct)}%` }} />
        <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-slate-400 rounded" style={{ left: `${Math.min(100, c.expectedPct)}%` }} title={t("google.budgetPacing.expectedTitle", { pct: c.expectedPct })} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span>{formatVND(c.spent)} / {formatVND(c.budget)}</span>
        <span>
          {c.actualPct}% <span className="text-slate-300">{t("google.budgetPacing.vsExpected", { pct: c.expectedPct })}</span>
          {c.conversions > 0 && <span className="ml-1.5 text-emerald-500">{t("google.budgetPacing.conv", { n: Math.round(c.conversions) })}</span>}
        </span>
      </div>
      {c.willExceedBudget && (
        <div className="flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-1 text-[10px] text-red-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>
            {t("google.budgetPacing.forecastPre")} <b>{formatVND(c.projectedSpend)}</b> {t("google.budgetPacing.forecastPost", { pct: c.projectedPct })}
            {c.daysUntilCapped !== null && c.daysUntilCapped > 0 && t("google.budgetPacing.cappedIn", { days: c.daysUntilCapped })}
          </span>
        </div>
      )}
    </div>
  );
}

function CompanyCard({ data, color }: { data: ApiResponse | null; color: string }) {
  const t = useT();
  if (!data) return null;
  const { campaigns, company } = data;
  if (campaigns.length === 0) {
    return (
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl flex-1">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <span className={cn("h-3 w-3 rounded-full shrink-0", color)} />
            <CardTitle className="text-base font-semibold text-slate-800">{company}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-400 text-center py-6">{t("google.budgetPacing.noCampaigns")}</p>
        </CardContent>
      </Card>
    );
  }

  const totalSpent  = campaigns.reduce((s, c) => s + c.spent, 0);
  const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0);
  const overPace    = campaigns.filter(c => c.actualPct - c.expectedPct > 10).length;
  const slow        = campaigns.filter(c => c.expectedPct - c.actualPct > 15).length;
  const willExceed  = campaigns.filter(c => c.willExceedBudget).length;

  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl flex-1">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={cn("h-3 w-3 rounded-full shrink-0", color)} />
            <CardTitle className="text-base font-semibold text-slate-800">{company}</CardTitle>
            <span className="text-[10px] text-slate-400">({campaigns.length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            {overPace > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5">
                <AlertCircle className="h-3 w-3 text-red-500" />
                <span className="text-[10px] font-medium text-red-600">{t("google.budgetPacing.overCount", { n: overPace })}</span>
              </div>
            )}
            {slow > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
                <AlertCircle className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] font-medium text-amber-600">{t("google.budgetPacing.slowCount", { n: slow })}</span>
              </div>
            )}
            {willExceed > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5">
                <AlertTriangle className="h-3 w-3 text-red-600" />
                <span className="text-[10px] font-semibold text-red-700">{t("google.budgetPacing.willExceedCount", { n: willExceed })}</span>
              </div>
            )}
          </div>
        </div>
        <CardDescription className="text-xs text-slate-500">
          {t("google.budgetPacing.total")} {formatVND(totalSpent)} / {formatVND(totalBudget)}{" "}
          ({totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}%)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {campaigns.map(c => <CampaignRow key={c.id} c={c} />)}
      </CardContent>
    </Card>
  );
}

export default function BudgetPacingPage() {
  const t = useT();
  // Layout đọc user phía server rồi truyền vào SessionProvider nên `user` có ngay
  // ở lần render đầu; vẫn chờ `sessionLoading` để không phụ thuộc chi tiết đó.
  const { user, loading: sessionLoading } = useSession();
  // Xem chú thích ở resolveCompanyScope: user.companies là PHẠM VI ("ALL"),
  // không phải danh sách công ty.
  const allowed = resolveCompanyScope(user?.companies, user?.role);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [mbc, setMbc]         = useState<ApiResponse | null>(null);
  const [mbi, setMbi]         = useState<ApiResponse | null>(null);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      // Chỉ gọi công ty người này được xem. Bản cũ luôn gọi cả hai rồi ném lỗi
      // nếu bất kỳ cái nào hỏng — nên một người chỉ có quyền MBI mở trang này sẽ
      // nhận đúng câu "Access denied for this company" và KHÔNG thấy gì cả, kể cả
      // dữ liệu MBI mà họ có toàn quyền. Trang chỉ dùng được với super_admin.
      const targets = allowed;
      if (targets.length === 0) throw new Error(t("google.budgetPacing.noCompany"));

      const results = await Promise.all(
        targets.map(async (c) => {
          const res = await fetch(`/api/google/toolkit/budget-pacing?company=${c}`);
          return { company: c, json: await res.json() };
        }),
      );
      const bad = results.find(r => !r.json.success);
      if (bad) throw new Error(`${bad.company}: ${bad.json.error ?? t("google.budgetPacing.loadFailed")}`);

      setMbc(results.find(r => r.company === "MBC")?.json ?? null);
      setMbi(results.find(r => r.company === "MBI")?.json ?? null);
    } catch (e: any) {
      setError(e.message || t("google.budgetPacing.connError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (!sessionLoading) fetchAll(); }, [sessionLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = mbc ?? mbi;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Budget Pacing</h1>
            <p className="text-sm text-slate-500">
              {t("google.budgetPacing.subtitle")}
              {meta && t("google.budgetPacing.subtitleDay", { day: meta.dayOfMonth, days: meta.daysInMonth, pct: meta.elapsedPct })}
            </p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {t("google.budgetPacing.refresh")}
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 inline-block" />{t("google.budgetPacing.statusOnTrack")}</div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />{t("google.budgetPacing.legendSlow")}</div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-400 inline-block" />{t("google.budgetPacing.legendOver")}</div>
        <div className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-slate-400 inline-block" />{t("google.budgetPacing.legendExpected")}</div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <p className="text-xs text-red-500 mt-1">{t("google.budgetPacing.checkConn")}</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5">
          <CompanyCard data={mbc} color="bg-blue-500" />
          <CompanyCard data={mbi} color="bg-indigo-500" />
        </div>
      )}
    </div>
  );
}
