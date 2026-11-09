"use client";

import { cn } from "@/lib/utils";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { PolicyRadarItem, PolicySeverity } from "@/lib/policy-radar/types";

const SEVERITY_DOT: Record<PolicySeverity, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

const PLATFORM_LABEL = { google_ads: "Google Ads", meta: "Meta" } as const;

function monthKey(publishedAt: string | null): string {
  if (!publishedAt) return "unknown";
  return publishedAt.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string, t: TFunction, intl: string): string {
  if (key === "unknown") return t("meta.policy.noDate");
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(intl, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

interface PolicyTimelineViewProps {
  items: PolicyRadarItem[];
  selectedId: string | null;
  onOpenDetail: (item: PolicyRadarItem) => void;
}

export function PolicyTimelineView({ items, selectedId, onOpenDetail }: PolicyTimelineViewProps) {
  const t = useT();
  const intl = useIntlLocale();
  const groups = new Map<string, PolicyRadarItem[]>();
  for (const item of items) {
    const key = monthKey(item.publishedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  // Newest month first, "unknown" always last.
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });

  return (
    <div className="flex flex-col">
      {orderedKeys.map((key) => (
        <div key={key}>
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-1 py-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 capitalize">{monthLabel(key, t, intl)}</span>
            <span className="text-[10px] text-slate-400">{t("meta.policy.timeline.count", { n: groups.get(key)!.length })}</span>
          </div>
          <div className="divide-y divide-slate-50">
            {groups.get(key)!.map((item) => (
              <button
                key={item.id}
                onClick={() => onOpenDetail(item)}
                className={cn(
                  "w-full flex items-center gap-2 px-1 py-2 text-left hover:bg-slate-50 transition-colors",
                  selectedId === item.id && "bg-blue-50/60"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full shrink-0", SEVERITY_DOT[item.severity])} />
                <span className="text-xs text-slate-400 shrink-0 w-20 truncate">{PLATFORM_LABEL[item.platform]}</span>
                <span className="text-xs text-slate-400 shrink-0 w-16 truncate">{t(`meta.policy.sev.${item.severity}`)}</span>
                <span className="text-sm text-slate-700 truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
