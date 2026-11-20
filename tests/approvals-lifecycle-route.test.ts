import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), companies: vi.fn(), list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole: m.companies }));
vi.mock("@/lib/automation/approval-store", () => ({ listApprovalSummaries: m.list, revokeApproval: m.revoke }));
import { GET, DELETE } from "@/app/api/automation/approvals/route";
const req = (company = "MBC") => new NextRequest(`http://localhost/api/automation/approvals?approvalId=a1&company=${company}`, { method: "DELETE" });
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "trusted", role: "super_admin" }); m.companies.mockReturnValue(["MBC"]); m.list.mockReturnValue([]); });
describe("approval lifecycle API", () => {
 it("requires auth and global role", async () => { m.user.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401); m.user.mockResolvedValue({ role: "admin" }); expect((await GET()).status).toBe(403); expect((await DELETE(req())).status).toBe(403); expect(m.revoke).not.toHaveBeenCalled(); });
 it("passes only authorized scope to history and uses session actor for revoke", async () => { expect((await GET()).status).toBe(200); expect(m.list).toHaveBeenCalledWith(["MBC"]); m.revoke.mockResolvedValue({ approvalId: "a1", status: "revoked" }); expect((await DELETE(req())).status).toBe(200); expect(m.revoke).toHaveBeenCalledWith("a1", "MBC", "trusted"); });
 it("rejects cross-company references before store access", async () => { expect((await DELETE(req("MBI"))).status).toBe(403); expect(m.revoke).not.toHaveBeenCalled(); });
 it("reports consumed/expired conflicts and storage errors", async () => { m.revoke.mockRejectedValueOnce(new Error("APPROVAL_NOT_REVOCABLE")); expect((await DELETE(req())).status).toBe(409); m.list.mockImplementation(() => { throw new Error("secret-fixture"); }); const r = await GET(); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain("secret-fixture"); });
});
