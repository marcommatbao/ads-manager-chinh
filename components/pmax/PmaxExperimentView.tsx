"use client";

// ============================================================
// PMax "🧪 Thí nghiệm" (Đợt 10c) — nội dung tab `experiment` trong
// /google-pmax, deep link `?tab=experiment` (mirror tab "🩻 X-quang", xem
// PmaxXrayView.tsx — cùng nhận `company` từ toggle MBC/MBI ở page.tsx).
// ------------------------------------------------------------
// 5 mảnh, mỗi mảnh 1 file riêng để dễ đọc:
//   ExperimentPanel   — C4: thí nghiệm loại trừ vùng (tự tải, tài nguyên riêng)
//   BeforeAfterPanel  — C1: trước/sau khi đổi cửa sổ engaged-view
//   LearningPanel     — D2: ngưỡng học Smart Bidding (chỉ đọc)
//   NewCustomerPanel  — C2: mục tiêu khách mới
//   LeadQualityPanel  — C3: chất lượng lead (tự tải, tài nguyên riêng)
// C1/D2/C2 dùng CHUNG một lần gọi GET /api/google/pmax/signals (route trả cả
// ba trong một response, xem lib/pmax/signals.ts) — tải MỘT LẦN ở đây rồi
// truyền props xuống, tránh 3 panel cùng gọi trùng một endpoint. C4 và C3 là
// tài nguyên độc lập (Google Ads mutate + lead events riêng) nên tự tải/tự
// làm mới, không phụ thuộc vòng đời của nhóm C1/D2/C2.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { getJson, ApiError } from "@/components/case/api";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { ExperimentPanel } from "./ExperimentPanel";
import { BeforeAfterPanel } from "./BeforeAfterPanel";
import { LearningPanel } from "./LearningPanel";
import { NewCustomerPanel } from "./NewCustomerPanel";
import { LeadQualityPanel } from "./LeadQualityPanel";
import type { ChangeMark, LearningCheck, NewCustomerChange, NewCustomerView } from "@/lib/pmax/signals";
import { hasModule } from "@/lib/companies/registry";

type Company = string;

interface SignalsResponse {
  learning: { checks: LearningCheck[]; merge: { ids: string[]; names: string[]; conv: number; text: string } | null };
  newCustomer: NewCustomerView;
  modeLabels: Record<string, string>;
  newCustomerHistory: NewCustomerChange[];
  marks: ChangeMark[];
  canEdit: boolean;
  confirmText: string;
}

export function PmaxExperimentView({ company }: { company: Company }) {
  const t = useT();
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/google/pmax/signals?company=${company}`);
      setData(json as SignalsResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.pmaxExpView.connErr"));
    } finally {
      setLoading(false); setReloading(false);
    }
  }, [company, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-8">
      <ExperimentPanel company={company} />

      <div className="space-y-8 border-t border-slate-100 pt-8">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={() => load(true)} disabled={loading || reloading}>
            {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxExpView.reload")}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : !data ? null : (
          <>
            <BeforeAfterPanel company={company} marks={data.marks} canEdit={data.canEdit} onChanged={() => load(true)} />
            <div className="border-t border-slate-100 pt-8">
              <LearningPanel data={data.learning} />
            </div>
            <div className="border-t border-slate-100 pt-8">
              <NewCustomerPanel
                company={company}
                data={data.newCustomer}
                modeLabels={data.modeLabels}
                history={data.newCustomerHistory}
                canEdit={data.canEdit}
                confirmText={data.confirmText}
                onChanged={() => load(true)}
              />
            </div>
          </>
        )}
      </div>

      <div className="border-t border-slate-100 pt-8">
        {hasModule("orders") && <LeadQualityPanel company={company} />}
      </div>
    </div>
  );
}
