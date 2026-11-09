"use client";

// ============================================================
// Creative theo đơn thật (Đợt 17) — xếp mẫu quảng cáo Meta theo nguồn gần đơn thật nhất đang có
// (đơn đã thu tiền Odoo → Meta · GA4 theo mã quảng cáo · mua hàng từ lượt bấm), không theo số Meta báo mặc định.
// Đọc GET /api/meta/creative-truth (lib/meta/creative-truth.ts). Cùng khuôn trang /meta-xray.
// ============================================================

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangeControl, type DateRangeValue } from "@/components/DateRangeControl";
import { DEFAULT_VIEW_DAYS, MAX_RANGE_DAYS, isYmd, lastDays } from "@/lib/case/dates";
import { CreativeTruthView } from "@/components/meta/CreativeTruthView";
import { companyIds } from "@/lib/companies/registry";
import { useT } from "@/lib/i18n/client";

type Company = string;

function initialRange(sp: ReturnType<typeof useSearchParams>): DateRangeValue {
  const from = sp.get("from");
  const to = sp.get("to");
  if (isYmd(from) && isYmd(to) && from <= to) return { from, to };
  return lastDays(DEFAULT_VIEW_DAYS);
}

export default function CreativeTruthPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <CreativeTruthPageInner />
    </Suspense>
  );
}

function CreativeTruthPageInner() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [company, setCompany] = useState<Company>(searchParams.get("company") === "MBI" ? "MBI" : "MBC");
  const [range, setRange] = useState<DateRangeValue>(() => initialRange(searchParams));

  function handleRangeChange(next: DateRangeValue) {
    setRange(next);
    router.replace(`/creative-don-that?company=${company}&from=${next.from}&to=${next.to}`, { scroll: false });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("meta.truth.page.title")}</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            {t("meta.truth.page.subtitle")}
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

      <CreativeTruthView company={company} range={range} />
    </div>
  );
}
