// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SampleAd {
  primaryText: string;
  headline: string;
  cta: string;
}

export interface AudienceSegment {
  segmentName: string;
  size: string;
  priority: number;
  funnelStage?: "TOFU" | "MOFU" | "BOFU";
  demographics: {
    age: string;
    gender: string;
    location: string[];
    income: string;
    jobTitles?: string[];
  };
  psychographics?: {
    interests: string[];
    behaviors: string[];
    jobTitles: string[];
  };
  facebookTargeting?: {
    interests: string[];
    behaviors: string[];
    jobTitles?: string[];
    excludeAudiences: string[];
  };
  /** Bộ nhắm mục tiêu của Google Ads. Chỉ có khi Bước 1 chọn Nền tảng =
   *  google/both — Google KHÔNG nhắm bằng interest/behavior như Meta:
   *  Search nhắm bằng TỪ KHOÁ, PMax bằng audience signal. */
  googleTargeting?: {
    /** Câu người dùng thật sự gõ vào Google, tiếng Việt có dấu. */
    searchIntents?: string[];
    /** Từ khoá phải loại để không hiện cho người không mua. */
    negativeKeywords?: string[];
    /** Gợi ý tệp cho Performance Max (in-market / affinity / custom segment). */
    audienceSignals?: string[];
  };
  customAudienceSuggestions?: string[];
  estimatedAudienceSize?: string;
  painPoints: string[];
  buyingTriggers?: string[];
  messagingAngle?: string;
  estimatedCTR: string;
  difficulty?: string;
  // V2 fields
  triggerMoment?: string;
  messageHook?: string;
  competitionLevel?: "low" | "medium" | "high";
  whyThisSegment?: string;
  // V3 fields
  emotionalDriver?: string;
  recommendedTones?: string[];
  sampleAd?: SampleAd;
}

export interface CompetitorAnalysisItem {
  competitor: string;
  threatLevel: "low" | "medium" | "high";
  marketPosition: string;
  adsAngle: string;
  weaknesses: string[];
  strengths: string[];
  theirTargetAudience?: {
    interests: string[];
    behaviors: string[];
    estimatedAdSpend: string;
  };
  stealStrategy: string;
  counterMessage: string;
  dataSource: string;
}


export interface CampaignStrategy {
  bestTimeToRun: {
    daysOfWeek: string[];
    timeOfDay: string;
    reasoning: string;
  };
  budgetRecommendation: {
    minimumDaily: number;
    optimalDaily: number;
    reasoning: string;
  };
  adFormats?: string[];
  campaignStructure?: string;
}

export interface MetaAudience {
  id: string;
  name: string;
  type: string;
  size: number;
  sizeMax: number;
  createdAt: string | null;
  status: string;
}

export interface AudienceInsightData {
  audienceSegments: AudienceSegment[];
  competitorInsights?: {
    weaknesses: string[];
    differentiators: string[];
    avoidTopics: string[];
  };
  // competitorIntelligence đã GỠ 16/09/2026 (xem creative/page.tsx).
  bestTimeToRun?: {
    daysOfWeek: string[];
    timeOfDay: string;
    reasoning: string;
  };
  budgetRecommendation?: {
    minimumDaily: number;
    optimalDaily: number;
    reasoning: string;
  };
  campaignStrategy?: CampaignStrategy;
}

/** Hồ sơ thương hiệu của một công ty — GET /api/creative/brand?company=… */
export interface BrandProduct { id: string; label: string; description?: string; url?: string }
export interface BrandData {
  company: string;
  /** true = công ty bản Mắt Bão (MBC/MBI): giữ nguyên hằng số cũ, `products` rỗng. */
  legacy: boolean;
  hasProfile: boolean;
  brandName: string;
  domain: string;
  persona: string;
  strengths: string[];
  tone?: string;
  forbidden: string[];
  products: BrandProduct[];
}
