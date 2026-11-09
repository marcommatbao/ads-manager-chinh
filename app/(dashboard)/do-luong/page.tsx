"use client";

// ============================================================
// Sức khoẻ đo lường — Đợt 4 · A
// ------------------------------------------------------------
// Trước khi đọc chi phí/đơn ở bất kỳ chiến dịch nào, kiểm pixel/sự kiện
// chuyển đổi có đang bắn đúng không. Trang chỉ điều phối: fetch + tabs +
// loading/empty/error; nội dung theo kênh nằm ở components/measure/*.
// ============================================================

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { AlertTriangle, HeartPulse, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/components/SessionProvider";
import { resolveCompanyScope } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { getJson, ApiError } from "@/components/case/api";
import { FacebookHealthView } from "@/components/measure/FacebookHealthView";
import { GoogleHealthView } from "@/components/measure/GoogleHealthView";
import { TagDoctorView } from "@/components/measure/TagDoctorView";
import { RealOrdersView } from "@/components/measure/RealOrdersView";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, isYmd, lastDays, rangeDays } from "@/lib/case/dates";
import type { Company } from "@/lib/case/types";
import type { MetaHealth } from "@/lib/measure/meta-health";
import type { GoogleHealth } from "@/lib/measure/google-health";
import { hasModule, orderedCompanyIds, companyLabel } from "@/lib/companies/registry";
import { isCompany } from "@/lib/companies/registry";

type Platform = "facebook" | "google" | "tags" | "orders";
type HealthResponse =
  | ({ success: true; platform: "facebook" } & MetaHealth)
  | ({ success: true; platform: "google" } & GoogleHealth);

/** Thông điệp thân thiện khi Meta/Google chặn vì vượt hạn mức gọi API (#613…). */
function quotaHint(message: string, t: TFunction): string | null {
  return /hạn mức|quota|rate limit|#613/i.test(message) ? t("meta.measure.td.quota") : null;
}

/**
 * Đọc `?tab=facebook|google|tags` và `?company=MBI|MBC` từ URL ở LẦN RENDER ĐẦU
 * (deep link từ tab "Tình trạng & cảnh báo") — sau đó người dùng tự đổi bằng
 * tab trên trang, không đồng bộ ngược lại URL. Khoảng ngày (`?from=&to=`) thì
 * NGƯỢC LẠI — mỗi lần đổi range đều ghi lại URL (đủ cả tab/company) để reload
 * hay quay lại không mất lựa chọn.
 */
function initialPlatform(sp: ReturnType<typeof useSearchParams>): Platform {
  const t = sp.get("tab");
  return t === "google" || t === "tags" || t === "facebook" || (t === "orders" && hasModule("orders")) ? t : "facebook";
}
function initialCompany(sp: ReturnType<typeof useSearchParams>): Company | null {
  const c = sp.get("company");
  return isCompany(c) ? c : null;
}
function initialRange(sp: ReturnType<typeof useSearchParams>): DateRangeValue {
  const from = sp.get("from");
  const to = sp.get("to");
  if (isYmd(from) && isYmd(to) && from <= to) return { from, to };
  return lastDays(DEFAULT_VIEW_DAYS);
}

export default function DoLuongPage() {
  // useSearchParams bắt buộc Suspense boundary khi build tĩnh (xem
  // node_modules/next/dist/docs/.../use-search-params.md) — bọc ở default export.
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl p-6"><HealthSkeletonFallback /></div>}>
      <DoLuongPageInner />
    </Suspense>
  );
}

function HealthSkeletonFallback() {
  return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;
}

function DoLuongPageInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const allowedCompanies = resolveCompanyScope(user?.companies, user?.role);
  const [platform, setPlatform] = useState<Platform>(() => initialPlatform(searchParams));
  const [company, setCompany] = useState<Company>(() => initialCompany(searchParams) ?? (orderedCompanyIds(["MBI"])[0] ?? "MBI")) // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [range, setRange] = useState<DateRangeValue>(() => initialRange(searchParams));
  const [pullError, setPullError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const effectiveCompany = allowedCompanies.includes(company) ? company : allowedCompanies[0];
  const isHealth = platform === "facebook" || platform === "google";
  const baseUrl = effectiveCompany && isHealth
    ? `/api/measure/health?platform=${platform}&company=${effectiveCompany}&from=${range.from}&to=${range.to}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<HealthResponse>(baseUrl, getJson);

  function handleRangeChange(next: DateRangeValue) {
    setRange(next);
    const params = new URLSearchParams();
    params.set("tab", platform);
    if (effectiveCompany) params.set("company", effectiveCompany);
    params.set("from", next.from);
    params.set("to", next.to);
    router.replace(`/do-luong?${params.toString()}`, { scroll: false });
  }

  // Đổi kênh/công ty là một câu hỏi khác — lỗi "Kéo lại" của lượt trước không
  // còn nghĩa gì, xoá đi để không che nhầm màn dữ liệu mới.
  useEffect(() => setPullError(null), [baseUrl]);

  async function pullAgain() {
    if (!baseUrl) return;
    setPulling(true);
    try {
      const json = await getJson(`${baseUrl}&force=1`);
      setPullError(null);
      await mutate(json, { revalidate: false });
    } catch (e) {
      // "Kéo lại" hỏng thì KHÔNG giữ số cũ trên màn — chuyển hẳn sang trạng
      // thái lỗi để không ai đọc nhầm số đã lỗi thời là số mới.
      setPullError(e instanceof ApiError ? e.message : t("meta.measure.pg.pullFail"));
    } finally {
      setPulling(false);
    }
  }

  const effectiveErrorMessage = pullError ?? (error instanceof ApiError ? error.message : error ? t("meta.measure.pg.loadFail") : null);
  const channelLabel = platform === "facebook" ? "Meta" : "Google Ads";
  const isEmpty =
    !!data &&
    (data.platform === "facebook" ? data.pixels.length === 0 && data.products.length === 0 : data.conversions.length === 0);
  // Payload trả `range` thật (có thể khác yêu cầu nếu server chỉnh) — chỉ dùng `range`
  // (state đang chọn) khi CHƯA có payload (đang tải/lỗi).
  const effectiveRangeDays = rangeDays(data?.range ?? range);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <HeartPulse className="h-5 w-5 text-blue-600" aria-hidden="true" /> {platform === "tags" ? t("meta.measure.td.title") : platform === "orders" ? t("meta.measure.pg.title.orders") : t("meta.measure.pg.title.health")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {platform === "orders"
              ? t("meta.measure.pg.sub.orders")
              : platform === "tags"
              ? t("meta.measure.td.subtitle")
              : t("meta.measure.pg.sub.health")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {platform !== "orders" && <DateRangeControl value={range} onChange={handleRangeChange} maxDays={MAX_RANGE_DAYS} />}
          {isHealth && (
            <Button className="h-10" variant="outline" size="sm" onClick={pullAgain} disabled={pulling || !baseUrl}>
              {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              {t("meta.measure.td.refresh")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.measure.pg.channel")}</div>
          <div role="tablist" aria-label={t("meta.measure.pg.channel")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {([
              { value: "facebook", label: "Facebook" },
              { value: "google", label: "Google Ads" },
              { value: "tags", label: t("meta.measure.td.title") },
              { value: "orders", label: t("meta.measure.pg.tab.orders") },
            ] as const).filter((p) => p.value !== "orders" || hasModule("orders")).map((p) => (
              <button
                key={p.value}
                role="tab"
                aria-selected={platform === p.value}
                onClick={() => setPlatform(p.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  platform === p.value ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">{t("meta.measure.pg.company")}</div>
          <div role="tablist" aria-label={t("meta.measure.pg.company")} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
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
        <EmptyState icon={AlertTriangle} title={t("meta.measure.pg.noCompany")} description={t("meta.measure.pg.noCompanyDesc")} />
      )}

      {allowedCompanies.length > 0 && platform === "tags" && effectiveCompany && (
        <TagDoctorView company={effectiveCompany} range={range} />
      )}

      {allowedCompanies.length > 0 && platform === "orders" && effectiveCompany && <RealOrdersView company={effectiveCompany} />}

      {allowedCompanies.length > 0 && isHealth && isLoading && <HealthSkeleton />}

      {allowedCompanies.length > 0 && isHealth && !isLoading && effectiveErrorMessage && (
        <EmptyState
          icon={AlertTriangle}
          title={effectiveErrorMessage}
          description={quotaHint(effectiveErrorMessage, t) ?? t("meta.measure.td.staleNote")}
          action={<Button className="h-10" onClick={pullAgain} disabled={pulling}>{pulling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} {t("meta.measure.td.retry")}</Button>}
        />
      )}

      {allowedCompanies.length > 0 && isHealth && !isLoading && !effectiveErrorMessage && data && isEmpty && (
        <EmptyState
          title={t("meta.measure.pg.empty.title", { what: platform === "facebook" ? t("meta.measure.pg.empty.pixel") : t("meta.measure.pg.empty.conv"), days: effectiveRangeDays })}
          description={
            platform === "facebook"
              ? t("meta.measure.pg.empty.descFb")
              : t("meta.measure.pg.empty.descGoogle")
          }
          action={<Button className="h-10" onClick={pullAgain} disabled={pulling}><RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("meta.measure.td.refresh")}</Button>}
        />
      )}

      {allowedCompanies.length > 0 && isHealth && !isLoading && !effectiveErrorMessage && data && !isEmpty && (
        data.platform === "facebook" ? <FacebookHealthView data={data} /> : <GoogleHealthView data={data} />
      )}

      {allowedCompanies.length > 0 && isHealth && !isLoading && !effectiveErrorMessage && !data && (
        <div className="text-sm text-slate-400">{t("meta.measure.pg.noData", { channel: channelLabel })}</div>
      )}
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}
