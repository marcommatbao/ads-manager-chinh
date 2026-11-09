// ============================================================
// Keyword Intent & Cost — types
// Real Google Ads keyword-level analysis surfaced as a read-only
// "Từ khóa" view inside Improvements. Not an Improvement — no
// applyPayload/status lifecycle, so kept as its own type family.
// ============================================================

export type IntentMatch = "relevant" | "borderline" | "off_intent" | "unknown";
export type BudgetImpact = "over_budget" | "under_budget" | "on_track" | "unknown";
export type KwMatchType = "EXACT" | "PHRASE" | "BROAD" | "UNKNOWN";

export interface SearchTermSample {
  searchTerm: string;
  clicks: number;
  cost: number; // VND
  conversions: number;
  overlapScore: number; // 0..1, word-overlap vs keyword text
  classification: Exclude<IntentMatch, "unknown">;
}

export interface KeywordInsight {
  id: string; // = criterionResourceName, stable row key
  company: string;
  keyword: string;
  matchType: KwMatchType;
  campaignId: string;
  campaignName: string;
  campaignResourceName: string;
  adGroupName: string;
  channelType: string; // enumName(enums.AdvertisingChannelType, ...)
  biddingStrategyType: string; // enumName(enums.BiddingStrategyType, ...)
  targetCpa: number | null; // VND
  impressions: number;
  clicks: number;
  ctr: number; // 0..1
  currentCpc: number; // VND
  qualityScore: number | null; // 1-10
  conversions: number;
  spend: number; // VND
  cplEstimate: number | null; // spend/conversions
  suggestedMaxCpc: number; // VND
  suggestedMaxCpcBasis: "target_cpa" | "cpl_benchmark";
  budgetImpact: BudgetImpact;
  intentMatch: IntentMatch;
  intentMatchAvgOverlap: number | null; // 0..1
  searchTermSamples: SearchTermSample[]; // capped, sorted by clicks desc
  suggestedAction: string;
  criterionResourceName: string;
}

export interface KeywordInsightsResponse {
  company: string;
  dateRange: { from: string; to: string };
  keywords: KeywordInsight[];
  meta: {
    totalKeywords: number;
    campaignsAnalyzed: number;
    searchTermRowsMatched: number;
    joinMethod: "resource_name" | "heuristic" | "none";
  };
}
