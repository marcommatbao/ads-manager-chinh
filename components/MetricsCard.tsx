"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricsCardProps {
  title: string;
  value: string | number;
  prefix?: string;
  suffix?: string;
  change: number;
  icon: LucideIcon;
  iconColor?: string;
  isLoading?: boolean;
  currency?: string;
}

// ---- Skeleton shimmer ----
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-slate-200",
        className
      )}
    />
  );
}

// ---- Change badge ----
function ChangeBadge({ change }: { change: number }) {
  if (change > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-600 tabular-nums">
        ▲ {change.toFixed(1)}%
      </span>
    );
  }
  if (change < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-500 tabular-nums">
        ▼ {Math.abs(change).toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-400">
      — 0%
    </span>
  );
}

export default function MetricsCard({
  title,
  value,
  prefix,
  suffix,
  change,
  icon: Icon,
  iconColor = "blue",
  isLoading = false,
}: MetricsCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* Row 1: title + icon */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>

        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            iconColor === "green"  && "bg-green-50",
            iconColor === "purple" && "bg-purple-50",
            iconColor === "amber"  && "bg-amber-50",
            iconColor === "red"    && "bg-red-50",
            // default blue
            !["green","purple","amber","red"].includes(iconColor) && "bg-blue-50"
          )}
        >
          <Icon
            size={20}
            className={cn(
              iconColor === "green"  && "text-green-600",
              iconColor === "purple" && "text-purple-600",
              iconColor === "amber"  && "text-amber-600",
              iconColor === "red"    && "text-red-500",
              !["green","purple","amber","red"].includes(iconColor) && "text-blue-600"
            )}
          />
        </div>
      </div>

      {/* Row 2: value + change badge */}
      <div className="mt-3 flex items-end justify-between gap-2">
        {/* Value */}
        {isLoading ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <p className="text-2xl font-bold text-slate-800 leading-none tabular-nums">
            {prefix && (
              <span className="text-lg font-semibold text-slate-400 mr-0.5">
                {prefix}
              </span>
            )}
            {value}
            {suffix && (
              <span className="text-lg font-semibold text-slate-400 ml-0.5">
                {suffix}
              </span>
            )}
          </p>
        )}

        {/* Change badge */}
        {isLoading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <ChangeBadge change={change} />
        )}
      </div>
    </div>
  );
}
