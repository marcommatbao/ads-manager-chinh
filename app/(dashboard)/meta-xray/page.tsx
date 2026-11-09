"use client";

// ============================================================
// Meta X-quang — đơn "Mua hàng" Meta báo tách theo bấm thật (7 ngày) vs chỉ
// xem (1 ngày), đối chiếu GA4, cài đặt ghi nhận, tần suất — và việc nên làm
// cho từng chiến dịch. Đọc GET /api/meta/xray (lib/meta/xray.ts + recommend.ts).
// Company (MBC/MBI) + khoảng ngày (mặc định 30 ngày) dùng chung cho toàn trang,
// theo đúng mẫu app/(dashboard)/google-search/page.tsx.
// ============================================================

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, isYmd, lastDays } from "@/lib/case/dates";
import { MetaXrayView } from "@/components/meta/MetaXrayView";
import { companyIds, orderedCompanyIds } from "@/lib/companies/registry";
import { useT } from "@/lib/i18n/client";

type Company = string;

/** Đọc `?from=&to=` từ URL ở lần render đầu (reload/back) — không hợp lệ thì về mặc định 30 ngày. */
function initialRange(sp: ReturnType<typeof useSearchParams>): DateRangeValue {
  const from = sp.get("from");
  const to = sp.get("to");
  if (isYmd(from) && isYmd(to) && from <= to) return { from, to };
  return lastDays(DEFAULT_VIEW_DAYS);
}

// useSearchParams bắt buộc Suspense boundary khi build tĩnh (xem
// node_modules/next/dist/docs/.../use-search-params.md, cùng mẫu /google-search).
export default function MetaXrayPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <MetaXrayPageInner />
    </Suspense>
  );
}

function MetaXrayPageInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [company, setCompany] = useState<Company>(() => orderedCompanyIds(["MBC"])[0] ?? "MBC") // Đợt 25: công ty theo bản cài (bản Mắt Bão y như cũ);
  const [range, setRange] = useState<DateRangeValue>(() => initialRange(searchParams));

  function handleRangeChange(next: DateRangeValue) {
    setRange(next);
    router.replace(`/meta-xray?from=${next.from}&to=${next.to}`, { scroll: false });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            {t("meta.xray.page.title")}
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            {t("meta.xray.page.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangeControl value={range} onChange={handleRangeChange} maxDays={MAX_RANGE_DAYS} />
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {companyIds().map((v) => (
              <button key={v} onClick={() => setCompany(v)}
                className={cn("px-3 py-1.5 text-xs font-semibold transition-colors",
                  company === v ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <MetaXrayView company={company} range={range} />
    </div>
  );
}
