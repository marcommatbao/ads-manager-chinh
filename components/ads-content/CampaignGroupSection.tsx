"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CreativeCard } from "./CreativeCard";
import { CreativeTypeBadge } from "./CreativeTypeBadge";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { getCampaignDuration } from "@/lib/campaign-utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { CampaignCreativeGroup, CreativeItem } from "@/types/creative-content.types";

function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface CampaignGroupSectionProps {
  group: CampaignCreativeGroup;
  currency: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectGroup: (ids: string[], select: boolean) => void;
  onViewDetail: (item: CreativeItem) => void;
  defaultOpen?: boolean;
}

export function CampaignGroupSection({
  group,
  currency,
  selectedIds,
  onToggleSelect,
  onToggleSelectGroup,
  onViewDetail,
  defaultOpen = true,
}: CampaignGroupSectionProps) {
  const intl = useIntlLocale();
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const groupItemIds = group.items.map((i) => i.id);
  const allSelected = groupItemIds.length > 0 && groupItemIds.every((id) => selectedIds.has(id));
  const duration = getCampaignDuration(group.campaignStartDate, group.campaignEndDate);

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 overflow-hidden">
      <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-100/60">
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          title={t("creative.adsContent.group.selectAll")}
        >
          <Checkbox checked={allSelected} onCheckedChange={() => onToggleSelectGroup(groupItemIds, !allSelected)} />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}

          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-800">{group.campaignName}</p>
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              group.company === "MBC" ? "bg-blue-50 text-blue-600" : "bg-indigo-50 text-indigo-600"
            )}>
              {group.company}
            </span>
            <CreativeTypeBadge platform={group.platform} />
            <CreativeStatusBadge status={group.campaignStatus} />
            {group.campaignObjective && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{group.campaignObjective}</span>
            )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4 text-xs text-slate-500">
            <span>{t("creative.adsContent.group.creativeCount", { n: group.creativeCount })}</span>
            <span className="font-semibold text-slate-700">{formatCurrency(group.totalSpend, currency, false, intl)}</span>
            <span>{t("creative.adsContent.group.clicks", { n: formatNumber(group.totalClicks, intl) })}</span>
            <span className="hidden sm:inline">{t("creative.adsContent.group.latest", { date: formatShortDate(group.latestActiveDate) })}</span>
            <span
              className={cn("hidden md:inline font-medium", duration.hasEnded ? "text-slate-400" : "text-slate-600")}
              title={duration.detail}
            >
              ⏱ {duration.label}
            </span>
          </div>
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-100 p-3">
          {group.items.map((item) => (
            <CreativeCard
              key={item.id}
              item={item}
              currency={currency}
              selected={selectedIds.has(item.id)}
              onToggleSelect={onToggleSelect}
              onViewDetail={onViewDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
