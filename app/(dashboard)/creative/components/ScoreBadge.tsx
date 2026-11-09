"use client";

import { cn } from "@/lib/utils";
import type { Platform } from "@/types/ads.types";

// ─────────────────────────────────────────────
// ScoreBadge
// ─────────────────────────────────────────────

export function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const color =
    score >= 7
      ? "bg-green-50 text-green-700 border-green-200"
      : score >= 5
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={cn("rounded-lg border px-2 py-0.5 text-xs font-bold", color)}>
      {score}/10
    </span>
  );
}

// ─────────────────────────────────────────────
// CreativePlatformBadge
// ─────────────────────────────────────────────

export function CreativePlatformBadge({ platform }: { platform: Platform }) {
  const isFb = platform === "facebook";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        isFb ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600"
      )}
    >
      {isFb ? "Facebook" : "Google"}
    </span>
  );
}
