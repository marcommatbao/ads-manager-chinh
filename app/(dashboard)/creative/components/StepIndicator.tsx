"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────
// StepIndicator
// ─────────────────────────────────────────────

export function StepIndicator({
  currentStep,
  platform = "facebook",
}: {
  currentStep: number;
  /** Chọn riêng Google thì luồng chỉ có 3 bước — xem ghi chú dưới. */
  platform?: string;
}) {
  // Google KHÔNG đi qua bước 4.
  //
  // Hai nền tảng chạy hai đường khác hẳn nhau: Meta khởi chạy ở BƯỚC 4 của
  // wizard (gọi /api/creative/launch-campaign), còn Google khởi chạy gọn
  // trong GoogleCreativePanel ngay tại BƯỚC 3 (gọi /api/google/launch/search
  // hoặc /pmax). Trước đây thanh bước luôn in đủ 4 ô, nên người chạy Google
  // nhìn thấy một bước "Launch Campaign" mà không có đường nào bấm tới —
  // vừa tưởng mình làm thiếu, vừa đi tìm một cái nút không tồn tại.
  const t = useT();
  const isGoogleOnly = platform === "google";
  const steps = [
    { num: 1, label: t("creative.wizard.step1") },
    { num: 2, label: t("creative.wizard.step2") },
    { num: 3, label: isGoogleOnly ? t("creative.wizard.step3Google") : t("creative.wizard.step3") },
    ...(isGoogleOnly ? [] : [{ num: 4, label: t("creative.wizard.step4") }]),
  ];
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition-all",
              currentStep === s.num
                ? "bg-amber-500 text-amber-950 shadow-md shadow-amber-200"
                : currentStep > s.num
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-slate-100 text-slate-400"
            )}
          >
            {currentStep > s.num ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <span>{s.num}</span>
            )}
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn(
              "h-px w-8 transition-colors",
              currentStep > s.num ? "bg-green-300" : "bg-slate-200"
            )} />
          )}
        </div>
      ))}
    </div>
  );
}
