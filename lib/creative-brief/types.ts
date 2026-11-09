// ============================================================
// Creative Brief Builder — Core Types
// ============================================================

import type { AudienceSegment } from "@/app/(dashboard)/creative/_types";

export type BriefCompany = string;
export type BriefPlatform = "facebook" | "google" | "both";
export type BriefObjective = "awareness" | "consideration" | "conversion" | "retention";
export type BriefFunnelStage = "top" | "mid" | "bottom";

// Canonical product keys (union of PRODUCTS_KB keys + MBI catalog keys)
export type ProductKey =
  | "ten-mien" | "hosting" | "vibe-hosting" | "google-workspace" | "microsoft-365"
  | "chu-ky-so" | "hoa-don-dien-tu" | "khoa-hoc-thue" | "sale-ai"
  | "hop-dong-dien-tu" | "hoa-don-ecom" | "email-dn" | "ssl"
  | "custom";

// ── Input ────────────────────────────────────────────────────

export interface BriefInput {
  company:       BriefCompany;
  platform:      BriefPlatform;
  product:       ProductKey;
  objective:     BriefObjective;
  funnelStage:   BriefFunnelStage;

  selectedSegments:   AudienceSegment[];
  customAudienceNote?: string;

  landingPageUrl?:    string;
  promotionContext?:  {
    label:       string;
    discountPct?: number;
    endsAt?:     string;
  };

  launchConstraints?: {
    dailyBudgetVnd?:  number;
    durationDays?:    number;
    geoTarget?:       string[];
    deviceTarget?:    "all" | "mobile" | "desktop";
  };

  overrides?: {
    tone?:     string;
    mainUsp?:  string;
    cta?:      string;
  };
}

// ── Sub-types ─────────────────────────────────────────────────

export interface PainPoint {
  text:     string;
  severity: "critical" | "moderate";
  source:   "product-kb" | "segment" | "competitor";
}

export interface ProofPoint {
  type: "stat" | "social" | "award" | "case";
  text: string;
}

export interface ToneStrategy {
  primaryTone:     string;
  secondaryTone?:  string;
  voiceGuidance:   string;
  avoid:           string[];
}

export interface CtaStrategy {
  primaryCta:    string;
  softCta?:      string;
  urgencyFrame:  "none" | "soft" | "hard";
  intent:        string;
}

export interface MetaConfig {
  adFormats:           string[];
  hookFrame:           string;
  emotionalAnchor:     string;
  textLengthGuidance:  { headline: string; primary: string; description: string };
  visualDirection:     string;
}

export interface GoogleConfig {
  searchIntents:          string[];
  headlineAngles:         string[];
  descriptionFocus:       string;
  extensionSuggestions:   { type: string; examples: string[] }[];
  keywordDensityNote:     string;
}

export interface ComplianceNote {
  severity:   "block" | "warn";
  rule:       string;
  suggestion: string;
}

export interface AudienceSummary {
  primaryPersona:  string;
  size:            "broad" | "narrow" | "niche";
  topPainPoints:   string[];
  motivators:      string[];
  sophistication:  "beginner" | "intermediate" | "expert";
}

// ── Output ───────────────────────────────────────────────────

export interface CreativeBrief {
  id:           string;
  generatedAt:  string;
  company:      BriefCompany;
  platform:     BriefPlatform;
  product:      { key: ProductKey; displayName: string; category: string };
  objective:    BriefObjective;
  funnelStage:  BriefFunnelStage;

  audienceSummary:   AudienceSummary;
  painPoints:        PainPoint[];
  usp:               string;
  valueProposition:  string;
  proofPoints:       ProofPoint[];

  toneStrategy:  ToneStrategy;
  ctaStrategy:   CtaStrategy;

  metaConfig?:    MetaConfig;
  googleConfig?:  GoogleConfig;

  complianceNotes:  ComplianceNote[];
  sensitiveTerms:   string[];

  /** Đợt 7b — mẫu đã thắng/đã thua lấy từ Sổ kinh nghiệm (định dạng, câu mở, tiêu đề,
   *  chủ đề tìm kiếm). Chỉ để THAM KHẢO khi viết — không tự chép vào nội dung. */
  playbookReferences?: {
    entryId:    string;
    platform:   "facebook" | "google";
    direction:  "use" | "avoid";
    kind:       string;
    text:       string;
    why:        string;
    confidence: "high" | "medium";
  }[];

  landingPageContext?: {
    url:               string;
    inferredPageType?: string;
    alignment:         "good" | "mismatch" | "unknown";
    notes?:            string;
  };

  promotionContext?: {
    label:           string;
    discountPct?:    number;
    endsAt?:         string;
    ctaUrgencyBoost: boolean;
  };

  launchConstraints?: {
    dailyBudgetVnd?: number;
    durationDays?:   number;
    geoTarget?:      string[];
    deviceTarget?:   string;
    budgetGuidance?: string;
  };
}

// Store draft shape
export interface BriefDraft {
  id:          string;
  name:        string;
  input:       BriefInput;
  output?:     CreativeBrief;
  createdAt:   string;
  updatedAt:   string;
}
