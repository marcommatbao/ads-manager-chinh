// ============================================================
// Segment Performance — Daily metrics updater + scoring
// Called by cron job to update segment performance from FB API
// ============================================================

import {
  getAllSegments,
  getUsagesForSegment,
  updateSegment,
  type AudienceSegmentRecord,
  type CampaignUsageRecord,
} from "./audience-tracker";

// ── CPL Thresholds by company ──

const CPL_THRESHOLDS: Record<string, number> = {
  MBC: 99000,
  MBI: 250000,
};

// ── Segment Score Calculator ──

/**
 * Calculate a composite score (0-100) for a segment.
 * Components:
 *   - CPL efficiency:  max 40 points
 *   - Win rate:        max 25 points
 *   - Trend:           max 20 points  (CPL improving?)
 *   - Sample size:     max 15 points
 */
export function calculateSegmentScore(
  segment: AudienceSegmentRecord,
  usages: CampaignUsageRecord[]
): number {
  const usagesWithCpl = usages.filter((u) => u.cpl != null && u.cpl > 0);
  if (usagesWithCpl.length === 0) return 0;

  const company = segment.company;
  const threshold = CPL_THRESHOLDS[company] ?? 150000;

  // Weighted CPL (by spend)
  const totalSpend = usagesWithCpl.reduce((s, u) => s + (u.spend ?? 0), 0);
  const weightedCpl =
    totalSpend > 0
      ? usagesWithCpl.reduce((s, u) => s + (u.cpl ?? 0) * (u.spend ?? 0), 0) / totalSpend
      : usagesWithCpl.reduce((s, u) => s + (u.cpl ?? 0), 0) / usagesWithCpl.length;

  // 1. CPL score (max 40): lower CPL = higher score
  const cplRatio = weightedCpl / threshold;
  const cplScore = Math.max(0, Math.min(40, 40 * (1 - cplRatio)));

  // 2. Win rate score (max 25)
  const winCount = usagesWithCpl.filter((u) => u.metKpi).length;
  const winRate = winCount / usagesWithCpl.length;
  const winScore = winRate * 25;

  // 3. Trend score (max 20): is CPL improving?
  const trendScore = calcTrendScore(usagesWithCpl);

  // 4. Sample size score (max 15): more data = more reliable
  const sampleScore = Math.min(15, usagesWithCpl.length * 1.25);

  return Math.round(Math.min(100, cplScore + winScore + trendScore + sampleScore));
}

/**
 * Calculate trend: is CPL getting better or worse over time?
 */
function calcTrendScore(usages: CampaignUsageRecord[]): number {
  if (usages.length < 2) return 10; // neutral

  const sorted = usages
    .filter((u) => u.cpl != null)
    .sort((a, b) => new Date(a.usedAt).getTime() - new Date(b.usedAt).getTime());

  if (sorted.length < 2) return 10;

  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const avgFirst =
    firstHalf.reduce((s, u) => s + (u.cpl ?? 0), 0) / firstHalf.length;
  const avgSecond =
    secondHalf.reduce((s, u) => s + (u.cpl ?? 0), 0) / secondHalf.length;

  if (avgFirst === 0) return 10;

  const improvement = (avgFirst - avgSecond) / avgFirst;

  if (improvement > 0.15) return 20; // CPL giảm > 15% → excellent
  if (improvement > 0.05) return 15; // CPL giảm 5-15% → good
  if (improvement > 0) return 10; // CPL giảm nhẹ → neutral
  return 5; // CPL tăng → warning
}

/**
 * Get score badge based on score.
 */
export function getScoreBadge(score: number): {
  label: string;
  emoji: string;
  color: string;
} {
  if (score >= 80) return { label: "Top Performer", emoji: "🏆", color: "green" };
  if (score >= 60) return { label: "Hiệu quả", emoji: "⭐", color: "blue" };
  if (score >= 40) return { label: "Trung bình", emoji: "📊", color: "yellow" };
  return { label: "Cần xem lại", emoji: "⚠️", color: "red" };
}

// ── Recalculate stats for a single segment ──

export function recalculateSegmentStats(segmentId: string): AudienceSegmentRecord | null {
  const usages = getUsagesForSegment(segmentId);
  if (usages.length === 0) return null;

  const usagesWithCpl = usages.filter((u) => u.cpl != null);

  // Weighted average CPL
  const totalSpend = usages.reduce((s, u) => s + (u.spend ?? 0), 0);
  const weightedCpl =
    totalSpend > 0 && usagesWithCpl.length > 0
      ? usagesWithCpl.reduce((s, u) => s + (u.cpl ?? 0) * (u.spend ?? 0), 0) / totalSpend
      : usagesWithCpl.length > 0
      ? usagesWithCpl.reduce((s, u) => s + (u.cpl ?? 0), 0) / usagesWithCpl.length
      : null;

  const ctrVals = usages.filter((u) => u.ctr != null).map((u) => u.ctr!);
  const avgCtr = ctrVals.length > 0 ? ctrVals.reduce((a, b) => a + b, 0) / ctrVals.length : null;

  const freqVals = usages.filter((u) => u.frequency != null).map((u) => u.frequency!);
  const avgFreq = freqVals.length > 0 ? freqVals.reduce((a, b) => a + b, 0) / freqVals.length : null;

  const winCount = usages.filter((u) => u.metKpi).length;

  // Get full segment for score calculation
  const segments = getAllSegments();
  const segment = segments.find((s) => s.id === segmentId);
  if (!segment) return null;

  const segmentScore = calculateSegmentScore(segment, usages);

  return updateSegment(segmentId, {
    totalCampaigns: usages.length,
    avgCpl: weightedCpl,
    avgCtr: avgCtr,
    avgFrequency: avgFreq,
    totalSpend,
    winCount,
    segmentScore,
  });
}

// ── Recalculate ALL segments (for cron) ──

export function recalculateAllSegmentStats(): {
  updated: number;
  total: number;
} {
  const segments = getAllSegments();
  let updated = 0;

  for (const segment of segments) {
    if (segment.totalCampaigns > 0) {
      const result = recalculateSegmentStats(segment.id);
      if (result) updated++;
    }
  }

  console.log(`📊 Segment stats recalculated: ${updated}/${segments.length}`);
  return { updated, total: segments.length };
}

// ── Auto-save segment from launch config ──

/**
 * Auto-save a segment to the library during campaign launch.
 * If a matching segment exists (same name + company + funnel), returns existing ID.
 * Otherwise creates a new record.
 */
export function autoSaveSegmentFromLaunch(
  segment: {
    segmentName: string;
    funnelStage: string;
    demographics: {
      ageMin: number;
      ageMax: number;
      gender: string;
      locations: string[];
    };
    interests: string[];
    behaviors: string[];
    jobTitles?: string[];
    excludeAudiences?: string[];
  },
  config: {
    company: string;
    objectiveKey?: string;
    objective?: string;
    campaignName?: string;
  },
  product: string
): string {
  const segments = getAllSegments();

  // Check for existing match
  const existing = segments.find(
    (s) =>
      s.name === segment.segmentName &&
      s.company === config.company &&
      s.funnelStage === segment.funnelStage
  );

  if (existing) return existing.id;

  // Create new segment
  const { saveSegment } = require("./audience-tracker");
  const created = saveSegment({
    name: segment.segmentName,
    company: config.company as string,
    product,
    funnelStage: segment.funnelStage as "TOFU" | "MOFU" | "BOFU",
    objective: config.objectiveKey ?? config.objective ?? "",
    demographics: {
      age: `${segment.demographics.ageMin}-${segment.demographics.ageMax}`,
      gender: segment.demographics.gender === "all" ? "Tất cả" : segment.demographics.gender,
      location: segment.demographics.locations,
      income: "",
    },
    interests: segment.interests,
    behaviors: segment.behaviors,
    jobTitles: segment.jobTitles ?? [],
    exclusions: segment.excludeAudiences ?? [],
    painPoints: [],
    buyingTriggers: [],
    messageHook: "",
    triggerMoment: "",
    estimatedSize: "",
    predictedCtr: "",
    predictedCpl: null,
    createdBy: "auto_launch",
    tags: ["auto-saved"],
    priority: 1,
  });

  console.log(`📦 Auto-saved segment to library: ${created.name} → ${created.id}`);
  return created.id;
}
