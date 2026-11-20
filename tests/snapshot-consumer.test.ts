import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ policy: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/google-ads-client", () => ({ GOOGLE_CUSTOMER_IDS: { MBC: "111-222-3333" } }));
vi.mock("@/lib/automation/policy", () => ({ readAutomationPolicy: m.policy }));
vi.mock("@/lib/automation/snapshot-store", () => ({ resolveCampaignSnapshot: m.resolve }));
import { resolveCurrentSnapshot } from "@/lib/automation/snapshot-consumer";
beforeEach(() => { vi.resetAllMocks(); m.policy.mockReturnValue({ version: "current-p2" }); });
describe("current snapshot binding", () => {
 it("derives account and revision on server", () => {
  resolveCurrentSnapshot({ registryId: "r", company: "MBC", campaignId: "123", provider: "google" });
  expect(m.resolve).toHaveBeenCalledWith("r", { provider: "google", company: "MBC", campaignId: "123", accountId: "1112223333", policyRevision: "current-p2" }, expect.any(Date));
 });
 it("fails closed when company account is not configured", () => {
  expect(() => resolveCurrentSnapshot({ registryId: "r", company: "unknown", campaignId: "123", provider: "google" })).toThrow("ACCOUNT_NOT_CONFIGURED");
  expect(m.resolve).not.toHaveBeenCalled();
 });
});
