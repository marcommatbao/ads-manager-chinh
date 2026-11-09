"use client";

import { cn } from "@/lib/utils";
import { type TrendChange } from "@/lib/trend-utils";
import { useT } from "@/lib/i18n/client";

interface TrendBadgeProps {
  change: TrendChange | null;
  /** e.g. "vs 7 ngày trước" */
  periodLabel: string;
  /** Previous period date range for tooltip, e.g. "09/03 — 16/03" */
  prevPeriodRange?: string;
  /** Previous value formatted string for tooltip, e.g. "1.47%" */
  prevValueFmt?: string;
  /** Current value formatted string for tooltip, e.g. "1.79%" */
  currValueFmt?: string;
  /** Metric name displayed in tooltip, e.g. "CTR" */
  metricLabel?: string;
  className?: string;
  size?: "sm" | "xs";
}

export function TrendBadge({
  change,
  periodLabel,
  prevPeriodRange,
  prevValueFmt,
  currValueFmt,
  metricLabel,
  className,
  size = "xs",
}: TrendBadgeProps) {
  const t = useT();
  if (!change) return null;

  const { pct, direction, isGood } = change;
  const absPct = Math.abs(pct);

  // Colour
  const colorCls =
    isGood === true
      ? "text-emerald-600"
      : isGood === false
      ? "text-red-500"
      : "text-slate-400";

  const arrow = direction === "up" ? "▲" : "▼";
  const textSize = size === "sm" ? "text-xs" : "text-[10px]";

  // Tooltip lines
  const hasTooltip = prevPeriodRange || prevValueFmt || currValueFmt;

  return (
    <span className={cn("relative group inline-flex items-center gap-0.5", className)}>
      <span className={cn("font-semibold leading-none", colorCls, textSize)}>
        {arrow} {absPct.toFixed(1)}%
      </span>
      <span className={cn("text-slate-400 leading-none", textSize)}>
        {" "}{periodLabel}
      </span>

      {/* Tooltip */}
      {hasTooltip && (
        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover:flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-xl text-[11px] text-slate-700 whitespace-nowrap min-w-[190px]">
          {prevPeriodRange && (
            <span className="text-slate-400">{t("panels.trend.prevPeriod", { range: prevPeriodRange })}</span>
          )}
          {metricLabel && prevValueFmt && (
            <span>
              <span className="text-slate-400">{t("panels.trend.prevValue", { metric: metricLabel })}</span>{" "}
              <span className="font-semibold">{prevValueFmt}</span>
            </span>
          )}
          {metricLabel && currValueFmt && (
            <span>
              <span className="text-slate-400">{t("panels.trend.currValue", { metric: metricLabel })}</span>{" "}
              <span className="font-semibold">{currValueFmt}</span>
            </span>
          )}
          {pct !== 0 && (
            <span className={cn("font-semibold mt-0.5 border-t border-slate-100 pt-1", colorCls)}>
              {direction === "up" ? t("panels.trend.up") : t("panels.trend.down")}: {direction === "up" ? "+" : "-"}{absPct.toFixed(1)}%
            </span>
          )}
        </span>
      )}
    </span>
  );
}
