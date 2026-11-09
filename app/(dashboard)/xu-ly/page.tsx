"use client";

// ============================================================
// Tổng quan "Xử lý chiến dịch" — chiến dịch nào đang tiêu vượt mục tiêu,
// xếp theo số tiền chi vượt trần (API đã sắp; trang chỉ hiển thị).
// ============================================================

import { Suspense, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/components/SessionProvider";
import { resolveCompanyScope } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/case/StatusPill";
import { vnd, num, roas as fmtRoas } from "@/components/case/format";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { metaObjectiveLabel } from "@/components/case/meta-copy";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, MIN_CASE_DAYS, isYmd, lastDays, rangeDays } from "@/lib/case/dates";
import type { Company } from "@/lib/case/types";
import type { OverviewRow, Platform } from "@/lib/case/service";
import { orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import { useT, useIntlLocale } from "@/lib/i18n/client";

/** Đọc `?from=&to=` từ URL ở LẦN RENDER ĐẦU (reload/back) — không hợp lệ thì về mặc định 30 ngày. */
function initialRange(sp: ReturnType<typeof useSearchParams>): DateRangeValue {
  const from = sp.get("from");
  const to = sp.get("to");
  if (isYmd(from) && isYmd(to) && from <= to) return { from, to };
  return lastDays(DEFAULT_VIEW_DAYS);
}

export default function XuLyOverviewPage() {
  // useSearchParams bắt buộc Suspense boundary khi build tĩnh (xem
  // node_modules/next/dist/docs/.../use-search-params.md) — bọc ở default export.
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl p-6"><OverviewSkeleton /></div>}>
      <XuLyOverviewPageInner />
    </Suspense>
  );
}

// Chuỗi từ điển có <b>…</b> → in đậm (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function rich(s: string): React.ReactNode[] {
  return s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

function XuLyOverviewPageInner() {
  const intl = useIntlLocale();
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const allowedCompanies = resolveCompanyScope(user?.companies, user?.role);
  const [company, setCompany] = useState<Company>(() => orderedCompanyIds(["MBI"])[0] ?? "MBI"); // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ)
  const [channel, setChannel] = useState<Platform>("google");
  const [range, setRange] = useState<DateRangeValue>(() => initialRange(searchParams));
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<Record<string, string>>({});

  const effectiveCompany = allowedCompanies.includes(company) ? company : allowedCompanies[0];
  const channelLabel = channel === "facebook" ? "Meta" : "Google Ads";
  const rangeTooShortForCase = rangeDays(range) < MIN_CASE_DAYS;

  function handleRangeChange(next: DateRangeValue) {
    setRange(next);
    router.replace(`/xu-ly?from=${next.from}&to=${next.to}`, { scroll: false });
  }

  const { data, error, isLoading, mutate } = useSWR<{
    success: true; company: Company; range: { from: string; to: string };
    rows: OverviewRow[]; totals: { cost: number; orders: number; leads?: number; orderValue: number; overCeiling: number; redCount: number };
  }>(
    effectiveCompany ? `/api/cases/overview?company=${effectiveCompany}&from=${range.from}&to=${range.to}&platform=${channel}` : null,
    getJson,
  );

  const rows = data?.rows ?? [];
  const showRoas = rows.filter((r) => r.target?.basis === "roas").length > rows.filter((r) => r.target?.basis === "cpa").length;

  async function openCase(row: OverviewRow) {
    if (rangeTooShortForCase) {
      setOpenErr((prev) => ({ ...prev, [row.campaignId]: t("overview.xuly.list.rangeShortErr", { days: MIN_CASE_DAYS }) }));
      return;
    }
    setOpeningId(row.campaignId);
    setOpenErr((prev) => { const n = { ...prev }; delete n[row.campaignId]; return n; });
    try {
      const json = await postJson("/api/cases", { company: effectiveCompany, campaignId: row.campaignId, platform: channel, from: range.from, to: range.to });
      router.push(`/xu-ly/${json.case.id}`);
    } catch (e) {
      setOpenErr((prev) => ({ ...prev, [row.campaignId]: e instanceof ApiError ? e.message : t("overview.xuly.list.openFailed") }));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Stethoscope className="h-5 w-5 text-blue-600" aria-hidden="true" /> {t("overview.xuly.list.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {t("overview.xuly.list.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeControl value={range} onChange={handleRangeChange} maxDays={MAX_RANGE_DAYS} />
          <Button className="h-10" variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} aria-hidden="true" /> {t("overview.xuly.list.reload")}
          </Button>
        </div>
      </div>

      {rangeTooShortForCase && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          {t("overview.xuly.list.rangeShortWarn", { current: rangeDays(range), min: MIN_CASE_DAYS })}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.list.channel")}</div>
          <div role="tablist" aria-label={t("overview.xuly.list.channel")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              role="tab"
              aria-selected={channel === "google"}
              onClick={() => setChannel("google")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                channel === "google" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              Google Ads
            </button>
            <button
              role="tab"
              aria-selected={channel === "facebook"}
              onClick={() => setChannel("facebook")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                channel === "facebook" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              Facebook
            </button>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("overview.xuly.list.company")}</div>
          <div role="tablist" aria-label={t("overview.xuly.list.company")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(orderedCompanyIds(["MBI", "MBC"]) as Company[]).map((v) => {
              const allowed = allowedCompanies.includes(v);
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={effectiveCompany === v}
                  disabled={!allowed}
                  onClick={() => setCompany(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                    effectiveCompany === v ? "bg-blue-600 text-white" : allowed ? "text-slate-600 hover:bg-slate-50" : "cursor-not-allowed text-slate-300",
                  )}
                >
                  {v === "MBC" || v === "MBI" ? v : companyLabel(v)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {allowedCompanies.length === 0 && (
        <EmptyState icon={AlertTriangle} title={t("overview.xuly.list.noCompanyTitle")} description={t("overview.xuly.list.noCompanyDesc")} />
      )}

      {allowedCompanies.length > 0 && isLoading && <OverviewSkeleton />}

      {allowedCompanies.length > 0 && !isLoading && error && (
        <EmptyState
          icon={AlertTriangle}
          title={t("overview.xuly.list.readFailed", { channel: channelLabel })}
          description={error instanceof ApiError ? error.message : t("overview.xuly.list.loadError")}
          action={<Button className="h-10" onClick={() => mutate()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("overview.xuly.list.retry")}</Button>}
        />
      )}

      {allowedCompanies.length > 0 && !isLoading && !error && data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={t("overview.xuly.list.kpiSpend")} value={vnd(data.totals.cost, intl)} sub={t("overview.xuly.list.kpiSpendSub", { n: rows.length })} />
            <Kpi label={t("overview.xuly.list.kpiPurchases")} value={num(data.totals.orders, undefined, intl)} sub={data.totals.leads ? t("overview.xuly.list.kpiPurchasesSubLeads", { leads: num(data.totals.leads, undefined, intl) }) : t("overview.xuly.list.kpiPurchasesSub")} />
            {showRoas ? (
              <Kpi label={t("overview.xuly.list.kpiRoas")} value={data.totals.cost > 0 ? fmtRoas(data.totals.orderValue / data.totals.cost, intl) : "—"} sub={t("overview.xuly.list.kpiRoasSub", { value: vnd(data.totals.orderValue, intl) })} />
            ) : (
              <Kpi label={t("overview.xuly.list.kpiCpo")} value={data.totals.orders > 0 ? vnd(data.totals.cost / data.totals.orders, intl) : "—"} bad={data.totals.orders === 0 && data.totals.cost > 0} />
            )}
            <Kpi label={t("overview.xuly.list.kpiOver")} value={vnd(data.totals.overCeiling, intl)} sub={t("overview.xuly.list.kpiOverSub", { n: data.totals.redCount })} bad={data.totals.overCeiling > 0} />
          </div>

          {channel === "facebook" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
              {t("overview.xuly.list.metaNote")}
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState title={t("overview.xuly.list.emptyTitle")} description={t("overview.xuly.list.emptyDesc", { channel: channelLabel })} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2.5 font-medium">{t("overview.xuly.list.thCampaign")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("overview.xuly.list.thSpend")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("overview.xuly.list.thClicks")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("overview.xuly.list.thOrders")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("overview.xuly.list.kpiCpo")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                    <th className="px-3 py-2.5 text-right font-medium">{t("overview.xuly.list.kpiOver")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("overview.xuly.list.thStatus")}</th>
                    <th className="px-3 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.campaignId} className="border-b border-slate-50 last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-800">{r.name}</div>
                        <div className="text-xs text-slate-400">{channel === "facebook" ? metaObjectiveLabel(r.channel, t) : r.channel} · {r.groupLabel}{r.status === "PAUSED" && <span className="font-semibold text-slate-600"> · {t("overview.xuly.list.paused")}</span>}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{vnd(r.perf.cost, intl)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(r.perf.clicks, undefined, intl)}</td>
                      {/* Đợt 23 (3d): chiến dịch thu lead (Google + Meta) — cột này là số LEAD, chấm theo chi phí mỗi lead; không có ROAS. */}
                      <td className="px-3 py-2.5 text-right tabular-nums">{num(r.perf.orders, undefined, intl)}{r.goalKind === "leads" && <span className="ml-1 text-xs font-normal text-slate-400">{t("overview.xuly.list.lead")}</span>}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", r.verdict.status === "red" && "font-semibold text-red-600")}>
                        {r.verdict.cpa !== null ? vnd(r.verdict.cpa, intl) : "—"}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", r.verdict.status === "red" && "font-semibold text-red-600")}>
                        {r.verdict.roas !== null && r.goalKind !== "leads" ? fmtRoas(r.verdict.roas, intl) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-red-600">
                        {r.verdict.overCeiling !== null ? vnd(r.verdict.overCeiling, intl) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill status={r.verdict.status} label={r.verdict.label} />
                        {r.verdict.flags.map((f, i) => (
                          <div key={i} className="mt-1 text-xs text-amber-600">⚠ {f}</div>
                        ))}
                      </td>
                      <td className="px-3 py-2.5">
                        <RowAction
                          row={r}
                          platform={channel}
                          busy={openingId === r.campaignId}
                          rangeTooShort={rangeTooShortForCase}
                          onOpen={() => openCase(r)}
                        />
                        {openErr[r.campaignId] && <div className="mt-1 max-w-[180px] text-xs text-red-600">{openErr[r.campaignId]}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            {rich(t("overview.xuly.list.rankNote"))}
          </div>
        </>
      )}
    </div>
  );
}

function RowAction({ row, platform, busy, rangeTooShort, onOpen }: { row: OverviewRow; platform: Platform; busy: boolean; rangeTooShort: boolean; onOpen: () => void }) {
  const t = useT();
  if (row.latestCase) {
    return (
      <Button className="h-10" size="sm" variant="outline" render={<Link href={`/xu-ly/${row.latestCase.id}`} />}>
        {t("overview.xuly.list.viewCase")}
      </Button>
    );
  }
  if (row.verdict.status === "no_target") {
    return (
      <Button className="h-10" size="sm" variant="outline" render={<Link href="/xu-ly/muc-tieu" />}>
        {t("overview.xuly.list.setGoal")}
      </Button>
    );
  }
  if (row.canOpenCase) {
    return (
      <Button
        className="h-10"
        size="sm"
        onClick={onOpen}
        disabled={busy || rangeTooShort}
        title={rangeTooShort ? t("overview.xuly.list.rangeShortTitle", { days: MIN_CASE_DAYS }) : undefined}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("overview.xuly.list.openCase")}
      </Button>
    );
  }
  return <span className="text-xs text-slate-400">{platform === "facebook" ? t("overview.xuly.list.unsupportedGoal") : t("overview.xuly.list.pmaxPhase2")}</span>;
}

function Kpi({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", bad ? "text-red-600" : "text-slate-900")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
