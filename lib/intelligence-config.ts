// ─────────────────────────────────────────────
// Competitor Intelligence Hub — Types & Config
// (SimilarWebData đã chuyển sang lib/similarweb.ts)
// ─────────────────────────────────────────────

// ── Competitors ──
export interface IntelCompetitor {
  id: string;
  name: string;
  domain: string;
  shortName: string;
  color: string;
}

export const INTEL_COMPETITORS: IntelCompetitor[] = [
  { id: "pa",        name: "P.A Vietnam",    domain: "pavietnam.vn",  shortName: "PA",   color: "#6366f1" },
  { id: "inet",      name: "INET",           domain: "inet.vn",      shortName: "INET", color: "#0ea5e9" },
  { id: "vietnix",   name: "Vietnix",        domain: "vietnix.vn",   shortName: "VTX",  color: "#f59e0b" },
  { id: "azdigi",    name: "Azdigi",         domain: "azdigi.com",   shortName: "AZD",  color: "#10b981" },
  { id: "nhanhoa",   name: "Nhân Hòa",       domain: "nhanhoa.com",  shortName: "NHH",  color: "#ef4444" },
  { id: "meinvoice", name: "MISA eInvoice",  domain: "meinvoice.vn", shortName: "MISA", color: "#8b5cf6" },
];

// ── Channels ──
export interface ChannelDef {
  key: string;
  label: string;
  icon: string;
}

export const CHANNELS: ChannelDef[] = [
  { key: "direct",   label: "Direct",         icon: "🏠" },
  { key: "search",   label: "Google Search",   icon: "🔍" },
  { key: "social",   label: "Social (FB/TT)",  icon: "📱" },
  { key: "display",  label: "Display Ads",     icon: "🖼️" },
  { key: "mail",     label: "Email",           icon: "📧" },
  { key: "referral", label: "Referral",        icon: "🔗" },
];

// ── SimilarWeb Key Rotation ──
export interface SimilarWebKey {
  id: string;
  apiKey: string;
  gmail: string;
  addedAt: string;
  expiresAt: string;
  usageCount: number;
  isActive: boolean;
}

// ── Facebook Ad Keyword Data ──
export interface FBKeywordAd {
  pageId: string;
  pageName: string;
  adCount: number;
  latestAdText: string | null;
  latestAdHeadline: string | null;
  snapshotUrl: string | null;
  keyword: string;
}

// ── Google Transparency ──
export interface GoogleTransparencyData {
  domain: string;
  totalAds: number;
  activeAds: number;
  adFormats: string[];
  lastSeen: string | null;
  fetchedAt: string;
  /** false when SerpApi isn't configured or the real fetch failed — the
   * totalAds/activeAds above are 0-as-"unknown", not a confirmed real zero. */
  available?: boolean;
}

// ── TikTok Ad ──
export interface TikTokAdData {
  advertiser: string;
  description: string;
  firstSeen: string | null;
  lastSeen: string | null;
  videoUrl: string | null;
}

// ── AI Channel Score ──
export interface ChannelScores {
  facebook: number;
  google: number;
  tiktok: number;
  seo: number;
  email: number;
  direct: number;
  [key: string]: number;
}

export interface ChannelAnalysis {
  competitorId: string;
  channelScores: ChannelScores;
  dominantChannel: string;
  growingChannel: string;
  weakChannel: string;
  channelSummary: string;
  opportunityFor: string;
  analyzedAt: string;
  /** True when channelScores (and therefore dominantChannel/growingChannel/
   * weakChannel/channelSummary above) were derived from a SimilarWebData
   * record fetched with isEstimated:true — i.e. this whole verdict rests on
   * estimated/fallback traffic numbers, not a real SimilarWeb measurement.
   * Must be surfaced in the UI, not silently dropped. */
  isEstimated?: boolean;
}

// ── Alerts ──
export interface IntelAlert {
  id: string;
  type: "CHANNEL_SPIKE" | "TRAFFIC_SPIKE" | "SIMILARWEB_KEY_EXPIRED" | "NEW_AD_BURST";
  competitor: string;
  channel: string;
  changePercent: number;
  message: string;
  level: "low" | "medium" | "high";
  isRead: boolean;
  createdAt: string;
}

// ── Market Analysis (Gemini batch output) ──
export interface CompetitorHighlight {
  domain: string;
  strategy: string;
  threat: "low" | "medium" | "high";
}

export interface MarketAnalysis {
  marketOverview: string;
  dominantChannels: {
    channel: string;
    reason: string;
  };
  underinvestedChannels: string[];
  competitorHighlights: CompetitorHighlight[];
  opportunityForMBC: {
    bestChannel: string;
    reasoning: string;
    quickWin: string;
  };
  analyzedAt: string;
  /** Domains whose underlying SimilarWebData was isEstimated:true when this
   * batch analysis was generated — dominantChannels/marketOverview/
   * opportunityForMBC above were computed (or Gemini-summarized) partly or
   * fully from estimated/fallback traffic, not a real SimilarWeb fetch.
   * Empty/absent = every contributing domain had real data. */
  estimatedDomains?: string[];
}

// Facebook keywords for hosting/domain market
export const FB_KEYWORDS = [
  "tên miền", "domain", "hosting", "máy chủ",
  "email doanh nghiệp", "SSL", "cloud server",
  "đăng ký tên miền", "thuê hosting", "VPS",
];
