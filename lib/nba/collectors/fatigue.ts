// ============================================================
// NBA collector — Creative fatigue
// Nguồn: lib/fatigue-detector.quickFatigueCheck (benchmark theo objective).
// Emit: CREATIVE_FATIGUE.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import { quickFatigueCheck } from "@/lib/fatigue-detector";
import type { NbaSignal, NbaContext } from "../types";
import { detectCompany, platformOf, isActive } from "./helpers";

export function fatigueCollector(campaigns: Campaign[], ctx: NbaContext): NbaSignal[] {
  const allowed = new Set(ctx.companies);
  const out: NbaSignal[] = [];

  for (const c of campaigns) {
    if (!isActive(c)) continue;
    const company = detectCompany(c);
    if (!company || !allowed.has(company)) continue;

    let analysis;
    try {
      analysis = quickFatigueCheck(c);
    } catch {
      continue; // thiếu metric → bỏ qua
    }

    if (analysis.fatigueLevel !== "fatigued" && analysis.fatigueLevel !== "critical") continue;

    const spend = c.metrics.spend ?? 0;
    out.push({
      reasonCode: "CREATIVE_FATIGUE",
      company,
      platform: platformOf(c),
      entityType: "creative",
      entityId: c.id,
      entityName: c.name,
      title: `Creative "${c.name}" mệt mỏi (score ${analysis.fatigueScore}/100)`,
      explanation: analysis.recommendedAction || "Creative có dấu hiệu mệt mỏi — cân nhắc làm mới nội dung/đổi hình.",
      evidence: [
        { metric: "fatigueScore", current: analysis.fatigueScore, unit: "" },
        { metric: "frequency", current: Math.round((c.metrics.frequency ?? 0) * 100) / 100, unit: "" },
        { metric: "ctr", current: Math.round((c.metrics.ctr ?? 0) * 100) / 100, unit: "%" },
      ],
      severity: analysis.fatigueLevel === "critical" ? "critical" : "warning",
      sampleSize: c.metrics.clicks ?? 0,
      impactEstimate: { metric: "spend", direction: "reduce_waste", estMonthlySavingsVnd: Math.round(spend * 0.15) },
      suggestedAction: { type: "REFRESH_CREATIVE" },
      sourceEngine: "fatigue-detector",
      _guardCampaign: c,
    });
  }

  return out;
}
