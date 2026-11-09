// ============================================================
// Ads Content — Client-Side Filter / Sort / Group Helpers
// ============================================================
// The API returns a flat CreativeItem[]; everything else (filtering,
// sorting, campaign grouping, summary counts) is derived here —
// same architecture Campaigns already uses (flat array in, view
// state computed in the component).

import type { CampaignCreativeGroup, CreativeEntityStatus, CreativeItem, CreativeSourcePlatform } from "@/types/creative-content.types";

export type SortOption = "recent" | "spend_desc" | "clicks_desc" | "name_asc";

export interface AdsContentFilters {
  platform: "all" | "facebook" | "google";
  creativeType: "all" | CreativeSourcePlatform;
  company: "all" | string;
  status: "all" | CreativeEntityStatus;
  objective: "all" | string;
  product: "all" | string;
  search: string;
  sort: SortOption;
}

export const DEFAULT_FILTERS: AdsContentFilters = {
  platform: "all",
  creativeType: "all",
  company: "all",
  status: "all",
  objective: "all",
  product: "all",
  search: "",
  sort: "recent",
};

function matchesPlatform(item: CreativeItem, platform: AdsContentFilters["platform"]): boolean {
  if (platform === "all") return true;
  if (platform === "facebook") return item.platform === "facebook";
  return item.platform === "google_search" || item.platform === "google_pmax";
}

export function applyFilters(items: CreativeItem[], filters: AdsContentFilters): CreativeItem[] {
  const q = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (!matchesPlatform(item, filters.platform)) return false;
    if (filters.creativeType !== "all" && item.platform !== filters.creativeType) return false;
    if (filters.company !== "all" && item.company !== filters.company) return false;
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.objective !== "all" && item.campaignObjective !== filters.objective) return false;
    if (filters.product !== "all" && item.campaignName !== filters.product) return false;
    if (q) {
      const haystack = `${item.campaignName} ${item.name} ${item.headline ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function sortItems(items: CreativeItem[], sort: SortOption): CreativeItem[] {
  const copy = [...items];
  switch (sort) {
    case "spend_desc":
      return copy.sort((a, b) => b.metrics.spend - a.metrics.spend);
    case "clicks_desc":
      return copy.sort((a, b) => b.metrics.clicks - a.metrics.clicks);
    case "name_asc":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "recent":
    default:
      return copy.sort((a, b) => b.lastActiveDate.localeCompare(a.lastActiveDate));
  }
}

export function groupByCampaign(items: CreativeItem[]): CampaignCreativeGroup[] {
  const groups = new Map<string, CampaignCreativeGroup>();

  for (const item of items) {
    const existing = groups.get(item.campaignId);
    if (existing) {
      existing.items.push(item);
      existing.creativeCount += 1;
      existing.totalSpend += item.metrics.spend;
      existing.totalClicks += item.metrics.clicks;
      if (item.lastActiveDate > existing.latestActiveDate) existing.latestActiveDate = item.lastActiveDate;
    } else {
      groups.set(item.campaignId, {
        campaignId: item.campaignId,
        campaignName: item.campaignName,
        company: item.company,
        platform: item.platform,
        campaignObjective: item.campaignObjective,
        campaignStatus: item.campaignStatus,
        campaignStartDate: item.campaignStartDate,
        campaignEndDate: item.campaignEndDate,
        creativeCount: 1,
        totalSpend: item.metrics.spend,
        totalClicks: item.metrics.clicks,
        latestActiveDate: item.lastActiveDate,
        items: [item],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.latestActiveDate.localeCompare(a.latestActiveDate));
}
