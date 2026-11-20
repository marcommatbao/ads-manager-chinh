import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ graphFetch: vi.fn() }));
vi.mock("@/lib/meta-client", () => ({ graphFetch: m.graphFetch }));
vi.mock("@/lib/companies/registry", () => ({ allCompanyDefs: () => [{ id: "MBC", ads: true, match: {} }, { id: "MBI", ads: true, match: { campaignContains: ["MBI"] } }] }));
import { collectMetaCampaignSnapshot } from "@/lib/automation/meta-campaign-snapshot";
const now = new Date("2026-11-20T00:00:00Z");
const campaign = { id: "123", account_id: "999", name: "MBC - fixture", status: "ACTIVE", daily_budget: "100000" };
const reply = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("META_ACCESS_TOKEN", "fixture-secret"); vi.stubEnv("META_AD_ACCOUNT_ID", "act_999"); });
afterEach(() => vi.unstubAllEnvs());
describe("Meta scoped read snapshot", () => {
 it("keeps minor units and does not expose token or assume zero spend", async () => {
  m.graphFetch.mockResolvedValueOnce(reply(campaign)).mockResolvedValueOnce(reply({ id: "act_999", currency: "VND", timezone_name: "Asia/Ho_Chi_Minh" })).mockResolvedValueOnce(reply({ data: [] }));
  const snapshot = await collectMetaCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now);
  expect(snapshot).toMatchObject({ provider: "meta", dailyBudgetMinorUnits: 100000, spend: null, observedDays: 0, approvable: false });
  expect(JSON.stringify(snapshot)).not.toContain("fixture-secret");
  for (const [url, options] of m.graphFetch.mock.calls) { expect(url).not.toContain("fixture-secret"); expect(options.headers.Authorization).toBe("Bearer fixture-secret"); }
 });
 it.each([{ ...campaign, account_id: "666" }, { ...campaign, name: "MBI - fixture" }, { ...campaign, name: "unknown" }])("rejects mismatched or unknown scope before reading insights", async row => {
  m.graphFetch.mockResolvedValueOnce(reply(row));
  await expect(collectMetaCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now)).rejects.toThrow("SNAPSHOT_SCOPE_MISMATCH");
  expect(m.graphFetch).toHaveBeenCalledTimes(1);
 });
 it("rejects paginated incomplete insights", async () => {
  m.graphFetch.mockResolvedValueOnce(reply(campaign)).mockResolvedValueOnce(reply({ id: "999", currency: "VND", timezone_name: "Asia/Ho_Chi_Minh" })).mockResolvedValueOnce(reply({ data: [], paging: { next: "fixture" } }));
  await expect(collectMetaCampaignSnapshot("MBC", "123", "2026-11-01", "2026-11-19", now)).rejects.toThrow("INCOMPLETE_PROVIDER_SNAPSHOT");
 });
});
