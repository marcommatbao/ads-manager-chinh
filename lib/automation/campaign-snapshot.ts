import crypto from "node:crypto";
import { snapshotCollectionWindow } from "./snapshot-window";
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";

export interface CampaignReadSnapshot {
  snapshotId: string;
  provider: "google";
  company: string;
  accountId: string;
  campaignId: string;
  name: string;
  currency: string;
  timeZone: string;
  status: string;
  learningEvidence?: {
    source: "campaign.bidding_strategy_system_status";
    status: "learning" | "unverified";
    providerStatus: string | number | null;
  };
  budgetKind: "campaign_daily_budget" | "shared_budget";
  dailyBudget: number;
  spend: number;
  platformConversionValue: number;
  observedDays: number;
  spendConsistency: { status: "matched" | "mismatch"; dailyTotal: number; periodTotal: number };
  from: string;
  to: string;
  readAt: string;
  collectedAt: string;
  collectionDurationMs: number;
  expiresAt: string;
  approvable: false;
  missingSources: string[];
}

type Row = {
  customer?: { id?: unknown; currency_code?: unknown; time_zone?: unknown };
  campaign?: { id?: unknown; name?: unknown; status?: unknown; bidding_strategy_system_status?: unknown };
  campaign_budget?: { amount_micros?: unknown; explicitly_shared?: unknown };
  metrics?: { cost_micros?: unknown; conversions_value?: unknown };
  segments?: { date?: unknown };
};
const numeric = (value: unknown): number => {
  if (value === null || value === undefined || value === "" || (typeof value !== "string" && typeof value !== "number")) throw new Error("INVALID_PROVIDER_SNAPSHOT");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_PROVIDER_SNAPSHOT");
  return n;
};

// Google Ads v23 BiddingStrategySystemStatus (installed SDK enum): only
// explicit learning states establish evidence. ENABLED is not maturity proof.
const learningStatuses = new Set<unknown>([
  "LEARNING_NEW", "LEARNING_SETTING_CHANGE", "LEARNING_BUDGET_CHANGE",
  "LEARNING_COMPOSITION_CHANGE", "LEARNING_CONVERSION_TYPE_CHANGE",
  "LEARNING_CONVERSION_SETTING_CHANGE", "MULTIPLE_LEARNING",
  3, 4, 5, 6, 7, 8, 23,
]);

/** Read-only. Company must be authorized by the route BEFORE calling this collector. */
export async function collectGoogleCampaignSnapshot(company: string, campaignId: string, from: string, to: string, now = new Date(), completedAt: () => Date = () => new Date()): Promise<CampaignReadSnapshot> {
  if (!/^\d{1,25}$/.test(campaignId)) throw new Error("INVALID_CAMPAIGN_ID");
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 90 * 86400000 || to > now.toISOString().slice(0, 10)) throw new Error("INVALID_SNAPSHOT_RANGE");
  const accountId = GOOGLE_CUSTOMER_IDS[company]?.replace(/-/g, "");
  if (!accountId || !/^\d+$/.test(accountId)) throw new Error("ACCOUNT_NOT_CONFIGURED");
  const customer = getGoogleAdsCustomer(company);
  const rows = await customer.query(`
    SELECT customer.id, customer.currency_code, customer.time_zone,
      campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_system_status,
      campaign_budget.amount_micros, campaign_budget.explicitly_shared,
      metrics.cost_micros, metrics.conversions_value
    FROM campaign WHERE campaign.id = ${campaignId}
      AND segments.date BETWEEN '${from}' AND '${to}'
  `) as Row[];
  if (rows.length === 0) throw new Error("CAMPAIGN_NOT_FOUND");
  if (rows.length !== 1) throw new Error("INVALID_PROVIDER_SNAPSHOT");
  const row = rows[0];
  if (String(row.customer?.id) !== accountId || String(row.campaign?.id) !== campaignId) throw new Error("SNAPSHOT_SCOPE_MISMATCH");
  if (typeof row.customer?.currency_code !== "string" || !row.customer.currency_code || typeof row.customer.time_zone !== "string" || !row.customer.time_zone || row.campaign?.status === undefined || typeof row.campaign_budget?.explicitly_shared !== "boolean") throw new Error("INVALID_PROVIDER_SNAPSHOT");
  const dailyRows = await customer.query(`
    SELECT campaign.id, segments.date, metrics.cost_micros
    FROM campaign WHERE campaign.id = ${campaignId}
      AND segments.date BETWEEN '${from}' AND '${to}'
  `) as Row[];
  const dates = new Set<string>();
  let dailyMicros = 0;
  for (const daily of dailyRows) {
    const date = String(daily.segments?.date ?? "");
    if (String(daily.campaign?.id) !== campaignId || !validDate(date) || date < from || date > to || dates.has(date)) throw new Error("INVALID_PROVIDER_SNAPSHOT");
    dailyMicros += numeric(daily.metrics?.cost_micros);
    dates.add(date);
  }
  const periodMicros = numeric(row.metrics?.cost_micros);
  const spendMatched = Math.abs(dailyMicros - periodMicros) <= 1; // one micro-unit rounding tolerance
  const window = snapshotCollectionWindow(now, completedAt());
  const providerLearningStatus = row.campaign?.bidding_strategy_system_status;
  const learningVerified = learningStatuses.has(providerLearningStatus);
  const base = {
    provider: "google" as const, company, accountId, campaignId,
    name: String(row.campaign?.name ?? campaignId), currency: row.customer.currency_code,
    timeZone: row.customer.time_zone, status: String(row.campaign?.status),
    learningEvidence: {
      source: "campaign.bidding_strategy_system_status" as const,
      status: learningVerified ? "learning" as const : "unverified" as const,
      providerStatus: typeof providerLearningStatus === "string" || (typeof providerLearningStatus === "number" && Number.isFinite(providerLearningStatus)) ? providerLearningStatus : null,
    },
    budgetKind: row.campaign_budget.explicitly_shared ? "shared_budget" as const : "campaign_daily_budget" as const,
    dailyBudget: numeric(row.campaign_budget.amount_micros) / 1e6,
    spend: periodMicros / 1e6,
    spendConsistency: { status: spendMatched ? "matched" as const : "mismatch" as const, dailyTotal: dailyMicros / 1e6, periodTotal: periodMicros / 1e6 },
    platformConversionValue: numeric(row.metrics?.conversions_value),
    observedDays: dates.size, from, to, ...window,
    approvable: false as const,
    missingSources: ["campaign_attributed_revenue", "approved_break_even_roas", "campaign_attribution_coverage", ...(!learningVerified ? ["verified_learning_status"] : []), ...(!spendMatched ? ["daily_period_spend_mismatch"] : [])],
  };
  return { ...base, snapshotId: crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex") };
}
