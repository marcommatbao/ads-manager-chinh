import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), reader: vi.fn(), goals: vi.fn(), gtmHistory: vi.fn(), configured: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
// Boundaries only: actual requireUser/requireCompany/permissions execute.
vi.mock("@/lib/case/service", () => ({ CaseError: class extends Error {} }));
vi.mock("@/lib/case/store", () => ({ readCase: vi.fn() }));
vi.mock("@/lib/measure/tag-doctor", () => ({ tagDoctor: mocks.reader }));
vi.mock("@/lib/measure/google-goal-fix", () => ({ CONFIRM_TEXT: "TEST ONLY", listGoalFixes: mocks.goals, needsNoSignalAck: vi.fn() }));
vi.mock("@/lib/measure/gtm-fix", () => ({ GTM_CONFIRM_TEXT: "TEST ONLY", MAX_GTM_FIXES: 1, listGtmFixes: mocks.gtmHistory }));
vi.mock("@/lib/measure/gtm-api", () => ({ gtmApiConfigured: mocks.configured, gtmServiceEmail: mocks.email }));
import { GET } from "@/app/api/measure/tags/route";
const request = (company = "MBC") => new NextRequest(`http://localhost/api/measure/tags?company=${company}`);
describe("actual tags route evidence isolation (TEST ONLY boundaries)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "test", role: "viewer", companies: ["MBC"] });
    mocks.goals.mockReturnValue([]); mocks.gtmHistory.mockReturnValue([]);
    mocks.reader.mockImplementation(async company => ({ company, fixes: [], sources: [], gtm: [], collectedAt: new Date().toISOString() }));
  });
  it.each(["anonymous", "foreign", "invalid", "unassigned"])("blocks %s before any reader/config/history access", async kind => {
    if (kind === "anonymous") mocks.user.mockResolvedValue(null);
    if (kind === "unassigned") mocks.user.mockResolvedValue({ id: "test", role: "viewer", companies: [] });
    const response = await GET(request(kind === "foreign" ? "MBI" : kind === "invalid" ? "ALL" : "MBC"));
    expect(response.status).toBe(kind === "anonymous" ? 401 : kind === "invalid" ? 400 : 403);
    for (const fn of [mocks.reader, mocks.goals, mocks.gtmHistory, mocks.configured, mocks.email]) expect(fn).not.toHaveBeenCalled();
  });
  it("projects only the authorized company using the existing reader once", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.reader).toHaveBeenCalledTimes(1);
    expect(mocks.reader.mock.calls[0][0]).toBe("MBC");
    const json = await response.json();
    expect(json.trackingEvidence.company).toBe("MBC");
    expect(json.trackingEvidence.layers).toHaveLength(5);
    expect(json.trackingEvidence.layers.every((x: { status: string }) => x.status === "unverified")).toBe(true);
  });
  it("does not promote a mismatched reader result", async () => {
    mocks.reader.mockResolvedValue({ company: "MBI", fixes: [], sources: [], gtm: [], collectedAt: new Date().toISOString() });
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: "Evidence scope mismatch" });
    expect(mocks.goals).not.toHaveBeenCalled();
  });
});
