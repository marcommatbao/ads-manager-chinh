import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUser, getCompaniesForRole, readAutomationPolicy } = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getCompaniesForRole: vi.fn(), readAutomationPolicy: vi.fn() }));
vi.mock("@/lib/automation/policy", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/automation/policy")>(), readAutomationPolicy }));
import { DEFAULT_AUTOMATION_POLICY } from "@/lib/automation/policy";
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole }));
vi.mock("@/lib/automation/decision-audit", () => ({ recordDecision: vi.fn((d: unknown) => d) }));

import { POST } from "@/app/api/automation/dry-run/route";

const body = { company: "MBC", campaignId: "c1", campaignName: "MBC test", currentBudget: 1_000_000, dailySpend: { value: 500000, source: "test", from: "2026-11-01", to: "2026-11-18", readAt: "2026-11-18", status: "complete" }, roas: { value: 3, source: "test", from: "2026-11-01", to: "2026-11-18", readAt: "2026-11-18", status: "complete" }, breakEvenRoas: { value: 2, source: "test", from: "2026-11-01", to: "2026-11-18", readAt: "2026-11-18", status: "complete" }, attributionCoverage: { value: .95, source: "test", from: "2026-11-01", to: "2026-11-18", readAt: "2026-11-18", status: "complete" }, learningPhase: false, minBudget: 500000, maxBudget: 2000000, maxIncreasePct: 10, maxDecreasePct: 15, minAttributionCoverage: .8, cooldownHours: 24 };

describe("POST /api/automation/dry-run", () => {
  it.each([null, [], { ...body, learningPhase: "false" }, { ...body, currentBudget: -1 }, { ...body, roas: { ...body.roas, value: "3" } }, { ...body, dailySpend: { ...body.dailySpend, from: "2026-02-30" } }, { ...body, attributionCoverage: { ...body.attributionCoverage, value: 2 } }])("rejects malformed simulation input", async input => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    expect((await POST(new NextRequest("http://localhost/api/automation/dry-run", { method: "POST", body: JSON.stringify(input) }))).status).toBe(400);
  });
  beforeEach(() => { vi.clearAllMocks(); getCompaniesForRole.mockReturnValue(["MBC"]); readAutomationPolicy.mockReturnValue({ ...DEFAULT_AUTOMATION_POLICY }); });
  it("ignores client policy and increased limits", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    const response = await POST(new NextRequest("http://localhost/api/automation/dry-run", { method: "POST", body: JSON.stringify({ ...body, maxIncreasePct: 9999, policy: { globalEnabled: true, status: "approved" } }) }));
    const payload = await response.json();
    expect(payload.decision.reasonCode).toBe("automation_disabled");
    readAutomationPolicy.mockReturnValue({ ...DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "test", globalEnabled: true, maxIncreasePct: 5 });
    const enabled = await POST(new NextRequest("http://localhost/api/automation/dry-run", { method: "POST", body: JSON.stringify({ ...body, maxIncreasePct: 9999 }) }));
    expect((await enabled.json()).decision.proposedBudget).toBe(1_050_000);
  });
  it("requires auth and scope", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await POST(new NextRequest("http://localhost/api/automation/dry-run", { method: "POST", body: JSON.stringify(body) }))).status).toBe(401);
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getCompaniesForRole.mockReturnValue(["MBI"]);
    expect((await POST(new NextRequest("http://localhost/api/automation/dry-run", { method: "POST", body: JSON.stringify(body) }))).status).toBe(403);
  });
  it("evaluates and audits without provider mutation", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    const response = await POST(new NextRequest("http://localhost/api/automation/dry-run", { method: "POST", body: JSON.stringify(body) }));
    const payload = await response.json();
    expect(payload).toMatchObject({ success: true, mode: "dry_run", inputOrigin: "client_simulation", approvable: false, mutationPerformed: false });
    expect(payload.decision.action).toBe("blocked");
    expect(payload.decision.reasonCode).toBe("automation_disabled");
  });
});
