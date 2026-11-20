import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), getGoogleAdsCustomer: vi.fn() }));
vi.mock("@/lib/google-ads-client", () => ({ GOOGLE_CUSTOMER_IDS: { MBC: "111-222-3333" }, getGoogleAdsCustomer: m.getGoogleAdsCustomer }));
import { collectGoogleCampaignSnapshot } from "@/lib/automation/campaign-snapshot";
const now = new Date("2026-11-20T00:00:00Z");
const row = { customer: { id: "1112223333", currency_code: "VND", time_zone: "Asia/Ho_Chi_Minh" }, campaign: { id: "123", name: "fixture", status: "ENABLED" }, campaign_budget: { amount_micros: 1000000000, explicitly_shared: false }, metrics: { cost_micros: 250000000, conversions_value: 400 } };
describe("read-only Google campaign snapshot", () => {
 beforeEach(() => { vi.resetAllMocks(); m.getGoogleAdsCustomer.mockReturnValue({ query: m.query }); });
 it("preserves currency, micros, scope and observed dates without authorizing apply", async () => {
  m.query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ campaign: { id: "123" }, segments: { date: "2026-11-10" }, metrics: { cost_micros: 0 } }]);
  const result = await collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now);
  expect(m.getGoogleAdsCustomer).toHaveBeenCalledWith("MBC");
  expect(result).toMatchObject({ accountId: "1112223333", dailyBudget: 1000, spend: 250, platformConversionValue: 400, observedDays: 1, approvable: false, expiresAt: "2026-11-20T00:15:00.000Z" });
  expect(result.snapshotId).toHaveLength(64);
 });
 it("rejects another account in the provider response", async () => {
  m.query.mockResolvedValueOnce([{ ...row, customer: { ...row.customer, id: "999" } }]);
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now)).rejects.toThrow("SNAPSHOT_SCOPE_MISMATCH");
  expect(m.query).toHaveBeenCalledTimes(1);
 });
 it("rejects invalid dates and unknown company before provider calls", async () => {
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-02-30", "2026-11-19", now)).rejects.toThrow("INVALID_SNAPSHOT_RANGE");
  await expect(collectGoogleCampaignSnapshot("UNKNOWN", "123", "2026-11-01", "2026-11-19", now)).rejects.toThrow("ACCOUNT_NOT_CONFIGURED");
  expect(m.getGoogleAdsCustomer).not.toHaveBeenCalled();
 });
 it("rejects missing cost instead of turning it into zero", async () => {
  m.query.mockResolvedValueOnce([{ ...row, metrics: { conversions_value: 400 } }]).mockResolvedValueOnce([]);
  await expect(collectGoogleCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now)).rejects.toThrow();
 });
});
