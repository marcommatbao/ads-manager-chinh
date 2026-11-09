"use client";

import { useState, useEffect } from "react";
import { isHiddenPage } from "@/lib/hidden-pages";
import { cn } from "@/lib/utils";
import { generateActionPlan } from "@/lib/actionPlanGenerator";
import { executeActionPlan, handleUndo } from "@/lib/actionExecutor";
import { ActionPlan, ActionStep, Improvement } from "@/types/improvements";
import { getManualGuide } from "@/lib/improvement-manual-guide";
import { useIntlLocale, useT } from "@/lib/i18n/client";

// Simple Spinner since we don't have Lucide imports easily tracked here
const Spinner = ({ size = 16 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
  </svg>
);

const CheckIcon = ({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const XIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const ChevronIcon = ({ className, size = 14 }: { className?: string; size?: number }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

export function ActionPlanPanel({ improvement, company, onClose }: { improvement: Improvement; company: string; onClose: () => void }) {
  const t = useT();
  const loc = useIntlLocale();
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (improvement) {
      setPlan(generateActionPlan(improvement));
    }
  }, [improvement]);

  const handleApply = async () => {
    if (!plan) return;
    setApplying(true);
    const result = await executeActionPlan(
      plan,
      company,
      (stepId, status) => setStepStatus(prev => ({ ...prev, [stepId]: status }))
    );
    setApplying(false);
    if (result.success) setApplied(true);
  };

  const onUndo = async () => {
    if (!plan) return;
    setApplying(true);
    await handleUndo(plan, company);
    setApplying(false);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 bottom-0 w-[480px] max-w-full bg-slate-50 shadow-2xl z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-200 bg-white">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn(
                "w-max inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium border",
                improvement.platform === "FACEBOOK" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-indigo-50 text-indigo-700 border-indigo-200"
              )}>
                {improvement.platform}
              </span>
              <span className={cn(
                "w-max inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium border",
                improvement.priority === "HIGH" ? "bg-red-50 text-red-700 border-red-200" : "bg-orange-50 text-orange-700 border-orange-200"
              )}>
                {improvement.priority}
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-900">{improvement.title}</h2>
            <p className="text-xs text-slate-500 mt-1">
              📁 {improvement.campaignName || t("overview.improvements.plan.general")}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-md hover:bg-slate-100">
            <XIcon size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          <div className="rounded-xl bg-green-50 p-4 flex items-center gap-4 border border-green-200">
            <div className="text-2xl">💰</div>
            <div>
              {/* Soát dữ liệu 07/10: đây là CHI TIÊU đo được trong kỳ dính lỗi này — không phải "tiết kiệm/tháng" dự kiến. */}
              <p className="text-xs text-green-700 font-medium">{improvement.impactRough ? t("overview.improvements.plan.impactRough") : t("overview.improvements.plan.impactSpend")}</p>
              <p className="text-lg font-bold text-green-700">
                ₫{Math.round(plan?.totalImpact || 0).toLocaleString(loc)}
              </p>
            </div>
            <div className="ml-auto text-right text-green-800">
              <p className="text-xs">{t("overview.improvements.plan.autoApplicable")}</p>
              <p className="font-semibold text-sm">
                {t("overview.improvements.plan.stepsCount", { auto: plan?.autoSteps ?? "", total: plan?.steps.length ?? "" })}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              {t("overview.improvements.plan.title")}
            </p>
            <div className="flex flex-col gap-3">
              {plan?.steps.map((step, index) => (
                <ActionStepCard
                  key={step.id}
                  step={step}
                  index={index + 1}
                  status={stepStatus[step.id]}
                  improvement={improvement}
                />
              ))}
            </div>
          </div>

          {(plan?.manualSteps || 0) > 0 && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-4">
              <p className="text-xs font-semibold text-orange-700 mb-1">
                {t("overview.improvements.plan.manualCount", { n: plan?.manualSteps ?? "" })}
              </p>
              <p className="text-xs text-orange-600">
                {t("overview.improvements.plan.manualNote")}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 bg-white">
          {!applied ? (
            <>
              <button
                onClick={handleApply}
                disabled={applying || plan?.autoSteps === 0}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-amber-500 text-amber-950 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {applying ? (
                  <>
                    <Spinner size={16} />
                    {t("overview.improvements.plan.applying")}
                  </>
                ) : (
                  <>
                    <CheckIcon size={16} strokeWidth={2.5} />
                    {t("overview.improvements.plan.applyAuto", { n: plan?.autoSteps ?? "" })}
                  </>
                )}
              </button>
              <p className="text-xs text-slate-500 text-center mt-3">
                {t("overview.improvements.plan.undoNote")}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                <CheckIcon size={24} strokeWidth={3} />
              </div>
              <p className="font-semibold text-green-700">{t("overview.improvements.plan.applied")}</p>
              <p className="text-xs text-slate-500 text-center max-w-[250px]">
                {t("overview.improvements.plan.appliedNote")}
              </p>
              <button
                onClick={onUndo}
                disabled={applying}
                className="text-xs text-amber-700 font-medium underline hover:text-amber-900"
              >
                 {applying ? t("overview.improvements.plan.undoing") : t("overview.improvements.plan.undo")}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ActionStepCard({ step, index, status, improvement }: { step: ActionStep; index: number; status: string; improvement: Improvement }) {
  const t = useT();
  const [expanded, setExpanded] = useState(index === 1);

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all bg-white shadow-sm",
      status === "done" && "border-green-300 bg-green-50/30",
      status === "failed" && "border-red-300 bg-red-50/30",
      status === "applying" && "border-blue-400 shadow-md",
      !status && "border-slate-200"
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
          status === "done" ? "bg-green-600 text-white" :
          status === "failed" ? "bg-red-600 text-white" :
          status === "applying" ? "bg-blue-600 text-white animate-pulse" :
          step.canAutoApply ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"
        )}>
          {status === "done" ? "✓" : status === "failed" ? "✗" : status === "applying" ? "⟳" : index}
        </div>

        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-800">{step.title}</span>
            {!step.canAutoApply && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium flex-shrink-0">
                {t("overview.improvements.plan.manual")}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate leading-snug">{step.description}</p>
        </div>

        {/* Không hiện "+xM" từng bước: số chia 30/70 50/50 là tỷ lệ gõ tay, không đo được. */}

        <ChevronIcon className={cn("text-slate-400 transition-transform duration-300", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">{t("overview.improvements.plan.current")}</p>
              {Object.entries(step.before).map(([k, v]) => (
                <div key={k} className="flex flex-col mb-2 last:mb-0">
                  <span className="text-[11px] text-slate-500 font-medium">{k}</span>
                  <span className="text-xs font-semibold text-slate-900 leading-tight">{v}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-green-50 border border-green-100 p-3">
              <p className="text-[11px] font-bold text-green-700 uppercase tracking-wide mb-2">{t("overview.improvements.plan.afterApply")}</p>
              {Object.entries(step.after).map(([k, v]) => (
                <div key={k} className="flex flex-col mb-2 last:mb-0">
                  <span className="text-[11px] text-green-700 font-medium">{k}</span>
                  <span className="text-xs font-semibold text-green-900 leading-tight">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {!step.canAutoApply && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
              <p className="text-[11px] font-bold text-orange-800 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <span>📝</span> {t("overview.improvements.plan.manualGuide")}
              </p>
              <ManualStepGuide step={step} improvement={improvement} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Hướng dẫn xử lý tay cho bước không tự áp dụng được.
 *
 * Trước 16/09/2026 khối này in cứng đúng ba dòng chung ("Truy cập trình quản lý
 * quảng cáo. Tìm campaign X. Thực hiện thay đổi được yêu cầu.") cho MỌI loại —
 * trong khi hướng dẫn chi tiết từng loại đã được viết sẵn và nằm im trong repo
 * vì component dùng nó không được gọi ở đâu (xem lib/improvement-manual-guide.ts).
 * Nay đọc thẳng từ đó; chỉ loại nào thật sự chưa có hướng dẫn riêng mới rơi về
 * ba dòng chung.
 */
function ManualStepGuide({ step, improvement }: { step: ActionStep; improvement: Improvement }) {
  const t = useT();
  const guide = getManualGuide(improvement);
  const hasSteps = guide.steps.length > 0;

  return (
    <div className="mt-1 space-y-1.5">
      {guide.whatToDo && (
        <p className="text-xs font-semibold text-orange-900">{guide.whatToDo}</p>
      )}

      <ul className="list-disc pl-4 space-y-1 text-xs text-orange-800 font-medium opacity-90">
        {hasSteps ? (
          guide.steps.map((s, i) => <li key={i}>{s}</li>)
        ) : (
          <>
            <li>{t("overview.improvements.plan.guide1")}</li>
            <li>{t("overview.improvements.plan.guide2Pre")}<strong>{step.entityName}</strong>{t("overview.improvements.plan.guide2Post")}</li>
            <li>{t("overview.improvements.plan.guide3")}</li>
          </>
        )}
      </ul>

      {guide.internalLink && !isHiddenPage(guide.internalLink) && (
        <a
          href={guide.internalLink}
          className="inline-block text-xs font-semibold text-blue-700 hover:underline"
        >
          → {guide.internalLabel ?? t("overview.improvements.plan.openTool")}
        </a>
      )}

      {guide.externalHint && (
        <p className="text-[11px] text-orange-700 opacity-80">{guide.externalHint}</p>
      )}
    </div>
  );
}
