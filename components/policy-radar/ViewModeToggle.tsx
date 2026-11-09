"use client";

import { cn } from "@/lib/utils";

export type PolicyViewMode = "feed" | "timeline";

const OPTIONS: { value: PolicyViewMode; label: string }[] = [
  { value: "feed", label: "Feed" },
  { value: "timeline", label: "Timeline" },
];

export function ViewModeToggle({ value, onChange }: { value: PolicyViewMode; onChange: (v: PolicyViewMode) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium transition-all",
            value === opt.value ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
