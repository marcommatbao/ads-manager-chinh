// ─────────────────────────────────────────────
// Competitor Ad Tracker — Types & Config
// ─────────────────────────────────────────────

import { metaAccountIds } from "@/lib/meta-accounts";

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  fbPageId: string;
  category: string;
  trackingFor: (string)[];
  isActive: boolean;
  addedAt: string; // ISO date
}

export interface CompetitorAd {
  id: string;
  fbAdId: string;
  competitorId: string;
  competitorName: string;

  // Content
  primaryText: string | null;
  headline: string | null;
  description: string | null;
  snapshotUrl: string | null;

  // Targeting
  targetAges: string | null;
  targetGender: string | null;
  languages: string[];

  // Performance (range from FB)
  spendMin: number | null;
  spendMax: number | null;
  impressionsMin: number | null;
  impressionsMax: number | null;

  // Timing
  startDate: string | null;
  stopDate: string | null;
  isActive: boolean;

  // AI Analysis
  aiHook: string | null;
  aiAngle: string | null;
  aiScore: number | null;
  aiInsight: AdAnalysis | null;
  analyzedAt: string | null;

  fetchedAt: string;
}

export interface AdAnalysis {
  strengths: string[];
  weaknesses: string[];
  targetAudience: string;
}

export interface GapInsight {
  gapOpportunities: string[];
  dominantAngles: string[];
  avoidAngles: string[];
  recommendations: string[];
  urgentAlert: string | null;
}

export interface CompetitorInsight {
  competitorId: string;
  weekOf: string;
  totalActiveAds: number;
  newAdsThisWeek: number;
  topAngles: string[];
  gapAnalysis: GapInsight | null;
  createdAt: string;
}

// Default seed competitors — users can add/remove via UI
export const DEFAULT_COMPETITORS: Competitor[] = [
  {
    id: "matbao",
    name: "Mắt Bão",
    domain: "matbao.com",
    fbPageId: metaAccountIds("MBC").pageId,
    category: "domain_hosting",
    trackingFor: ["MBC"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
  {
    id: "pa",
    name: "P.A Việt Nam",
    domain: "pavietnam.vn",
    fbPageId: "100063892177434",
    category: "domain_hosting",
    trackingFor: ["MBC", "MBI"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
  {
    id: "inet",
    name: "INET",
    domain: "inet.vn",
    fbPageId: "100064546785586",
    category: "domain_hosting",
    trackingFor: ["MBC", "MBI"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
  {
    id: "vietnix",
    name: "Vietnix",
    domain: "vietnix.vn",
    fbPageId: "100064097710455",
    category: "hosting",
    trackingFor: ["MBC"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
  {
    id: "azdigi",
    name: "Azdigi",
    domain: "azdigi.com",
    fbPageId: "100063636095462",
    category: "hosting",
    trackingFor: ["MBC", "MBI"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
  {
    id: "nhanhoa",
    name: "Nhân Hòa",
    domain: "nhanhoa.com",
    fbPageId: "100080490603513",
    category: "domain_hosting",
    trackingFor: ["MBC", "MBI"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
  {
    id: "tenten",
    name: "Tenten",
    domain: "tenten.vn",
    fbPageId: "100064824665442",
    category: "domain_hosting",
    trackingFor: ["MBC", "MBI"],
    isActive: true,
    addedAt: new Date().toISOString(),
  },
];

export const AD_ANGLES = [
  "FOMO",
  "Price",
  "Feature",
  "Social Proof",
  "Emotion",
  "Authority",
  "Urgency",
  "ROI",
  "Problem-Solution",
  "Story",
] as const;

export type AdAngle = (typeof AD_ANGLES)[number];

export function extractFBPageId(input: string): string {
  // Handle full URL like https://www.facebook.com/pavietnamvn or page ID directly
  if (/^\d+$/.test(input.trim())) return input.trim();
  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] || input;
  } catch {
    return input.trim();
  }
}
