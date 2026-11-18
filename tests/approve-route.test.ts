import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { getCurrentUser, getCompaniesForRole, recordDecision } = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getCompaniesForRole: vi.fn(), recordDecision: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole }));
vi.mock("@/lib/automation/decision-audit", () => ({ recordDecision }));
import { POST } from "@/app/api/automation/approve/route";
const body = { idempotencyKey: "budget:MBC:c1:2026-11-18", action: "increase_budget", confidence: "high", reasonCode: "roas_above_break_even", reason: "test", company: "MBC", campaignId: "c1", campaignName: "test", currentBudget: 1000000, proposedBudget: 1100000, delta: 100000, sourceRefs: ["test"], requiresApproval: true };
const req = () => new NextRequest("http://localhost/api/automation/approve", { method: "POST", body: JSON.stringify(body) });
describe("POST /api/automation/approve", () => {
 beforeEach(() => { vi.clearAllMocks(); getCompaniesForRole.mockReturnValue(["MBC"]); });
 it("requires approval role and scope", async () => { getCurrentUser.mockResolvedValue({ id: "u", role: "viewer" }); expect((await POST(req())).status).toBe(403); getCurrentUser.mockResolvedValue({ id: "u", role: "manager" }); getCompaniesForRole.mockReturnValue(["MBI"]); expect((await POST(req())).status).toBe(403); });
 it("creates approval without mutation", async () => { getCurrentUser.mockResolvedValue({ id: "u", role: "manager" }); const r = await POST(req()); const p = await r.json(); expect(r.status).toBe(200); expect(p).toMatchObject({ success: true, mode: "approval_only", mutationPerformed: false }); expect(p.approval.status).toBe("approved"); });
});
