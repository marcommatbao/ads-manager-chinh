"use client";

import { cn } from "@/lib/utils";

// Shared pill-chip control for single-select filters (severity, category) —
// mirrors the ViewModeTabs pattern from app/(dashboard)/improvements/page.tsx:
// filled-dark active state, outline inactive. Distinct from the platform
// Tabs (underline style) so "changes the dataset" (platform) never looks
// like "narrows the dataset" (these chips) — see CHART-SYSTEM-BRIEF §12.
interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface PolicyFilterChipsProps<T extends string> {
  options: ChipOption<T>[];
  value: T | "";
  onChange: (value: T | "") => void;
  allLabel: string;
}

export function PolicyFilterChips<T extends string>({ options, value, onChange, allLabel }: PolicyFilterChipsProps<T>) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      <button
        onClick={() => onChange("")}
        className={cn(
          "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
          value === ""
            ? "bg-slate-900 border-slate-900 text-white"
            : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
        )}
      >
        {allLabel}
      </button>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(value === opt.value ? "" : opt.value)}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            value === opt.value
              ? "bg-slate-900 border-slate-900 text-white"
              : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
