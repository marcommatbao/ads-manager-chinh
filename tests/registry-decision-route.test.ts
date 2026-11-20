import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), resolve: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/permissions", () => ({ canAccessCompany: m.access }));
vi.mock("@/lib/companies/registry", () => ({ isCompany: (v: string) => v === "MBC" }));
vi.mock("@/lib/automation/snapshot-consumer", () => ({ resolveCurrentSnapshot: m.resolve }));
vi.mock("@/lib/automation/decision-audit", () => ({ recordDecision: m.audit }));
import { POST } from "@/app/api/automation/decisions/route";
const binding = { provider: "google", company: "MBC", accountId: "111", campaignId: "123", policyRevision: "p1" };
const req = () => new NextRequest("http://localhost/api/automation/decisions", { method: "POST", body: JSON.stringify({ registryId: "r1", company: "MBC", provider: "google", campaignId: "123", proposedBudget: 99999999 }) });
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "u" }); m.access.mockReturnValue(true); m.resolve.mockReturnValue({ snapshot: { registryId: "r1", binding, payloadHash: "hash", payload: { expiresAt: "2099-01-01", dailyBudget: 1000, approvable: false } } }); m.audit.mockImplementation((d, mode, refs) => ({ ...d, ...refs, mode, decisionId: "d1" })); });
describe("registry-backed decisions", () => {
 it("checks authorization before accessing registry", async () => { m.access.mockReturnValue(false); expect((await POST(req())).status).toBe(403); expect(m.resolve).not.toHaveBeenCalled(); });
 it("uses server snapshot budget and binding, not client proposal", async () => {
  const response = await POST(req()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ approvable: false, decision: { action: "blocked", currentBudget: 1000, proposedBudget: null, snapshotRegistryId: "r1", binding, decisionId: "d1" } });
 });
 it("requests refresh on expired or rebound registry", async () => { m.resolve.mockImplementation(() => { throw new Error("SNAPSHOT_BINDING_MISMATCH"); }); expect((await POST(req())).status).toBe(409); expect(m.audit).not.toHaveBeenCalled(); });
 it("does not interpret unknown budget units as zero", async () => { m.resolve.mockReturnValue({ snapshot: { binding: { ...binding, provider: "meta" }, payload: {} } }); expect((await POST(req())).status).toBe(409); expect(m.audit).not.toHaveBeenCalled(); });
});
