import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), readAutomationPolicy: vi.fn(), saveAutomationPolicyDraft: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/automation/policy", () => ({ readAutomationPolicy: mocks.readAutomationPolicy, saveAutomationPolicyDraft: mocks.saveAutomationPolicyDraft }));
import { GET, POST } from "@/app/api/automation/policy/route";
const request = (body: unknown = { policy: {}, expectedVersion: "1" }) => new NextRequest("http://localhost/api/automation/policy", { method: "POST", body: JSON.stringify(body) });
describe("policy settings API", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("rejects unauthenticated reads/writes", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request())).status).toBe(401);
  });
  it.each(["viewer", "admin_mbc", "admin_mbi", "admin"])("rejects global policy changes by %s", async role => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u", role });
    expect((await GET()).status).toBe(403);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.saveAutomationPolicyDraft).not.toHaveBeenCalled();
  });
  it("saves a draft for global admin with server actor", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "trusted", role: "super_admin" });
    mocks.saveAutomationPolicyDraft.mockResolvedValue({ status: "draft", applyEnabled: false });
    const response = await POST(request());
    expect(mocks.saveAutomationPolicyDraft).toHaveBeenCalledWith({}, "trusted", "1");
    expect(await response.json()).toMatchObject({ success: true, mutationPerformed: false });
  });
  it("reports revision conflict and invalid input", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u", role: "super_admin" });
    mocks.saveAutomationPolicyDraft.mockRejectedValueOnce(new Error("POLICY_CONFLICT"));
    expect((await POST(request())).status).toBe(409);
    expect((await POST(request(null))).status).toBe(400);
    mocks.saveAutomationPolicyDraft.mockRejectedValueOnce(new Error("Invalid policy field"));
    expect((await POST(request())).status).toBe(400);
  });
});

it("returns cap map on settings reads and draft responses without projection loss", async () => {
  mocks.getCurrentUser.mockResolvedValue({ id: "trusted", role: "super_admin" });
  const policy = { version: "new", status: "draft", absoluteBudgetDeltaCapsByCurrency: { USD: { maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 50 } } };
  mocks.readAutomationPolicy.mockReturnValue(policy);
  mocks.saveAutomationPolicyDraft.mockResolvedValue(policy);
  expect((await (await GET()).json()).policy).toEqual(policy);
  expect((await (await POST(request({ policy, expectedVersion: "old" }))).json()).policy).toEqual(policy);
  expect(mocks.saveAutomationPolicyDraft).toHaveBeenCalledWith(policy, "trusted", "old");
});
