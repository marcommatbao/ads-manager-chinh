"use client";

// Nút "Sao chép" nhỏ dùng chung cho ExperimentPanel (email service account) và
// LeadQualityPanel (URL webhook, khoá webhook, mẫu curl) — cùng mẫu với
// CopyWebTeamStepsButton ở components/measure/TagDoctorView.tsx.

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50",
        className
      )}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      {copied ? t("google.pmaxCopy.copied") : (label ?? t("google.pmaxCopy.copy"))}
    </button>
  );
}
