import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), companies: vi.fn(), audits: vi.fn(), resolve: vi.fn(), persist: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole: m.companies }));
vi.mock("@/lib/automation/decision-audit", () => ({ recentDecisionAudits: m.audits }));
vi.mock("@/lib/automation/snapshot-consumer", () => ({ resolveCurrentSnapshot: m.resolve }));
vi.mock("@/lib/automation/approval-store", () => ({ persistApproval: m.persist }));
import { POST } from "@/app/api/automation/approve/route";
const binding = { provider: "google", company: "MBC", accountId: "111", campaignId: "123", policyRevision: "p1" };
const stored = { decisionId: "d1", mode: "dry_run", company: "MBC", campaignId: "123", binding, snapshotRegistryId: "r1", snapshotPayloadHash: "h1", expiresAt: "2099-01-01T00:00:00Z", action: "blocked" };
const req = (body: unknown = { decisionId: "d1" }) => new NextRequest("http://localhost/api/automation/approve", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
 vi.resetAllMocks(); m.user.mockResolvedValue({ id: "actor", role: "super_admin" }); m.companies.mockReturnValue(["MBC"]); m.audits.mockReturnValue([stored]);
 m.resolve.mockReturnValue({ snapshot: { binding, payloadHash: "h1", payload: { approvable: false } }, policy: { globalEnabled: true, protectedCampaignIds: [] } });
});
describe("registry-bound approval", () => {
 it("requires authentication and global role", async () => {
  m.user.mockResolvedValue(null); expect((await POST(req())).status).toBe(401);
  m.user.mockResolvedValue({ role: "admin" }); expect((await POST(req())).status).toBe(403);
  expect(m.persist).not.toHaveBeenCalled();
 });
 it("rejects old client budget payloads without decision ID", async () => { expect((await POST(req({ company: "MBC", proposedBudget: 999 }))).status).toBe(400); });
 it("rejects simulation and unknown decision IDs", async () => { m.audits.mockReturnValue([{ ...stored, mode: "simulation" }]); expect((await POST(req())).status).toBe(409); expect(m.resolve).not.toHaveBeenCalled(); });
 it("checks company before resolving snapshot", async () => { m.companies.mockReturnValue(["MBI"]); expect((await POST(req())).status).toBe(403); expect(m.resolve).not.toHaveBeenCalled(); });
 it.each(["SNAPSHOT_EXPIRED_OR_INVALID", "SNAPSHOT_BINDING_MISMATCH", "ACCOUNT_NOT_CONFIGURED"])("rejects current binding failure %s", async reason => { m.resolve.mockImplementation(() => { throw new Error(reason); }); expect((await POST(req())).status).toBe(409); expect(m.persist).not.toHaveBeenCalled(); });
 it("does not authorize read-only snapshots", async () => { const r = await POST(req()); expect(r.status).toBe(409); expect((await r.json()).error).toBe("DECISION_NOT_APPROVABLE"); expect(m.persist).not.toHaveBeenCalled(); });
 it("rejects altered payload hashes", async () => { m.resolve.mockReturnValue({ snapshot: { binding, payloadHash: "changed" }, policy: {} }); expect((await POST(req())).status).toBe(409); expect(m.persist).not.toHaveBeenCalled(); });
});
