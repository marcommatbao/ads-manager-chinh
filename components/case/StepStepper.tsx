// ============================================================
// Thanh 7 bước của phiên xử lý — bấm để nhảy bước (server xác nhận lại,
// 409 thì báo ngay, không tự đoán "chưa tới được bước này" ở đây).
// ============================================================
"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignCase, CaseStep } from "@/lib/case/store";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

export const STEP_LABELS: Record<CaseStep, MessageKey> = {
  1: "overview.stepper.s1",
  2: "overview.stepper.s2",
  3: "overview.stepper.s3",
  4: "overview.stepper.s4",
  5: "overview.stepper.s5",
  6: "overview.stepper.s6",
  7: "overview.stepper.s7",
};

/** Bản sao NHẸ của luật `reachable()` ở app/api/cases/[id]/route.ts — chỉ để
 *  mờ/sáng nút trên UI. Server vẫn là nơi quyết định thật; bấm sai vẫn ra
 *  thông báo 409 tử tế thay vì im lặng. */
export function stepReachable(c: CampaignCase, step: CaseStep): boolean {
  if (step <= 3) return true
  if (step <= 5) return !!c.diagnosis
  if (step === 6) return c.actions.length > 0
  return c.executions.length > 0
}

export function StepStepper({
  c,
  onGoTo,
  busy,
}: {
  c: CampaignCase;
  onGoTo: (step: CaseStep) => void;
  busy?: boolean;
}) {
  const t = useT();
  const steps = [1, 2, 3, 4, 5, 6, 7] as CaseStep[];
  return (
    <ol aria-label={t("overview.stepper.aria")} className="mb-5 flex items-stretch gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 sm:gap-2">
      {steps.map((step) => {
        const done = step < c.step;
        const cur = step === c.step;
        const reach = stepReachable(c, step);
        return (
          <li key={step} className="flex-1 min-w-0">
            <button
              type="button"
              disabled={busy || (!reach && !done && !cur)}
              onClick={() => onGoTo(step)}
              aria-current={cur ? "step" : undefined}
              title={t(STEP_LABELS[step])}
              className={cn(
                "flex w-full items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 text-xs font-medium transition-colors sm:justify-start sm:px-2.5",
                cur ? "bg-blue-600 text-white" : done ? "text-emerald-700 hover:bg-emerald-50" : "text-slate-500 hover:bg-slate-50",
                !reach && !done && !cur && "cursor-not-allowed opacity-40",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  cur ? "bg-white/20 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500",
                )}
              >
                {done ? <Check className="h-3 w-3" aria-hidden="true" /> : step}
              </span>
              {/* Di động: chỉ số hiện number, riêng bước ĐANG LÀM vẫn hiện tên — người dùng luôn biết đang ở đâu. */}
              <span className={cn("truncate", cur ? "inline" : "hidden sm:inline")}>{t(STEP_LABELS[step])}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
