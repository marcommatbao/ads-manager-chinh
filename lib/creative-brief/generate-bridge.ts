// ============================================================
// Creative Brief → Generate-Text Bridge
//
// Maps a CreativeBrief (structured intent) into concrete
// GenerateTextRequest objects ready to POST to
// /api/creative/generate-text — one per platform × tone variant.
//
// Also exposes checkBriefAlignment() so the UI can show how
// well a generated CreativeResult matches the original brief.
// ============================================================

import type { CreativeBrief } from "./types";

// ── Request type mirroring /api/creative/generate-text body ──

export interface BriefGenerateRequest {
  product:     string;
  segment:     string;
  segmentName: string;
  funnelStage: string;
  tone:        string;
  toneLabel:   string;
  usp?:        string;
  socialProof?: string;
  offer?:      string;
  platform:    "facebook" | "google";
  objective?:  string;
  briefId:     string;
}

// ── Alignment result ──────────────────────────────────────────

export interface BriefAlignmentResult {
  /** 0-100 composite alignment score */
  score: number;
  toneMatch:       boolean;
  ctaMatch:        boolean;
  lengthCompliant: boolean;
  /** Terms from brief.toneStrategy.avoid found in creative text */
  avoidViolations: string[];
  notes: string[];
}

// ── Internal maps ─────────────────────────────────────────────

const FUNNEL_MAP: Record<string, string> = {
  top:    "TOFU",
  mid:    "MOFU",
  bottom: "BOFU",
};

const OBJECTIVE_LABEL: Record<string, string> = {
  awareness:     "Brand awareness",
  consideration: "Traffic / consideration",
  conversion:    "Lead generation / conversion",
  retention:     "Retention / upsell",
};

// ── Main export: brief → generate requests ────────────────────

/**
 * Build the array of generate-text API requests implied by a brief.
 * Returns one request per (platform × tone) combination:
 *   - "both" platform → facebook + google
 *   - primaryTone always included; secondaryTone added if present
 */
export function buildGenerateRequests(brief: CreativeBrief): BriefGenerateRequest[] {
  const platforms: Array<"facebook" | "google"> =
    brief.platform === "both"     ? ["facebook", "google"] :
    brief.platform === "facebook" ? ["facebook"]           : ["google"];

  const tones: Array<{ tone: string; toneLabel: string }> = [
    { tone: brief.toneStrategy.primaryTone, toneLabel: brief.toneStrategy.primaryTone },
  ];
  if (brief.toneStrategy.secondaryTone) {
    tones.push({
      tone:      brief.toneStrategy.secondaryTone,
      toneLabel: brief.toneStrategy.secondaryTone,
    });
  }

  // Segment = persona + top pain points (gives AI rich audience context)
  const segment = [
    brief.audienceSummary.primaryPersona,
    ...brief.audienceSummary.topPainPoints.slice(0, 2),
  ].join(". ");

  const socialProof = brief.proofPoints
    .slice(0, 2)
    .map(p => p.text)
    .join(". ") || undefined;

  const offer = brief.promotionContext
    ? [
        brief.promotionContext.label,
        brief.promotionContext.discountPct
          ? `giảm ${brief.promotionContext.discountPct}%`
          : null,
        brief.promotionContext.endsAt
          ? `HSD ${brief.promotionContext.endsAt}`
          : null,
      ].filter(Boolean).join(" — ")
    : undefined;

  const requests: BriefGenerateRequest[] = [];

  for (const platform of platforms) {
    for (const { tone, toneLabel } of tones) {
      requests.push({
        product:     brief.product.displayName,
        segment,
        segmentName: brief.audienceSummary.primaryPersona,
        funnelStage: FUNNEL_MAP[brief.funnelStage] ?? "TOFU",
        tone,
        toneLabel,
        usp:         brief.usp || undefined,
        socialProof,
        offer,
        platform,
        objective:   OBJECTIVE_LABEL[brief.objective] ?? "Lead generation",
        briefId:     brief.id,
      });
    }
  }

  return requests;
}

// ── Alignment check: brief intent vs generated creative ───────

/**
 * Score how well a generated creative matches the brief it came from.
 * Useful for surfacing "brief mismatches" in the UI before launching.
 *
 * @param brief   - The source CreativeBrief
 * @param result  - The generated creative (subset of CreativeResult)
 */
export function checkBriefAlignment(
  brief: CreativeBrief,
  result: {
    tone:        string;
    cta:         string;
    headline:    string;
    description: string;
    primaryText: string;
    platform:    "facebook" | "google";
  }
): BriefAlignmentResult {
  let score = 0;
  const notes: string[] = [];

  // ── Tone match (30 pts) ──────────────────────────────────────
  const toneMatch =
    result.tone === brief.toneStrategy.primaryTone ||
    result.tone === brief.toneStrategy.secondaryTone;
  if (toneMatch) {
    score += 30;
  } else {
    notes.push(`Tone "${result.tone}" không khớp brief (${brief.toneStrategy.primaryTone})`);
  }

  // ── CTA match (20 pts) ───────────────────────────────────────
  const briefCtaL  = brief.ctaStrategy.primaryCta.toLowerCase();
  const resultCtaL = result.cta.toLowerCase();
  // Semantic match: either substring or shared trigger keyword
  const TRIGGER_PAIRS = [
    ["đăng ký", "đăng ký"],
    ["liên hệ", "liên hệ"],
    ["mua",     "mua"],
    ["nhận",    "nhận"],
    ["tải",     "download"],
    ["sign up", "sign up"],
  ] as const;
  const ctaMatch =
    resultCtaL.includes(briefCtaL) ||
    briefCtaL.includes(resultCtaL) ||
    TRIGGER_PAIRS.some(([a, b]) => briefCtaL.includes(a) && resultCtaL.includes(b));
  if (ctaMatch) {
    score += 20;
  } else {
    notes.push(`CTA "${result.cta}" khác brief ("${brief.ctaStrategy.primaryCta}")`);
  }

  // ── Avoid-term violations (30 pts, -10 per violation) ────────
  const allText = `${result.headline} ${result.primaryText} ${result.description}`.toLowerCase();
  const avoidViolations = brief.toneStrategy.avoid.filter(term =>
    allText.includes(term.toLowerCase())
  );
  const avoidScore = Math.max(0, 30 - avoidViolations.length * 10);
  score += avoidScore;
  if (avoidViolations.length > 0) {
    notes.push(
      `Dùng "${avoidViolations.join('", "')}" — brief yêu cầu tránh`
    );
  }

  // ── Platform length compliance (20 pts) ─────────────────────
  const maxHeadline = result.platform === "google" ? 30 : 40;
  const maxDesc     = result.platform === "google" ? 90 : 30;
  const headlineOk  = result.headline.length   <= maxHeadline;
  const descOk      = result.description.length <= maxDesc;
  const lengthCompliant = headlineOk && descOk;
  if (lengthCompliant) {
    score += 20;
  } else {
    if (!headlineOk)
      notes.push(`Headline ${result.headline.length} ký tự > ${maxHeadline} (giới hạn ${result.platform})`);
    if (!descOk)
      notes.push(`Description ${result.description.length} ký tự > ${maxDesc} (giới hạn ${result.platform})`);
  }

  return { score, toneMatch, ctaMatch, lengthCompliant, avoidViolations, notes };
}
