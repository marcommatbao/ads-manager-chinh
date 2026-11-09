// ============================================================
// Bid Tracker Engine — real GAQL-backed bidding health checks
// ============================================================
// Previously returned hardcoded mock data unconditionally. Replaced
// with 3 real signals from live Google Ads data:
//  - CPA_INFLATION: real actual CPA (last 3 days) vs the campaign's
//    real Target CPA (campaign.target_cpa / campaign.maximize_conversions)
//  - BUDGET_MISMATCH: real daily budget vs real Target CPA — flags
//    campaigns whose budget can't realistically afford their own target
//  - LEARNING_PHASE_LOCK: reuses lib/campaign-health.ts's existing
//    getLearningStatus() (same age + conversions tiering already used
//    elsewhere in this app) instead of inventing a second definition
//    of "learning phase"

import { enums } from "google-ads-api";
import { dateClauseForDays } from "@/lib/google-date-range";
import { getGoogleAdsCustomer } from "./google-ads-client";
import { enumName } from "./google-ads-enums";
import { getLearningStatus } from "./campaign-health";

export interface BidIssue {
  campaignId: string;
  campaignName: string;
  type: "LEARNING_PHASE_LOCK" | "CPA_INFLATION" | "BUDGET_MISMATCH";
  severity: "CRITICAL" | "WARNING";
  description: string;
  metricLabel: string;
  metricValue: string;
}

function fmtVND(v: number): string {
  return `₫${Math.round(v).toLocaleString("vi-VN")}`;
}

function companyFromCustomerId(customerId: string): string {
  return customerId === process.env.GOOGLE_ADS_CUSTOMER_ID_MBC ? "MBC" : "MBI";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export class BidTrackerEngine {
  async analyzeBiddingHealth(customerId: string): Promise<BidIssue[]> {
    const company = companyFromCustomerId(customerId);
    const customer = getGoogleAdsCustomer(company);

    const [staticRows, shortWindowRows, mediumWindowRows] = await Promise.all([
      // Campaign-level attributes — no metrics.* fields, so no date filter needed.
      customer.query(`
        SELECT campaign.id, campaign.name, campaign.bidding_strategy_type, campaign.start_date_time,
               campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros,
               campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status = 'ENABLED'
      `).catch((): Row[] => []),
      // Short window — "3 days in a row" CPA inflation signal.
      customer.query(`
        SELECT campaign.id, metrics.cost_micros, metrics.conversions
        FROM campaign
        WHERE campaign.status = 'ENABLED' AND ${dateClauseForDays(3)}
      `).catch((): Row[] => []),
      // Medium window — enough data to judge whether a campaign has left
      // learning phase (getLearningStatus's own conversions threshold is
      // calibrated for a rolling window, not literal lifetime).
      customer.query(`
        SELECT campaign.id, metrics.conversions
        FROM campaign
        WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS
      `).catch((): Row[] => []),
    ]);

    const shortMetrics = new Map<string, { cost: number; conv: number }>();
    for (const row of shortWindowRows as Row[]) {
      const id = String(row.campaign?.id ?? "");
      if (!id) continue;
      const entry = shortMetrics.get(id) ?? { cost: 0, conv: 0 };
      entry.cost += Number(row.metrics?.cost_micros ?? 0) / 1_000_000;
      entry.conv += Number(row.metrics?.conversions ?? 0);
      shortMetrics.set(id, entry);
    }

    const mediumConv = new Map<string, number>();
    for (const row of mediumWindowRows as Row[]) {
      const id = String(row.campaign?.id ?? "");
      if (!id) continue;
      mediumConv.set(id, (mediumConv.get(id) ?? 0) + Number(row.metrics?.conversions ?? 0));
    }

    const issues: BidIssue[] = [];

    for (const row of staticRows as Row[]) {
      const campaignId = String(row.campaign?.id ?? "");
      if (!campaignId) continue;
      const campaignName = row.campaign?.name ?? "Unknown";
      const biddingType = enumName(enums.BiddingStrategyType, row.campaign?.bidding_strategy_type);
      const targetCpaMicros =
        row.campaign?.target_cpa?.target_cpa_micros ??
        row.campaign?.maximize_conversions?.target_cpa_micros ??
        0;
      const targetCpa = Number(targetCpaMicros) / 1_000_000;
      const dailyBudget = Number(row.campaign_budget?.amount_micros ?? 0) / 1_000_000;
      const short = shortMetrics.get(campaignId) ?? { cost: 0, conv: 0 };

      // ── CPA_INFLATION: real actual CPA vs real Target CPA ──
      if (targetCpa > 0 && short.conv > 0) {
        const actualCpa = short.cost / short.conv;
        if (actualCpa > targetCpa * 1.5) {
          issues.push({
            campaignId,
            campaignName,
            type: "CPA_INFLATION",
            severity: actualCpa > targetCpa * 2 ? "CRITICAL" : "WARNING",
            description: `Target CPA là ${fmtVND(targetCpa)} nhưng thuật toán đang chi ${fmtVND(actualCpa)}/conversion trong 3 ngày qua (${biddingType}).`,
            metricLabel: "Actual CPA vs Target CPA",
            metricValue: `${fmtVND(actualCpa)} vs ${fmtVND(targetCpa)}`,
          });
        }
      }

      // ── BUDGET_MISMATCH: daily budget too small to afford own Target CPA ──
      if (targetCpa > 0 && dailyBudget > 0 && dailyBudget < targetCpa * 0.5) {
        issues.push({
          campaignId,
          campaignName,
          type: "BUDGET_MISMATCH",
          severity: dailyBudget < targetCpa * 0.3 ? "CRITICAL" : "WARNING",
          description: `Ngân sách ngày ${fmtVND(dailyBudget)} thấp hơn Target CPA ${fmtVND(targetCpa)} — không đủ để thuật toán gom 1 conversion/ngày ở mức giá mục tiêu.`,
          metricLabel: "Daily Budget vs Target CPA",
          metricValue: `${fmtVND(dailyBudget)} vs ${fmtVND(targetCpa)}`,
        });
      }

      // ── LEARNING_PHASE_LOCK: reuse lib/campaign-health.ts's existing tiering ──
      const conv30d = mediumConv.get(campaignId) ?? 0;
      const learning = getLearningStatus({
        start_time: row.campaign?.start_date_time,
        metrics: { conversions: conv30d },
      });
      if (learning.phase === "learning" || learning.phase === "learning_limited") {
        issues.push({
          campaignId,
          campaignName,
          type: "LEARNING_PHASE_LOCK",
          severity: "WARNING",
          description: `Campaign ${learning.ageDays} ngày tuổi, ${conv30d} conversions trong 30 ngày qua — ${learning.reason ?? "vẫn trong giai đoạn học máy"}.`,
          metricLabel: "Tuổi campaign / Conversions (30d)",
          metricValue: `${learning.ageDays}d / ${conv30d} conv`,
        });
      }
    }

    return issues;
  }
}

export const bidTrackerEngine = new BidTrackerEngine();
