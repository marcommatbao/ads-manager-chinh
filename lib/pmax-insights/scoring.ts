// ─────────────────────────────────────────────
// PMax Insights 2.0 — deterministic scoring model
// Kept rule-based (not AI), same discipline as lib/policy-radar/
// impact-classifier.ts: severity/scores must be reproducible and
// auditable, so an admin can always trace WHY a campaign got a given
// score instead of trusting an opaque AI judgment call.
// ─────────────────────────────────────────────

import type { PMaxCampaignMetrics } from "@/lib/google-pmax-client";
import type { AssetCoverage, CampaignOverviewMetrics, CampaignScores, RecommendationStatus } from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

// ── Metrics + trend ──

export function computeOverviewMetrics(m: PMaxCampaignMetrics): CampaignOverviewMetrics {
  const roasRecent = m.spendRecent > 0 ? m.revenueRecent / m.spendRecent : 0;
  const roasTotal = m.spendTotal > 0 ? m.revenueTotal / m.spendTotal : 0;
  const ctrRecent = m.impressionsRecent > 0 ? (m.clicksRecent / m.impressionsRecent) * 100 : 0;
  const ctrTotal = m.impressionsTotal > 0 ? (m.clicksTotal / m.impressionsTotal) * 100 : 0;

  // Trend compares the recent half's run-rate against the PRIOR (earlier,
  // non-overlapping) half of the selected range — not against the whole
  // range's total, which fully CONTAINS the recent half being compared.
  // A recent-vs-whole-range comparison is self-referential: any real move
  // in the recent period automatically drags the baseline it's being
  // compared against toward it, understating the true trend. Both halves
  // already exist from the single date-range query, so this needs no
  // extra API call — just splits the total into its two non-overlapping
  // parts before comparing (confirmed live 2026-07-31, user-reported).
  const priorDays = Math.max(1, m.totalDays - m.recentDays);
  const perDayRecent = m.revenueRecent / m.recentDays;
  const priorRevenue = m.revenueTotal - m.revenueRecent;
  const perDayPrior = priorRevenue / priorDays;
  const rawTrendPct = perDayPrior > 0 ? ((perDayRecent - perDayPrior) / perDayPrior) * 100 : 0;

  // A prior period that's barely running (near-zero run-rate) makes the %
  // change mathematically real but practically meaningless — a campaign
  // going from ₫500/day to ₫15M/day reads as "+3,000,000%", which looks
  // like a bug and drowns out every other number on the card (confirmed
  // live 2026-07-31 — "MBC-Pmax-Google-Workspace" showed +59506.6%, user
  // flagged it as looking wrong). Flag it instead of hiding it — the UI
  // shows "mới có dữ liệu" rather than a giant misleading percentage, and
  // scoring clamps the magnitude so one degenerate ratio can't swing
  // trendScore/expansionReadiness by more than the intended ±50pts.
  const trendLowBaseline = perDayPrior > 0 && perDayPrior < perDayRecent * 0.05;
  const trendPct = Math.round(Math.max(-300, Math.min(300, rawTrendPct)) * 10) / 10;

  return {
    totalDays: m.totalDays, recentDays: m.recentDays,
    spendRecent: Math.round(m.spendRecent), spendTotal: Math.round(m.spendTotal),
    conversionsRecent: Math.round(m.conversionsRecent * 10) / 10, conversionsTotal: Math.round(m.conversionsTotal * 10) / 10,
    revenueRecent: Math.round(m.revenueRecent), revenueTotal: Math.round(m.revenueTotal),
    clicksRecent: m.clicksRecent, clicksTotal: m.clicksTotal,
    impressionsRecent: m.impressionsRecent, impressionsTotal: m.impressionsTotal,
    ctrRecent: Math.round(ctrRecent * 100) / 100, ctrTotal: Math.round(ctrTotal * 100) / 100,
    roasRecent: Math.round(roasRecent * 100) / 100, roasTotal: Math.round(roasTotal * 100) / 100,
    trendPct, trendLowBaseline,
    dailyBudgetVnd: m.dailyBudgetVnd,
  };
}

// ── Asset coverage ──

const IMAGE_TYPES = new Set(["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "PORTRAIT_MARKETING_IMAGE", "LOGO", "LANDSCAPE_LOGO"]);
const VIDEO_TYPES = new Set(["YOUTUBE_VIDEO", "VIDEO"]);

// Google's own minimums for a fully-served asset group — used as the
// "gap" threshold, not a hard requirement (PMax still serves below these,
// just with less creative variety for the algorithm to test).
const MIN_HEADLINES = 5;
const MIN_DESCRIPTIONS = 2;
const MIN_IMAGES = 1;

export function computeAssetCoverage(
  assets: { fieldType: string; primaryStatus: string }[],
  dataUnavailable = false,
): AssetCoverage {
  // Không đọc được dữ liệu thì KHÔNG kết luận gì về độ phủ. Trả về đúng trạng
  // thái "không biết" thay vì suy ra 4 lỗ hổng giả từ một mảng rỗng.
  if (dataUnavailable) {
    return {
      headlineCount: 0, descriptionCount: 0, imageCount: 0,
      videoCount: 0, logoCount: 0, notEligibleCount: 0,
      gaps: [], dataUnavailable: true,
    };
  }
  let headlineCount = 0, descriptionCount = 0, imageCount = 0, videoCount = 0, logoCount = 0, notEligibleCount = 0;

  for (const a of assets) {
    if (a.fieldType === "HEADLINE" || a.fieldType === "LONG_HEADLINE") headlineCount++;
    else if (a.fieldType === "DESCRIPTION" || a.fieldType === "LONG_DESCRIPTION") descriptionCount++;
    if (IMAGE_TYPES.has(a.fieldType)) imageCount++;
    if (a.fieldType === "LOGO" || a.fieldType === "LANDSCAPE_LOGO") logoCount++;
    if (VIDEO_TYPES.has(a.fieldType)) videoCount++;
    if (a.primaryStatus === "NOT_ELIGIBLE" || a.primaryStatus === "LIMITED") notEligibleCount++;
  }

  const gaps: string[] = [];
  if (headlineCount < MIN_HEADLINES) gaps.push(`Chỉ có ${headlineCount} headline (khuyến nghị ≥${MIN_HEADLINES})`);
  if (descriptionCount < MIN_DESCRIPTIONS) gaps.push(`Chỉ có ${descriptionCount} description (khuyến nghị ≥${MIN_DESCRIPTIONS})`);
  if (imageCount < MIN_IMAGES) gaps.push("Thiếu hình ảnh marketing");
  if (videoCount === 0) gaps.push("Thiếu video");
  if (notEligibleCount > 0) gaps.push(`${notEligibleCount} asset không đủ điều kiện hiển thị (NOT_ELIGIBLE/LIMITED)`);

  return { headlineCount, descriptionCount, imageCount, videoCount, logoCount, notEligibleCount, gaps };
}

// ── Performance Score ──
// Weighs: efficiency vs account-wide average ROAS (50%), trend direction
// (30%), business volume — more conversions = more real signal (20%).

export function computePerformanceScore(metrics: CampaignOverviewMetrics, avgRoasTotal: number): number {
  const roas = metrics.roasTotal;

  const efficiencyScore = avgRoasTotal > 0
    ? clamp((roas / avgRoasTotal) * 50)
    : (roas > 0 ? 50 : 0); // no portfolio baseline yet — neutral if this campaign at least converts

  const trendScore = clamp(50 + metrics.trendPct * 0.5, 0, 100); // +100% trend → +50 pts, -100% → -50 pts

  // 20+ conversions per 30 days = full volume credit — scaled to whatever
  // range the user actually picked instead of assuming a fixed 30 days.
  const volumeTarget = 20 * (metrics.totalDays / 30);
  const volumeScore = clamp((metrics.conversionsTotal / volumeTarget) * 100);

  return Math.round(efficiencyScore * 0.5 + trendScore * 0.3 + volumeScore * 0.2);
}

// ── Expansion Readiness Score ──
// Deliberately does NOT reward channel distribution breadth — a campaign
// dominant on one channel with strong business outcome is exactly as
// "ready" as one spread across many, per the product requirement that
// distribution dominance alone must never read as a win.

export function computeExpansionReadinessScore(
  performanceScore: number,
  coverage: AssetCoverage,
  trendPct: number
): number {
  const trendStabilityScore = trendPct >= -10 ? 100 : clamp(100 + (trendPct + 10) * 2); // tolerate small dips, penalize real decline

  // Không đọc được độ phủ thì bỏ hẳn thành phần đó ra khỏi công thức rồi chia
  // lại trọng số, thay vì gán bừa 100 (khen ẩu) hay 20 (phạt oan — đúng cái đã
  // làm campaign perf 70 tụt từ 85 xuống 61 và mất luôn nút tăng ngân sách).
  if (coverage.dataUnavailable) {
    return Math.round((performanceScore * 0.5 + trendStabilityScore * 0.2) / 0.7);
  }

  const coverageScore = clamp(100 - coverage.gaps.length * 20);
  return Math.round(performanceScore * 0.5 + coverageScore * 0.3 + trendStabilityScore * 0.2);
}

// ── Confidence Score ──
// Purely about whether there's ENOUGH signal to trust the two scores
// above — separate from whether the signal itself is good or bad.

export function computeConfidenceScore(metrics: CampaignOverviewMetrics): number {
  // Thresholds are ABSOLUTE, deliberately not scaled by window length.
  //
  // They used to be scaled (15 conversions "per 30 days"), which meant
  // asking for a shorter window also lowered the bar for being certain: an
  // 8-day range needed only ~4 conversions and ~80 clicks to score a flat
  // 100/100. Every card on the Advisor tab therefore read "Độ tin cậy 100%"
  // off a handful of conversions — the one number whose whole job is to say
  // "there isn't enough data yet" could not say it. Reliability comes from
  // how much data there is, not from how narrow a window was requested.
  const conversionVolumeScore = clamp((metrics.conversionsTotal / 15) * 100);
  const clickVolumeScore = clamp((metrics.clicksTotal / 300) * 100);
  const volumeScore = conversionVolumeScore * 0.7 + clickVolumeScore * 0.3;

  // PMax traffic has a weekly rhythm (weekday/weekend intent differs), so a
  // window shorter than two full weeks can be a good week or a bad week
  // rather than a trend, however much volume it holds. Short windows are
  // discounted rather than blocked: at 14+ days this is 1.0 and the score is
  // pure sample size.
  const windowFactor = clamp(metrics.totalDays / 14, 0, 1);

  return Math.round(volumeScore * windowFactor);
}

export function computeScores(
  metrics: CampaignOverviewMetrics,
  coverage: AssetCoverage,
  avgRoasTotal: number
): CampaignScores {
  const performance = computePerformanceScore(metrics, avgRoasTotal);
  const expansionReadiness = computeExpansionReadinessScore(performance, coverage, metrics.trendPct);
  const confidence = computeConfidenceScore(metrics);
  return { performance, expansionReadiness, confidence };
}

// ── Recommendation status ──

export function deriveRecommendationStatus(scores: CampaignScores): RecommendationStatus {
  if (scores.confidence < 30) return "review"; // not enough data to trust either score
  if (scores.performance < 35) return "review"; // weak business outcome — needs a human look regardless of distribution
  if (scores.performance >= 65 && scores.expansionReadiness >= 65 && scores.confidence >= 50) return "expand";
  if (scores.performance >= 65 && scores.expansionReadiness < 65) return "protect"; // good outcome, not creative/trend-ready to push harder
  return "test";
}
