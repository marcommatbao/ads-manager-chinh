// ============================================================
// A/B Testing — Statistical Significance Engine (Facebook only)
// ============================================================
// Two ACTIVE ads sharing the same adset_id are a natural A/B split (same
// targeting/budget/schedule) — a real, comparable pair. calculateSignificance()
// below is a real pooled two-proportion z-test on conversion rate
// (conversions/clicks); it used to be fed hardcoded mock ABTestResult rows
// (product names, fake spend, fake win rates) instead of ever calling the
// real Meta API. This file now pulls real 14-day window-aggregate insights
// per ad, groups by adset_id, and runs the test only on genuine
// exactly-2-active-ad pairs — n-ary ad sets (1 or 3+ active ads) are outside
// this pass's scope and are counted, not silently dropped.

import { metaClient, type MetaAdInsightRaw, type MetaAdRaw } from "@/lib/meta-client";
import { detectCompany } from "@/lib/company-detect";

export interface ABTestVariant {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
}

export interface ABTestResult {
  adSetId: string;
  adSetName: string;
  campaignId: string;
  campaignName: string;
  company: string;
  variants: [ABTestVariant, ABTestVariant];
  winnerId: string;
  loserId: string;
  confidence: number;
  zScore: number;
  recommendation: string;
}

export interface ABTestScanResult {
  results: ABTestResult[];
  adSetPairsEvaluated: number;
  adSetsSkippedNotPair: number; // 1 active ad, or 3+ active ads — pairwise-only scope
  adSetsSkippedInsufficientData: number; // evaluated but not statistically significant
}

// Same conversion superset established in app/api/cpl/route.ts — omni_purchase
// is the real superset of purchase, using both double-counts.
const CONVERSION_ACTION_TYPES = new Set(["omni_purchase", "complete_registration"]);

function sumConversions(actions?: Array<{ action_type: string; value: string }>): number {
  return (actions ?? [])
    .filter((a) => CONVERSION_ACTION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + Number(a.value || 0), 0);
}

function last14DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 13);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { from: fmt(from), to: fmt(to) };
}

// Calculate Z-Score and Confidence Level for Conversion Rates.
// Variant A / Variant B are interchangeable — this is symmetric.
export function calculateSignificance(
  variantA: ABTestVariant,
  variantB: ABTestVariant
): { zScore: number; confidence: number; isSignificant: boolean } {
  if (variantA.clicks < 50 || variantB.clicks < 50) {
    return { zScore: 0, confidence: 0, isSignificant: false }; // Not enough data
  }

  const crA = variantA.conversions / variantA.clicks;
  const crB = variantB.conversions / variantB.clicks;

  const pooledCR = (variantA.conversions + variantB.conversions) / (variantA.clicks + variantB.clicks);

  const se = Math.sqrt(pooledCR * (1 - pooledCR) * ((1 / variantA.clicks) + (1 / variantB.clicks)));

  if (se === 0) return { zScore: 0, confidence: 0, isSignificant: false };

  const zScore = Math.abs((crB - crA) / se);

  let confidence = 0;
  if (zScore >= 2.576) confidence = 99;
  else if (zScore >= 1.96) confidence = 95;
  else if (zScore >= 1.645) confidence = 90;
  else if (zScore >= 1.28) confidence = 80;
  else confidence = Math.round(zScore * 30); // rough fallback for visual/logging only

  return {
    zScore,
    confidence: Math.min(confidence, 99.9),
    isSignificant: confidence >= 90, // 90% confidence threshold for action
  };
}

export async function scanForAbTests(
  company: string,
  dateRange: { from: string; to: string } = last14DaysRange()
): Promise<ABTestScanResult> {
  const [windowRows, adSets] = await Promise.all([
    metaClient.getAdInsightsWindowAggregate(dateRange),
    metaClient.getActiveAdSetsWithTargeting(),
  ]);
  const adSetNameById = new Map(adSets.map((s) => [s.id, s.name]));

  const companyRows = (windowRows as MetaAdInsightRaw[]).filter(
    (r) => r.adset_id && detectCompany(r.campaign_name) === company
  );

  const byAdSet = new Map<string, MetaAdInsightRaw[]>();
  for (const row of companyRows) {
    const list = byAdSet.get(row.adset_id) ?? [];
    list.push(row);
    byAdSet.set(row.adset_id, list);
  }

  const adIds = companyRows.map((r) => r.ad_id);
  const ads = await metaClient.getAdsByIds(adIds);
  const adById = new Map<string, MetaAdRaw>(ads.map((a) => [a.id, a]));

  const results: ABTestResult[] = [];
  let adSetPairsEvaluated = 0;
  let skippedNotPair = 0;
  let skippedInsufficientData = 0;

  for (const [adSetId, rows] of byAdSet) {
    // Only ads still ACTIVE — a fresh pause decision shouldn't be based on
    // an ad that's already paused (by a human or a prior run of this job).
    const activeRows = rows.filter((r) => adById.get(r.ad_id)?.status === "ACTIVE");
    if (activeRows.length !== 2) {
      skippedNotPair++;
      continue;
    }
    adSetPairsEvaluated++;

    const [a, b] = activeRows.map(
      (r): ABTestVariant => ({
        id: r.ad_id,
        name: r.ad_name || r.ad_id,
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        conversions: sumConversions(r.actions),
        spend: Number(r.spend || 0),
      })
    );

    const sig = calculateSignificance(a, b);
    if (!sig.isSignificant) {
      skippedInsufficientData++;
      continue;
    }

    const crA = a.clicks > 0 ? a.conversions / a.clicks : 0;
    const crB = b.clicks > 0 ? b.conversions / b.clicks : 0;
    const [winner, loser] = crB > crA ? [b, a] : [a, b];
    const [winnerCR, loserCR] = crB > crA ? [crB, crA] : [crA, crB];

    results.push({
      adSetId,
      adSetName: adSetNameById.get(adSetId) ?? adSetId,
      campaignId: rows[0].campaign_id,
      campaignName: rows[0].campaign_name,
      company,
      variants: [a, b],
      winnerId: winner.id,
      loserId: loser.id,
      confidence: sig.confidence,
      zScore: sig.zScore,
      recommendation: `"${winner.name}" có tỷ lệ chuyển đổi cao hơn rõ rệt (${(winnerCR * 100).toFixed(1)}% vs ${(loserCR * 100).toFixed(1)}%) với độ tin cậy ${sig.confidence}%.`,
    });
  }

  return {
    results,
    adSetPairsEvaluated,
    adSetsSkippedNotPair: skippedNotPair,
    adSetsSkippedInsufficientData: skippedInsufficientData,
  };
}
