"use client";

import React, { useState, useEffect } from "react";
import { resolveCompanyScope } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/SessionProvider";
import { useT } from "@/lib/i18n/client";

import { useIntlLocale } from "@/lib/i18n/client";

export interface BudgetPacing {
  id: string; name: string; scope: string; currency: string; timeZone: string;
  members: { id: string; name: string; status: string }[];
  spent: number; completedSpend: number; dailyBudget: number; monthlyReference: number;
  projectedSpend: number | null; forecastAllowed: boolean;
  status: "ready" | "partial_coverage" | "insufficient_days";
  forecastQuality: { observedDays: number; minDaysRequired: number };
}
export interface ApiResponse {
  success: boolean; company: string; accountId: string; currency: string; timeZone: string;
  budgets: BudgetPacing[]; dayOfMonth: number; daysInMonth: number; elapsedPct: number;
  readAt: string;
  sourceRanges: { actual: { from: string; to: string }; runrate: { from: string; to: string } };
  error?: string;
}

export function CompanyCard({ data, color }: { data: ApiResponse | null; color: string }) {
  const t = useT();
  const locale = useIntlLocale();
  if (!data) return null;
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: data.currency, maximumFractionDigits: 6 }).format(value);
  return <Card className="flex-1 rounded-xl border border-slate-200 bg-white shadow-sm min-w-0">
    <CardHeader>
      <div className="flex items-center gap-2"><span className={cn("h-3 w-3 rounded-full", color)} /><CardTitle>{data.company}</CardTitle></div>
      <CardDescription>{data.accountId} · {data.currency} · {data.timeZone}</CardDescription>
      <p className="text-xs text-slate-500">{t("google.budgetPacing.p6.actual")} {data.sourceRanges.actual.from} – {data.sourceRanges.actual.to} · {t("google.budgetPacing.p6.partialToday")}</p>
      <p className="text-xs text-slate-500">{t("google.budgetPacing.p6.runrate")} {data.sourceRanges.runrate.from} – {data.sourceRanges.runrate.to}</p>
      <p className="text-xs text-slate-500">Google Ads · {data.readAt}</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs text-slate-500">{t("google.budgetPacing.p6.disclaimer")}</p>
      {data.budgets.length === 0 && <p>{t("google.budgetPacing.noCampaigns")}</p>}
      {data.budgets.map(b => <section key={b.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-0" aria-label={b.name}>
        <h2 className="text-sm font-semibold text-slate-800">{b.name} · {t(b.scope === "shared_budget" ? "google.budgetPacing.p6.shared" : "google.budgetPacing.p6.single")}</h2>
        <p className="break-all text-xs text-slate-500">{b.id}</p>
        <ul className="text-xs text-slate-600">{b.members.map(m => <li key={m.id}>{m.name} ({m.id} · {m.status})</li>)}</ul>
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-slate-500">{t("google.budgetPacing.p6.actual")}</dt><dd>{money(b.spent)}</dd></div>
          <div><dt className="text-slate-500">{t("google.budgetPacing.p6.completed")}</dt><dd>{money(b.completedSpend)}</dd></div>
          <div><dt className="text-slate-500">{t("google.budgetPacing.p6.daily")}</dt><dd>{money(b.dailyBudget)}</dd></div>
          <div><dt className="text-slate-500">{t("google.budgetPacing.p6.reference")}</dt><dd>{money(b.monthlyReference)}</dd></div>
          <div><dt className="text-slate-500">{t("google.budgetPacing.p6.forecast")}</dt><dd>{b.projectedSpend === null ? "—" : money(b.projectedSpend)}</dd></div>
        </dl>
        <p className={cn("text-xs", b.forecastAllowed ? "text-slate-500" : "text-amber-700")}>
          {t(`google.budgetPacing.p6.${b.status}`)} · {t("google.budgetPacing.p6.sample", { n: b.forecastQuality.observedDays, min: b.forecastQuality.minDaysRequired })}
        </p>
      </section>)}
    </CardContent>
  </Card>;
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("google.budgetPacing.connError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sessionLoading) return;
    const timer = setTimeout(() => { void fetchAll(); }, 0);
    return () => clearTimeout(timer);
  }, [sessionLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps


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
              {t("google.budgetPacing.p6.subtitle")}
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
