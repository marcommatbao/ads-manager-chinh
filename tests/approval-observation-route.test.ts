import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), companies: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole: m.companies }));
vi.mock("@/lib/automation/approval-store", () => ({ recordApprovalObservation: m.record }));
import { POST } from "@/app/api/automation/approvals/observe/route";
const req = (company = "MBC") => new NextRequest("http://localhost/api/automation/approvals/observe", { method: "POST", body: JSON.stringify({ approvalId: "a", company, registryId: "r", observedBudget: 999 }) });
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "trusted", role: "super_admin" }); m.companies.mockReturnValue(["MBC"]); });
describe("observation route", () => {
 it("enforces role and company", async () => { m.user.mockResolvedValueOnce(null); expect((await POST(req())).status).toBe(401); expect((await POST(req("MBI"))).status).toBe(403); expect(m.record).not.toHaveBeenCalled(); });
 it("passes only registry references and server actor", async () => { m.record.mockResolvedValue({ retryAllowed: false }); expect((await POST(req())).status).toBe(200); expect(m.record).toHaveBeenCalledWith("a", "MBC", "r", "trusted"); });
 it("maps stale snapshots to conflict without leaking raw errors", async () => { m.record.mockRejectedValue(new Error("SNAPSHOT_EXPIRED_OR_INVALID")); expect((await POST(req())).status).toBe(409); });
});
