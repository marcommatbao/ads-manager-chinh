import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), collect: vi.fn(), policy: vi.fn(), persist: vi.fn() }));
vi.mock("@/lib/automation/policy", () => ({ readAutomationPolicy: m.policy }));
vi.mock("@/lib/automation/snapshot-store", () => ({ persistCampaignSnapshot: m.persist }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/permissions", () => ({ canAccessCompany: m.access }));
vi.mock("@/lib/companies/registry", () => ({ isCompany: (value: string) => ["MBC", "MBI"].includes(value) }));
vi.mock("@/lib/automation/campaign-snapshot", () => ({ collectGoogleCampaignSnapshot: m.collect }));
vi.mock("@/lib/automation/meta-campaign-snapshot", () => ({ collectMetaCampaignSnapshot: vi.fn() }));
import { GET } from "@/app/api/automation/snapshot/route";
const req = () => new NextRequest("http://localhost/api/automation/snapshot?provider=google&company=MBC&campaignId=123&from=2026-11-01&to=2026-11-19");
describe("campaign snapshot authorization", () => {
 beforeEach(() => { vi.resetAllMocks(); m.policy.mockReturnValue({ version: "policy-1" }); m.persist.mockResolvedValue({ registryId: "fixture-registry" }); });
 it("rejects policy changes during collection without persisting", async () => {
  m.user.mockResolvedValue({ id: "u" }); m.access.mockReturnValue(true);
  m.collect.mockResolvedValue({ approvable: false });
  m.policy.mockReturnValueOnce({ version: "old" }).mockReturnValueOnce({ version: "new" });
  expect((await GET(req())).status).toBe(409); expect(m.persist).not.toHaveBeenCalled();
 });
 it("fails closed if snapshot persistence fails", async () => {
  m.user.mockResolvedValue({ id: "u" }); m.access.mockReturnValue(true);
  m.collect.mockResolvedValue({ accountId: "111", campaignId: "123", approvable: false });
  m.persist.mockRejectedValue(new Error("disk secret fixture"));
  const response = await GET(req()); expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain("disk secret fixture");
 });
 it("requires auth and company access before provider calls", async () => {
  m.user.mockResolvedValue(null); expect((await GET(req())).status).toBe(401);
  m.user.mockResolvedValue({ id: "u" }); m.access.mockReturnValue(false); expect((await GET(req())).status).toBe(403);
  expect(m.collect).not.toHaveBeenCalled();
 });
 it("returns read-only snapshot without caching", async () => {
  m.user.mockResolvedValue({ id: "u" }); m.access.mockReturnValue(true); m.collect.mockResolvedValue({ approvable: false });
  const response = await GET(req()); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ mode: "read_only", mutationPerformed: false, snapshot: { approvable: false } });
 });
 it("does not leak raw provider secrets in errors", async () => {
  m.user.mockResolvedValue({ id: "u" }); m.access.mockReturnValue(true); m.collect.mockRejectedValue(new Error("secret-token-fixture"));
  const response = await GET(req()); expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain("secret-token-fixture");
 });
});
