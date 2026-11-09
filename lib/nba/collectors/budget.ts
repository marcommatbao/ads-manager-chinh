// ============================================================
// NBA collector — Budget (campaign-level heuristics)
// Emit: SCALE_WINNER (auto-apply eligible) / LOW_ROAS_REVIEW (advisory).
// Lưu ý slice-1: heuristic cấp campaign, chưa nối budget-monitor monthly config.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { NbaSignal, NbaContext, NbaSeverity } from "../types";
import { detectCompany, platformOf, isActive } from "./helpers";

const SCALE_ROAS = 3.0;
const SCALE_MIN_CONV = 10;
const LOW_ROAS = 0.8;
const LOW_ROAS_MIN_SPEND = 100_000;

// SCALE_WINNER severity reflects how strong the winning signal actually is
// (ROAS margin above the eligibility threshold + conversion volume) — same
// idea as classifyCPL()/quickFatigueCheck() tiering into critical/warning
// for the other collectors. scoreConfidence() (scoring.ts) derives its
// confidence purely from severity + prior, so a hardcoded "info" here would
// cap confidence at 60 for EVERY scale-winner, no matter how clear-cut —
// permanently below the 75-point auto-apply floor. Borderline winners (just
// clearing SCALE_ROAS/SCALE_MIN_CONV) correctly stay at "info" — they
// shouldn't auto-apply either.
const SCALE_ROAS_STRONG = SCALE_ROAS * 2;      // 6.0x — clearly outsized ROAS
const SCALE_CONV_STRONG = SCALE_MIN_CONV * 4;  // 40 conversions — high data volume
const SCALE_ROAS_CLEAR = SCALE_ROAS * 1.4;     // 4.2x — solidly above threshold
const SCALE_CONV_CLEAR = SCALE_MIN_CONV * 2;   // 20 conversions — good data volume

function scaleWinnerSeverity(roas: number, conv: number): NbaSeverity {
  if (roas >= SCALE_ROAS_STRONG && conv >= SCALE_CONV_STRONG) return "critical";
  if (roas >= SCALE_ROAS_CLEAR || conv >= SCALE_CONV_CLEAR) return "warning";
  return "info";
}

export function budgetCollector(campaigns: Campaign[], ctx: NbaContext): NbaSignal[] {
  const allowed = new Set(ctx.companies);
  const out: NbaSignal[] = [];

  for (const c of campaigns) {
    if (!isActive(c)) continue;
    const company = detectCompany(c);
    if (!company || !allowed.has(company)) continue;

    const roas = c.metrics.roas ?? 0;
    const conv = c.metrics.conversions ?? 0;
    const spend = c.metrics.spend ?? 0;
    const platform = platformOf(c);

    // ── Scale winner ──
    if (roas >= SCALE_ROAS && conv >= SCALE_MIN_CONV) {
      out.push({
        reasonCode: "SCALE_WINNER",
        company, platform,
        entityType: "budget",
        entityId: c.id,
        entityName: c.name,
        title: `Tăng ngân sách "${c.name}" — ROAS ${roas.toFixed(1)}x`,
        explanation: `Campaign hiệu quả cao (ROAS ${roas.toFixed(1)}x, ${conv} chuyển đổi). Đề xuất tăng ngân sách ~25% để mở rộng kết quả.`,
        evidence: [
          { metric: "ROAS", current: Math.round(roas * 10) / 10, unit: "x" },
          { metric: "conversions", current: conv, unit: "" },
          { metric: "dailyBudget", current: Math.round(c.dailyBudget ?? 0), unit: "₫" },
        ],
        severity: scaleWinnerSeverity(roas, conv),
        sampleSize: conv,
        impactEstimate: { metric: "ROAS", direction: "gain", estMonthlySavingsVnd: Math.round(spend * 0.25) },
        suggestedAction: { type: "INCREASE_BUDGET", params: { pct: 25 } },
        sourceEngine: "nba-budget-heuristic",
        _guardCampaign: c,
      });
    }

    // ── ROAS thấp cần rà soát ──
    if (roas > 0 && roas < LOW_ROAS && spend >= LOW_ROAS_MIN_SPEND && conv >= 1) {
      out.push({
        reasonCode: "LOW_ROAS_REVIEW",
        company, platform,
        entityType: "budget",
        entityId: c.id,
        entityName: c.name,
        title: `ROAS thấp "${c.name}" — ${roas.toFixed(2)}x`,
        explanation: `ROAS dưới ngưỡng hoà vốn (${roas.toFixed(2)}x) với chi tiêu đáng kể. Rà soát trước khi giảm ngân sách (tránh cắt nhầm campaign đang học).`,
        evidence: [
          { metric: "ROAS", current: Math.round(roas * 100) / 100, unit: "x" },
          { metric: "spend", current: Math.round(spend), unit: "₫" },
        ],
        severity: "warning",
        sampleSize: conv,
        impactEstimate: { metric: "spend", direction: "reduce_waste", estMonthlySavingsVnd: Math.round(spend * 0.3) },
        suggestedAction: { type: "DECREASE_BUDGET", params: { pct: 30 } },
        sourceEngine: "nba-budget-heuristic",
        _guardCampaign: c,
      });
    }
  }

  return out;
}
