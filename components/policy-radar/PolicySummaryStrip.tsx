"use client";

import { useT } from "@/lib/i18n/client";
import type { PolicyRadarItem } from "@/lib/policy-radar/types";

// Mirrors components/dashboard/KpiCommandStrip.tsx's KpiCell visual pattern —
// operational counters, not vanity KPI cards (per CHART-SYSTEM-BRIEF §3).
function Cell({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm flex flex-col gap-1 min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 truncate">{label}</p>
      <p className={`text-base font-bold leading-tight tabular-nums ${accent ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export function PolicySummaryStrip({ items }: { items: PolicyRadarItem[] }) {
  const t = useT();
  const total = items.length;
  const google = items.filter((i) => i.platform === "google_ads").length;
  const meta = items.filter((i) => i.platform === "meta").length;
  const high = items.filter((i) => i.severity === "high").length;
  const needsReview = items.filter((i) => i.status === "unread" || i.status === "flagged_for_followup").length;
  const handled = items.filter((i) => i.status === "reviewed" || i.status === "archived").length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Cell label={t("meta.policy.sum.total")} value={total} />
      <Cell label="Google Ads" value={google} accent="text-[#3B82F6]" />
      <Cell label="Meta" value={meta} accent="text-[#4338CA]" />
      <Cell label={t("meta.policy.sum.high")} value={high} accent={high > 0 ? "text-red-600" : undefined} />
      <Cell label={t("meta.policy.sum.needsReview")} value={needsReview} accent={needsReview > 0 ? "text-amber-600" : undefined} />
      <Cell label={t("meta.policy.sum.handled")} value={handled} accent="text-emerald-600" />
    </div>
  );
}
