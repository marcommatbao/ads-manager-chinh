"use client";

// ============================================================
// Phiên xử lý 1 chiến dịch — 7 bước, từ phân tích tới đo lại hiệu quả.
// ------------------------------------------------------------
// Trang chỉ điều phối: đọc phiên, đổi bước, và render đúng component bước
// hiện tại. Nghiệp vụ (nguyên nhân, mô phỏng, ghi lên Google…) đều ở
// lib/case/** phía server — trang này không tự tính lại gì.
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { CaseHeader } from "@/components/case/CaseHeader";
import { StepStepper } from "@/components/case/StepStepper";
import { Step1Analysis } from "@/components/case/Step1Analysis";
import { Step2Evidence } from "@/components/case/Step2Evidence";
import { Step3Goal } from "@/components/case/Step3Goal";
import { Step4Causes } from "@/components/case/Step4Causes";
import { Step5Actions } from "@/components/case/Step5Actions";
import { Step6Execute } from "@/components/case/Step6Execute";
import { Step7Done } from "@/components/case/Step7Done";
import { getJson, patchJson, ApiError } from "@/components/case/api";
import type { CampaignCase, CaseStep } from "@/lib/case/store";
import { useT } from "@/lib/i18n/client";

export default function CaseWorkspacePage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading, mutate } = useSWR<{ success: true; case: CampaignCase }>(
    id ? `/api/cases/${id}` : null,
    getJson,
  );
  const [stepBusy, setStepBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  async function goToStep(step: CaseStep) {
    if (!data) return;
    setStepBusy(true);
    setStepError(null);
    try {
      const json = await patchJson(`/api/cases/${id}`, { step });
      await mutate({ success: true, case: json.case }, { revalidate: false });
    } catch (e) {
      setStepError(e instanceof ApiError ? e.message : t("overview.xuly.detail.stepError"));
    } finally {
      setStepBusy(false);
    }
  }

  function refreshCase(next: CampaignCase) {
    mutate({ success: true, case: next }, { revalidate: false });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={AlertTriangle}
          title={t("overview.xuly.detail.loadFailed")}
          description={error instanceof ApiError ? error.message : t("overview.xuly.detail.notFound")}
          action={
            <Button onClick={() => mutate()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("overview.xuly.detail.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const c = data.case;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <CaseHeader c={c} />
      <StepStepper c={c} onGoTo={goToStep} busy={stepBusy} />

      {stepError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="flex items-center gap-1.5">{stepBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{stepError}</span>
        </div>
      )}

      {c.step === 1 && <Step1Analysis c={c} onNext={() => goToStep(2)} busy={stepBusy} />}
      {c.step === 2 && (
        <Step2Evidence c={c} onRefresh={refreshCase} onBack={() => goToStep(1)} onNext={() => goToStep(3)} busy={stepBusy} />
      )}
      {c.step === 3 && (
        <Step3Goal c={c} onBack={() => goToStep(2)} onSubmitted={refreshCase} busy={stepBusy} />
      )}
      {c.step === 4 && (
        <Step4Causes c={c} onBack={() => goToStep(3)} onNext={() => goToStep(5)} busy={stepBusy} />
      )}
      {c.step === 5 && (
        <Step5Actions c={c} onRefresh={refreshCase} onBack={() => goToStep(4)} onNext={() => goToStep(6)} busy={stepBusy} />
      )}
      {c.step === 6 && (
        <Step6Execute c={c} onRefresh={refreshCase} onBack={() => goToStep(5)} onNext={() => goToStep(7)} busy={stepBusy} />
      )}
      {c.step === 7 && <Step7Done c={c} onRefresh={refreshCase} onBack={() => goToStep(6)} />}
    </div>
  );
}
