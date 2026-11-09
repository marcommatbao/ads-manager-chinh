import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { Campaign } from "@/types/ads.types";

export interface CampaignObjectiveStats {
  facebook: {
    total: number;
    byObjective: Array<{
      objective: string;
      label: string;
      icon: string;
      count: number;
      spend: number;
      color: string;
    }>;
  };
  google: {
    total: number;
    byType: Array<{
      type: string;
      label: string;
      icon: string;
      count: number;
      spend: number;
      color: string;
    }>;
  };
}

export function computeObjectiveStats(campaigns: Campaign[]): CampaignObjectiveStats {
  const active = campaigns.filter((c) => c.status === "ACTIVE");

  // Facebook metrics map
  const FB_META: Record<string, { label: string; icon: string; color: string }> = {
    OUTCOME_SALES:       { label: "Sales",         icon: "🛒", color: "#10b981" },
    OUTCOME_TRAFFIC:     { label: "Traffic",       icon: "🔗", color: "#3b82f6" },
    OUTCOME_ENGAGEMENT:  { label: "Engagement",    icon: "❤️",  color: "#ec4899" },
    OUTCOME_LEADS:       { label: "Leads",         icon: "📋", color: "#8b5cf6" },
    OUTCOME_AWARENESS:   { label: "Awareness",     icon: "👁️",  color: "#f59e0b" },
    OUTCOME_APP_PROMOTION:{ label: "App Install",  icon: "📱", color: "#06b6d4" },
    LINK_CLICKS:         { label: "Link Clicks",   icon: "👆", color: "#6366f1" },
    POST_ENGAGEMENT:     { label: "Post Engagement",icon:"💬", color: "#f97316" },
    VIDEO_VIEWS:         { label: "Video Views",   icon: "▶️",  color: "#ef4444" },
    MESSAGES:            { label: "Messages",      icon: "💌", color: "#14b8a6" },
    CONVERSIONS:         { label: "Conversions",   icon: "🎯", color: "#10b981" },
  };

  // Google metrics map — keyed by advertising_channel_type enum string
  const GG_META: Record<string, { label: string; icon: string; color: string }> = {
    SEARCH:          { label: "Search",        icon: "🔍", color: "#4285F4" },
    DISPLAY:         { label: "Display",       icon: "🖼️",  color: "#34A853" },
    PERFORMANCE_MAX: { label: "Performance Max", icon: "⚡", color: "#FBBC05" },
    PMAX:            { label: "Performance Max", icon: "⚡", color: "#FBBC05" },
    VIDEO:           { label: "Video",         icon: "▶️",  color: "#EA4335" },
    SHOPPING:        { label: "Shopping",      icon: "🛍️",  color: "#0F9D58" },
    MULTI_CHANNEL:   { label: "App (UAC)",     icon: "📱", color: "#AB47BC" },
    APP:             { label: "App",           icon: "📱", color: "#AB47BC" },
    SMART:           { label: "Smart",         icon: "🤖", color: "#00ACC1" },
    DEMAND_GEN:      { label: "Demand Gen",    icon: "🎯", color: "#FF7043" },
    DISCOVERY:       { label: "Discovery",     icon: "💡", color: "#FF7043" },
    LOCAL:           { label: "Local",         icon: "📍", color: "#0097A7" },
    LOCAL_SERVICES:  { label: "Local Svc",     icon: "🏠", color: "#0097A7" },
    HOTEL:           { label: "Hotel",         icon: "🏨", color: "#795548" },
    TRAVEL:          { label: "Travel",        icon: "✈️",  color: "#5C6BC0" },
  };

  // FB Active
  const fbActive = active.filter((c) => c.platform?.toLowerCase() === "facebook");
  const fbGroups: Record<string, number> = {};
  const fbSpend:  Record<string, number> = {};
  fbActive.forEach((c) => {
    const key = (c.objective || "UNKNOWN").toUpperCase();
    fbGroups[key] = (fbGroups[key] || 0) + 1;
    fbSpend[key]  = (fbSpend[key] || 0) + (c.metrics?.spend || 0);
  });

  // GG Active
  const ggActive = active.filter((c) => c.platform?.toLowerCase() === "google");
  const ggGroups: Record<string, number> = {};
  const ggSpend:  Record<string, number> = {};
  ggActive.forEach((c) => {
    // any can be channelType or objective depending on mapping
    const rawType = (c as any).channelType || c.objective || "UNKNOWN";
    const key = String(rawType).toUpperCase();
    ggGroups[key] = (ggGroups[key] || 0) + 1;
    ggSpend[key]  = (ggSpend[key] || 0) + (c.metrics?.spend || 0);
  });

  return {
    facebook: {
      total: fbActive.length,
      byObjective: Object.entries(fbGroups)
        .map(([obj, count]) => ({
          objective: obj,
          label:  FB_META[obj]?.label || obj,
          icon:   FB_META[obj]?.icon  || "📌",
          color:  FB_META[obj]?.color || "#94a3b8",
          count,
          spend:  fbSpend[obj] || 0,
        }))
        .sort((a, b) => b.count - a.count),
    },
    google: {
      total: ggActive.length,
      byType: Object.entries(ggGroups)
        .map(([type, count]) => ({
          type,
          label: GG_META[type]?.label || type,
          icon:  GG_META[type]?.icon  || "📌",
          color: GG_META[type]?.color || "#94a3b8",
          count,
          spend: ggSpend[type] || 0,
        }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

export function ObjectiveStatsWidget({ 
  stats, 
  activeFilter, 
  onFilterChange 
}: { 
  stats: CampaignObjectiveStats; 
  activeFilter: { platform: string | null; objective: string | null };
  onFilterChange: (Platform: string | null, Objective: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Facebook Panel */}
      <ObjectivePanel
        platform="FACEBOOK"
        total={stats.facebook.total}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        items={stats.facebook.byObjective.map((o) => ({
          key:   o.objective,
          label: o.label,
          icon:  o.icon,
          count: o.count,
          spend: o.spend,
          color: o.color,
        }))}
      />

      {/* Google Panel */}
      <ObjectivePanel
        platform="GOOGLE"
        total={stats.google.total}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        items={stats.google.byType.map((t) => ({
          key:   t.type,
          label: t.label,
          icon:  t.icon,
          count: t.count,
          spend: t.spend,
          color: t.color,
        }))}
      />
    </div>
  );
}

function ObjectivePanel({ 
  platform, 
  total, 
  items, 
  activeFilter, 
  onFilterChange 
}: { 
  platform: string; 
  total: number; 
  items: any[]; 
  activeFilter: { platform: string | null; objective: string | null };
  onFilterChange: (p: string | null, o: string | null) => void;
}) {
  const t = useT();
  const intl = useIntlLocale();
  const isFB = platform === "FACEBOOK";
  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className={cn(
        "flex items-center justify-between px-5 py-4 border-b border-slate-100",
        isFB ? "bg-[#1877F2]/5" : "bg-[#4285F4]/5"
      )}>
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-sm text-slate-800">
            {isFB ? "Facebook Ads" : "Google Ads"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
          <span className="text-sm font-bold tabular-nums text-slate-700">{total}</span>
          <span className="text-xs text-slate-500">{t("panels.objstats.active")}</span>
        </div>
      </div>

      <div className="px-5 py-3 flex flex-col gap-2.5">
        {items.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">{t("panels.objstats.noActive")}</p>
        ) : (
          items.map((item) => (
            <ObjectiveRow
              key={item.key}
              item={item}
              maxCount={maxCount}
              total={total}
              platform={platform}
              isActive={activeFilter.platform === platform && activeFilter.objective === item.key}
              onClick={() => {
                const isSame = activeFilter.platform === platform && activeFilter.objective === item.key;
                if (isSame) {
                  onFilterChange(null, null);
                } else {
                  onFilterChange(platform, item.key);
                }
              }}
            />
          ))
        )}
      </div>

      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">{t("panels.objstats.totalSpend")}</span>
          <span className="text-sm font-bold tabular-nums text-slate-800">
            ₫{Math.round(items.reduce((s, i) => s + i.spend, 0)).toLocaleString(intl)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ObjectiveRow({ 
  item, 
  maxCount, 
  total, 
  platform,
  isActive,
  onClick 
}: any) {
  const t = useT();
  const intl = useIntlLocale();
  const pct = Math.round((item.count / total) * 100);
  const barWidth = Math.round((item.count / maxCount) * 100);

  return (
    <div className="relative group">
      <div
        onClick={onClick}
        className={cn(
          "flex items-center gap-3 cursor-pointer hover:bg-slate-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors",
          isActive && "bg-slate-100 ring-1 ring-slate-200"
        )}
      >
        <span className="text-base w-6 text-center flex-shrink-0">{item.icon}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-700 truncate">{item.label}</span>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <span className="text-xs text-slate-400 tabular-nums">{pct}%</span>
              <span className="text-xs font-bold text-slate-800 tabular-nums w-4 text-right">{item.count}</span>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${barWidth}%`, background: item.color }}
            />
          </div>
        </div>
      </div>

      {/* Tooltip */}
      <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
        <div className="flex flex-col gap-1.5 text-slate-600">
          <div className="flex justify-between gap-4">
            <span>{t("panels.objstats.campaigns")}</span>
            <span className="font-bold text-slate-900">{item.count}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>{t("panels.objstats.spend")}</span>
            <span className="font-bold text-slate-900">₫{Math.round(item.spend).toLocaleString(intl)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>{t("panels.objstats.avg")}</span>
            <span className="font-bold text-slate-900">₫{Math.round(item.spend / item.count).toLocaleString(intl)}</span>
          </div>
          <div className="pt-1.5 border-t border-slate-100 text-amber-700 font-medium">
            {t("panels.objstats.clickFilter")}
          </div>
        </div>
      </div>
    </div>
  );
}
