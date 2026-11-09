// ============================================================
// Ads Content — Unified Creative-Item Data Model
// ============================================================

export type CreativeSourcePlatform = "facebook" | "google_search" | "google_pmax";

export type CreativeSubtype = "fb_ad" | "rsa" | "pmax_asset";

export type CreativeEntityStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "UNKNOWN";

// Core metrics shared across subtypes. PMax assets don't expose
// per-asset spend/clicks via the Google Ads API — metricsAvailable
// tells the UI to render a badge instead of a (fake) number.
export interface CreativeMetrics {
  spend: number;
  clicks: number;
  impressions?: number;
  ctr?: number;
  metricsAvailable: boolean;
}

// Video engagement, Facebook video creatives only. Hook Rate = p25-watched /
// impressions (who stopped scrolling in the first ~3s). Hold Rate =
// thruplay-watched / p25-watched (of those hooked, who stayed to 15s/full
// video) — deliberately relative to p25, not impressions.
export interface CreativeVideoMetrics {
  p25: number;
  thruplay: number;
  hookRate?: number;
  holdRate?: number;
}

export interface CreativeItem {
  id: string;                    // `${platform}:${nativeId}`
  nativeId: string;
  platform: CreativeSourcePlatform;
  company: string;

  campaignId: string;
  campaignName: string;
  campaignObjective?: string;
  campaignStatus: CreativeEntityStatus;
  // Real for Facebook (campaign.start_time/stop_time) and both Google
  // paths (campaign.start_date/end_date) as of 2026-07-29 — before that,
  // Google campaigns had no reliable start date in this pipeline (see the
  // `badges` comment below, now stale but left as historical context).
  campaignStartDate?: string;
  campaignEndDate?: string | null;

  adGroupId?: string;             // Google only
  adGroupName?: string;           // Google only

  status: CreativeEntityStatus;
  name: string;
  headline?: string;
  primaryText?: string;
  descriptions?: string[];
  cta?: string;
  finalUrl?: string;

  imageUrl?: string | null;
  assetAvailable: boolean;        // false → render placeholder

  metrics: CreativeMetrics;
  isVideo?: boolean;               // Facebook only
  video?: CreativeVideoMetrics;    // Facebook video creatives only
  firstActiveDate: string;        // ISO date (YYYY-MM-DD) — earliest day with spend/clicks in the selected month
  lastActiveDate: string;         // ISO date (YYYY-MM-DD)

  // Inferred signals (Learning/Best/Low CTR), computed by
  // lib/ads-content/badges.ts reusing components/CampaignTable.tsx's
  // getCampaignHealthBadge / lib/campaign-health.ts's getLearningStatus
  // thresholds. Empty when the underlying signal isn't derivable
  // (e.g. Google campaigns have no reliable start date in this pipeline).
  badges: string[];

  // Real period-over-period fatigue check (current 7d vs previous 7d —
  // lib/ads-content/fatigue.ts + lib/ad-fatigue-engine.ts). Facebook only;
  // undefined when not computed (e.g. Google creatives, or ad had no
  // recent activity to evaluate).
  fatigueDetail?: {
    severity: "ok" | "warning" | "critical";
    issues: Array<{ message: string; suggestion: string }>;
  };

  raw: { subtype: CreativeSubtype } & Record<string, unknown>;
}

export interface AdsContentResponse {
  items: CreativeItem[];
  warnings: string[];
  generatedAt: string;
  month: string;                  // YYYY-MM actually served
}

// ── Derived (client-side only) ──────────────────────────────

export interface CampaignCreativeGroup {
  campaignId: string;
  campaignName: string;
  company: string;
  platform: CreativeSourcePlatform;
  campaignObjective?: string;
  campaignStatus: CreativeEntityStatus;
  campaignStartDate?: string;
  campaignEndDate?: string | null;
  creativeCount: number;
  totalSpend: number;
  totalClicks: number;
  latestActiveDate: string;
  items: CreativeItem[];
}
