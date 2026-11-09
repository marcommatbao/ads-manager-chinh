"use client";

import { useState, useEffect } from "react";
import { useAdsStore } from "@/store/useAdsStore";
import { hasModule } from "@/lib/companies/registry";
import { useIntlLocale, useT } from "@/lib/i18n/client";

// ── Types ──
interface UnifiedSummary {
  total: {
    spend: number;
    leads: number;
    clicks: number;
    cpl: number;
    declaredValue: number;
  };
  facebook: {
    spend: number;
    leads: number;
    clicks: number;
    cpl: number;
    budgetPct: number;
    leadsBasis?: string;
    declaredValue: number;
  };
  google: {
    spend: number;
    leads: number;
    clicks: number;
    cpl: number;
    budgetPct: number;
    leadsBasis?: string;
    declaredValue: number;
  };
  insight: {
    betterChannel: "FACEBOOK" | "GOOGLE" | null;
    cplDiffPct: number;
    shouldRebalance: boolean;
    recommendation: string;
    /** false = the two channels are not counting the same event type. */
    comparable?: boolean;
  };
  /** Doanh thu MBC / đơn hàng MBI THẬT (Odoo, cùng nguồn card "Hiệu quả chi
   *  phí theo công ty") — LUÔN có giá trị, không phụ vào bộ lọc company đang
   *  chọn: đây là sự thật cố định của từng công ty (MBC đo doanh thu, MBI đo
   *  đơn hàng), không phải số bị lọc theo phạm vi đang xem. Khác hẳn
   *  declaredValue ở trên (Meta/Google tự khai). */
  mbcRevenue: { value: number | null; error: string | null };
  mbiOrders: { value: number | null; error: string | null };
}

// ── Helpers ──
function formatMoneyWith(n: number, loc: string): string {
  return new Intl.NumberFormat(loc).format(Math.round(n));
}

function formatRoas(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}x`;
}

// ── Main Component ──
export default function UnifiedOverview() {
  const t = useT();
  const loc = useIntlLocale();
  const formatMoney = (n: number) => formatMoneyWith(n, loc);
  const company = useAdsStore((s) => s.selectedCompany); // "all" | string
  const dateRange = useAdsStore((s) => s.dateRange);      // { from, to }
  const [data, setData] = useState<UnifiedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [ggError, setGgError] = useState(false);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, dateRange.from, dateRange.to]);

  async function fetchData() {
    setLoading(true);
    setGgError(false);
    try {
      // Map store "all" → API "ALL"
      const apiCompany = company === "all" ? "ALL" : company;
      // Pass from/to from the dashboard's date picker
      const res = await fetch(
        `/api/dashboard/unified?company=${apiCompany}&from=${dateRange.from}&to=${dateRange.to}`
      );
      const json = await res.json();
      if (json.success) {
        setData(json.summary);
        // Kiểm tra nếu Google trả lỗi
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (json.breakdown?.some((b: any) => b.gg?.error)) {
          setGgError(true);
        }
      }
    } catch {
      setGgError(true);
    } finally {
      setLoading(false);
    }
  }

  // ── Skeleton Loading ──
  if (loading) {
    return (
      <div className="w-full rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
        <div className="mt-4 h-32 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (!data) return null;

  const { total, facebook, google, mbcRevenue, mbiOrders } = data;

  // total.spend chỉ ĐÚNG LÀ chi phí MBC khi bộ lọc trên đang chọn "MBC" —
  // route.ts chỉ scope theo company trong nhánh đó. mbcRevenue giờ LUÔN có
  // giá trị (không phụ bộ lọc), nên phải tự chặn ở đây: "Tất cả"/"MBI" thì
  // total.spend là chi phí sai công ty, không được lấy làm mẫu số ROAS.
  const mbcRoas = company === "MBC" && mbcRevenue.value !== null && total.spend > 0
    ? mbcRevenue.value / total.spend
    : null;

  return (
    <div className="w-full space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          {t("overview.unified.title")}
        </h2>
        <p className="text-xs text-slate-400">
          {dateRange.from} → {dateRange.to}
        </p>
      </div>

      {/* ── Google Error Banner ── */}
      {ggError && (
        <div className="flex items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <span className="text-sm text-yellow-800">
            {t("overview.unified.googleError")}
          </span>
          <button
            onClick={fetchData}
            className="rounded-lg bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-800 hover:bg-yellow-200"
          >
            {t("overview.unified.retry")}
          </button>
        </div>
      )}

      {/* ── 3 Metric Cards ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Total Spend */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t("overview.unified.totalSpend")}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            ₫{formatMoney(total.spend)}
          </p>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                Facebook
              </span>
              <span className="font-medium">
                ₫{formatMoney(facebook.spend)}
                <span className="ml-1 text-xs text-gray-400">
                  ({facebook.budgetPct}%)
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                Google
              </span>
              <span className="font-medium">
                ₫{formatMoney(google.spend)}
                <span className="ml-1 text-xs text-gray-400">
                  ({google.budgetPct}%)
                </span>
              </span>
            </div>
          </div>
          {/* Budget Allocation Bar */}
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="bg-blue-500 transition-all duration-500"
              style={{ width: `${facebook.budgetPct}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${google.budgetPct}%` }}
            />
          </div>
        </div>

        {/* Đợt 22: hai ô Odoo của Mắt Bão (đơn MBI / doanh thu MBC) chỉ ở bản cài có gói matbao — bản khách từng thấy
            "Doanh thu MBC (thật)" + lỗi MATBAO_REPORT_API. Bản Mắt Bão: y nguyên. */}
        {hasModule("matbao") && (<>
        {/* Đơn hàng MBI (thật) — LUÔN hiện, không phụ bộ lọc company ở trên:
            MBI đo hiệu quả bằng đơn hàng (không có doanh thu để đo), nên đây
            là sự thật cố định của MBI chứ không phải số bị lọc theo phạm vi. */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t("overview.unified.mbiOrders.title")}</p>
          {mbiOrders.error ? (
            <>
              <p className="mt-1 text-2xl font-bold text-gray-300">—</p>
              <p className="mt-3 text-[11px] leading-snug text-amber-700">
                {t("overview.unified.mbiOrders.error", { error: mbiOrders.error })}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {t("overview.unified.mbiOrders.value", { n: formatMoney(mbiOrders.value ?? 0) })}
              </p>
              <p className="mt-3 text-[11px] leading-snug text-gray-400">
                {t("overview.unified.mbiOrders.note")}
              </p>
            </>
          )}
        </div>

        {/* Doanh thu MBC (thật) / ROAS — đơn hàng Odoo, KHÔNG phải số Meta/Google
            tự khai. LUÔN hiện cùng lý do như ô Đơn hàng MBI ở trên; ROAS chỉ
            tính được khi bộ lọc company đang chọn đúng "MBC" (xem mbcRoas). */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t("overview.unified.mbcRevenue.title")}</p>
          {mbcRevenue.error ? (
            <>
              <p className="mt-1 text-2xl font-bold text-gray-300">—</p>
              <p className="mt-3 text-[11px] leading-snug text-amber-700">
                {t("overview.unified.mbcRevenue.error", { error: mbcRevenue.error })}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                ₫{formatMoney(mbcRevenue.value ?? 0)}
                {mbcRoas !== null && (
                  <span className="ml-1.5 text-sm font-medium text-gray-400">
                    (ROAS {formatRoas(mbcRoas)})
                  </span>
                )}
              </p>
              <p className="mt-3 text-[11px] leading-snug text-gray-400">
                {mbcRoas !== null
                  ? t("overview.unified.mbcRevenue.noteRoas")
                  : t("overview.unified.mbcRevenue.noteNoRoas")}
              </p>
            </>
          )}
        </div>
        </>)}
      </div>

    </div>
  );
}
