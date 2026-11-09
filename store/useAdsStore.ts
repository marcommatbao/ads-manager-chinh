// ============================================================
// Zustand Global State — AdsCommand
// ============================================================

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  Campaign,
  DashboardSummary,
  Platform,
  DateRange,
  AdCreative,
  CampaignStatus,
} from "@/types/ads.types";
import type { GA4CampaignData } from "@/lib/ga4-client";
import type { GA4PropertyMapping } from "@/types/ads.types";

export type CompanyFilter = "all" | string;

// detectCompany đã chuyển sang lib dùng chung (server + client an toàn).
// Re-export để giữ tương thích cho mọi import "@/store/useAdsStore".
export { detectCompany, GOOGLE_ACCOUNT_COMPANY } from "@/lib/company-detect";

// ---- Helper: ISO date string N days ago ----
function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// ---- State shape ----
interface AdsState {
  campaigns: Campaign[];
  summary: DashboardSummary | null;
  selectedPlatform: Platform;
  dateRange: DateRange;
  isLoading: boolean;
  error: string | null;
  activeCreatives: AdCreative[];
  currency: string;
  selectedGoogleAccount: string | null;
  selectedCompany: CompanyFilter;
  // GA4 Integration
  ga4Connections: GA4PropertyMapping[];
  ga4Data: GA4CampaignData[];
  ga4Status: "idle" | "loading" | "connected" | "error";
  ga4LastFetched: string | null;
}

// ---- Actions shape ----
interface AdsActions {
  setCampaigns: (campaigns: Campaign[]) => void;
  setSummary: (summary: DashboardSummary) => void;
  setSelectedPlatform: (platform: Platform) => void;
  setDateRange: (range: DateRange) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveCreatives: (creatives: AdCreative[]) => void;
  setCurrency: (currency: string) => void;
  setSelectedGoogleAccount: (accountId: string | null) => void;
  setSelectedCompany: (company: CompanyFilter) => void;
  updateCampaignStatus: (id: string, status: CampaignStatus) => void;
  updateCampaignBudget: (id: string, budget: number) => void;
  // GA4
  setGA4Connections: (conns: GA4PropertyMapping[]) => void;
  setGA4Data: (data: GA4CampaignData[]) => void;
  fetchGA4: (campaignNames?: string[]) => Promise<void>;
}

// ---- Default values ----
const defaultDateRange: DateRange = {
  from: isoDate(7),   // 7 days ago
  to: isoDate(0),     // today
};

const initialState: AdsState = {
  campaigns: [],
  summary: null,
  selectedPlatform: "all",
  dateRange: defaultDateRange,
  isLoading: false,
  error: null,
  activeCreatives: [],
  currency: "VND",
  selectedGoogleAccount: null,
  selectedCompany: "all",
  ga4Connections: [],
  ga4Data: [],
  ga4Status: "idle",
  ga4LastFetched: null,
};

// ---- Store ----
export const useAdsStore = create<AdsState & AdsActions>()(
  immer((set) => ({
    ...initialState,

    setCampaigns: (campaigns) =>
      set((state) => {
        state.campaigns = campaigns;
      }),

    setSummary: (summary) =>
      set((state) => {
        state.summary = summary;
      }),

    setSelectedPlatform: (platform) =>
      set((state) => {
        state.selectedPlatform = platform;
      }),

    setDateRange: (range) =>
      set((state) => {
        state.dateRange = range;
      }),

    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    setActiveCreatives: (creatives) =>
      set((state) => {
        state.activeCreatives = creatives;
      }),

    setCurrency: (currency) =>
      set((state) => {
        state.currency = currency;
      }),

    setSelectedGoogleAccount: (accountId) =>
      set((state) => {
        state.selectedGoogleAccount = accountId;
      }),

    setSelectedCompany: (company) =>
      set((state) => {
        state.selectedCompany = company;
      }),

    updateCampaignStatus: (id, status) =>
      set((state) => {
        const c = state.campaigns.find((cam) => cam.id === id);
        if (c) c.status = status;
      }),

    updateCampaignBudget: (id, budget) =>
      set((state) => {
        const c = state.campaigns.find((cam) => cam.id === id);
        if (c) c.dailyBudget = budget;
      }),

    setGA4Connections: (conns) =>
      set((state) => {
        state.ga4Connections = conns;
      }),

    setGA4Data: (data) =>
      set((state) => {
        state.ga4Data = data;
        state.ga4Status = "connected";
      }),

    fetchGA4: async (campaignNames) => {
      set((state) => { state.ga4Status = "loading"; });
      try {
        const body = campaignNames
          ? { action: "mock", campaignNames }
          : { action: "mock" };
        const res = await fetch("/api/ga4", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (json.success) {
          set((state) => {
            if (json.data.connections) {
              state.ga4Connections = json.data.connections;
            }
            state.ga4Data = json.data.campaigns;
            state.ga4Status = "connected";
            state.ga4LastFetched = json.data.lastFetchedAt;
          });
        } else {
          set((state) => { state.ga4Status = "error"; });
        }
      } catch {
        set((state) => { state.ga4Status = "error"; });
      }
    },
  }))
);
