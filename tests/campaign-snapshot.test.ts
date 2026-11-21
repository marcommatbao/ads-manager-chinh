import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), getGoogleAdsCustomer: vi.fn() }));
vi.mock("@/lib/google-ads-client", () => ({ GOOGLE_CUSTOMER_IDS: { MBC: "111-222-3333" }, getGoogleAdsCustomer: m.getGoogleAdsCustomer }));
import { collectGoogleCampaignSnapshot } from "@/lib/automation/campaign-snapshot";
const now = new Date("2026-11-20T00:00:00Z");
const row = { customer: { id: "1112223333", currency_code: "VND", time_zone: "Asia/Ho_Chi_Minh" }, campaign: { id: "123", name: "fixture", status: "ENABLED" }, campaign_budget: { amount_micros: 1000000000, explicitly_shared: false }, metrics: { cost_micros: 250000000, conversions_value: 400 } };
describe("read-only Google campaign snapshot", () => {
 beforeEach(() => { vi.resetAllMocks(); m.getGoogleAdsCustomer.mockReturnValue({ query: m.query }); });
 it.each([
  "LEARNING_NEW", "LEARNING_SETTING_CHANGE", "LEARNING_BUDGET_CHANGE",
  "LEARNING_COMPOSITION_CHANGE", "LEARNING_CONVERSION_TYPE_CHANGE",
  "LEARNING_CONVERSION_SETTING_CHANGE", "MULTIPLE_LEARNING", 3, 4, 5, 6, 7, 8, 23,
 ])("records explicit provider learning evidence for %s without authorizing apply", async (providerStatus) => {
  m.query.mockResolvedValueOnce([{ ...row, campaign: { ...row.campaign, bidding_strategy_system_status: providerStatus } }]).mockResolvedValueOnce([]);
  const result = await collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now);
  expect(m.query.mock.calls[0][0]).toContain("campaign.bidding_strategy_system_status");
  expect(result.learningEvidence).toEqual({ source: "campaign.bidding_strategy_system_status", status: "learning", providerStatus });
  expect(result.missingSources).not.toContain("verified_learning_status");
  expect(result.missingSources).toEqual(expect.arrayContaining(["campaign_attributed_revenue", "approved_break_even_roas", "campaign_attribution_coverage", "daily_period_spend_mismatch"]));
  expect(result.approvable).toBe(false);
 });
 it.each([undefined, null, "UNKNOWN", "UNSPECIFIED", "UNAVAILABLE", "ENABLED", "ACTIVE", "LIMITED_BY_DATA", "MULTIPLE", "LEARNING_FUTURE", "3", 0, 1, 2, 11, 22, 26, 999, {}, true, NaN])("keeps unsupported or non-learning status %s unverified", async (providerStatus) => {
  m.query.mockResolvedValueOnce([{ ...row, campaign: { ...row.campaign, status: "ACTIVE", bidding_strategy_system_status: providerStatus } }]).mockResolvedValueOnce([]);
  const result = await collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now);
  expect(result.learningEvidence?.status).toBe("unverified");
  expect(result.missingSources).toContain("verified_learning_status");
  expect(result.approvable).toBe(false);
 });
 it("includes learning evidence in snapshot identity", async () => {
  const collect = async (providerStatus: string) => {
   m.query.mockResolvedValueOnce([{ ...row, campaign: { ...row.campaign, bidding_strategy_system_status: providerStatus } }]).mockResolvedValueOnce([]);
   return collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now);
  };
  expect((await collect("LEARNING_NEW")).snapshotId).not.toBe((await collect("UNKNOWN")).snapshotId);
 });
 it("preserves currency, micros, scope and observed dates without authorizing apply", async () => {
  m.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ campaign: { id: "123" }, segments: { date: "2026-11-10" }, metrics: { cost_micros: 250000000 } }]);
  const result = await collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now);
  expect(m.getGoogleAdsCustomer).toHaveBeenCalledWith("MBC");
  expect(result).toMatchObject({ accountId: "1112223333", dailyBudget: 1000, spend: 250, platformConversionValue: 400, observedDays: 1, approvable: false, expiresAt: "2026-11-20T00:15:00.000Z" });
  expect(result.snapshotId).toHaveLength(64);
 });
 it("keeps a mismatch explicit when provider totals changed between queries", async () => {
  m.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ campaign: { id: "123" }, segments: { date: "2026-11-10" }, metrics: { cost_micros: 100000000 } }]);
  const result = await collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now);
  expect(result.spendConsistency).toMatchObject({ status: "mismatch", dailyTotal: 100, periodTotal: 250 });
  expect(result.missingSources).toContain("daily_period_spend_mismatch");
  expect(result.approvable).toBe(false);
 });
 it("rejects duplicate days instead of silently counting them once", async () => {
  const daily = { campaign: { id: "123" }, segments: { date: "2026-11-10" }, metrics: { cost_micros: 125000000 } };
  m.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([daily, daily]);
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now)).rejects.toThrow("INVALID_PROVIDER_SNAPSHOT");
 });
 it("rejects another account in the provider response", async () => {
  m.query.mockResolvedValueOnce([{ ...row, customer: { ...row.customer, id: "999" } }]);
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now)).rejects.toThrow("SNAPSHOT_SCOPE_MISMATCH");
  expect(m.query).toHaveBeenCalledTimes(1);
 });
 it("rejects invalid dates and unknown company before provider calls", async () => {
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-02-30", "2026-11-19", now, () => now)).rejects.toThrow("INVALID_SNAPSHOT_RANGE");
  await expect(collectGoogleCampaignSnapshot("UNKNOWN", "123", "2026-11-01", "2026-11-19", now, () => now)).rejects.toThrow("ACCOUNT_NOT_CONFIGURED");
  expect(m.getGoogleAdsCustomer).not.toHaveBeenCalled();
 });
 it("rejects missing cost instead of turning it into zero", async () => {
  m.query.mockResolvedValueOnce([{ ...row, metrics: { conversions_value: 400 } }]).mockResolvedValueOnce([]);
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now, () => now)).rejects.toThrow();
 });
});
