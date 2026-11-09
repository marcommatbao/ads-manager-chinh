// ============================================================
// Ads Content — Creative Badge Inference
// ============================================================
// Reuses existing rule-based engines instead of inventing new
// thresholds:
//  - Learning/New: lib/campaign-health.ts:getLearningStatus (same
//    function CampaignTable.tsx's getCampaignHealthBadge calls).
//    Facebook only — Google campaigns have no reliable creation
//    date in this pipeline (same precedent as getCampaignHealthBadge's
//    own "Google has no startDate, skip learning classification").
//    conversions is not tracked per-creative here, so we pass a
//    sentinel (+Infinity) that makes getLearningStatus fall through
//    to its pure age-based tiers ("new" < 3d, "learning" < 7d) and
//    never claim the conversion-gated "learning_limited" tier —
//    honest about what we can't measure instead of faking a number.
//  - Best / Low CTR: same ctr>2 / (ctr<0.5 && impressions>5000)
//    thresholds as CampaignTable.tsx:getCampaignHealthBadge.

import { getLearningStatus } from "@/lib/campaign-health";
import type { FatigueResult } from "@/lib/ad-fatigue-engine";
import type { CreativeSourcePlatform, CreativeMetrics } from "@/types/creative-content.types";

interface BadgeInput {
  platform: CreativeSourcePlatform;
  metrics: CreativeMetrics;
  campaignCreatedTime?: string;
  // Real period-over-period fatigue check (lib/ads-content/fatigue.ts),
  // Facebook only — the only platform with real per-ad window insight
  // data in this pipeline.
  fatigue?: FatigueResult;
}

export function computeCreativeBadges({ platform, metrics, campaignCreatedTime, fatigue }: BadgeInput): string[] {
  const badges: string[] = [];

  if (platform === "facebook" && campaignCreatedTime) {
    const learning = getLearningStatus({
      created_time: campaignCreatedTime,
      metrics: { conversions: Number.POSITIVE_INFINITY },
    });
    if (learning.badge) badges.push(learning.badge);
  }

  if (metrics.metricsAvailable && typeof metrics.ctr === "number") {
    if (metrics.ctr > 2) {
      badges.push("✅ Best");
    } else if (metrics.ctr < 0.5 && (metrics.impressions ?? 0) > 5000) {
      badges.push("🟡 CTR thấp");
    }
  }

  if (fatigue?.severity === "critical") {
    badges.push("🔴 Mệt — Cần refresh");
  } else if (fatigue?.severity === "warning") {
    badges.push("😴 Có dấu hiệu mệt");
  }

  return badges;
}
