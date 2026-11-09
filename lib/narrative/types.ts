// ============================================================
// Explainable AI — Narrative Layer Types
//
// NarrativeCard is the unit of human-readable briefing content.
// A NarrativeBriefing is a dated collection of cards per company.
// ============================================================

// ── Card tone & confidence ────────────────────────────────

export type NarrativeTone =
  | "confident"   // high confidence, positive outcome
  | "cautious"    // medium confidence or mixed signals
  | "urgent"      // degraded outcome requiring attention
  | "neutral"     // informational, no clear direction
  | "blocked";    // action was blocked, explanation needed

export type ConfidenceLabel = "high" | "medium" | "low" | "insufficient";

export interface ConfidenceCaveat {
  label:   ConfidenceLabel;
  message: string;    // Vietnamese caveat appended to explanation
}

// ── Supporting metric line ────────────────────────────────

export interface MetricLine {
  label:  string;     // e.g. "CPL"
  before: string;     // formatted Vietnamese number
  after:  string;
  delta:  string;     // e.g. "-12.3%" or "+5k lượt"
  trend:  "up" | "down" | "flat";
  good:   boolean;    // whether this direction is good
}

// ── Narrative card ────────────────────────────────────────

export type NarrativeCardType =
  | "recommendation"   // NBA recommendation summary
  | "outcome"          // evaluation result summary
  | "memory_signal"    // learning signal from decision memory
  | "safety_block"     // auto-apply was blocked
  | "improvement";     // general improvement suggestion

export interface NarrativeCard {
  id:             string;
  type:           NarrativeCardType;
  tone:           NarrativeTone;
  title:          string;          // short headline
  insight:        string;          // main body — 1–3 sentences Vietnamese
  metrics:        MetricLine[];    // supporting numbers
  confidenceCaveat?: string;       // appended if confidence is low
  actionHint?:    string;          // "what to do next" 1 sentence
  entityId?:      string;
  entityName?:    string;
  entityType?:    string;
  platform?:      string;
  company:        string;
  generatedAt:    string;          // ISO
  sourceId?:      string;          // recommendation/decision id
}

// ── Morning briefing ──────────────────────────────────────

export interface NarrativeBriefing {
  company:      string;
  date:         string;           // YYYY-MM-DD
  headline:     string;           // 1-liner summary of the day
  summary:      BriefingSummary;
  cards:        NarrativeCard[];
  generatedAt:  string;
}

export interface BriefingSummary {
  totalCards:          number;
  urgentCount:         number;
  positiveCount:       number;
  blockedAutoApply:    number;
  topOpportunity?:     string;
  topRisk?:            string;
}
