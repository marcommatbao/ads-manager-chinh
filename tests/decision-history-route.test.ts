import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ user: vi.fn(), companies: vi.fn(), audits: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/permissions", () => ({ canAccessCompany: vi.fn(), getCompaniesForRole: m.companies }));
vi.mock("@/lib/companies/registry", () => ({ isCompany: (x: string) => ["MBC", "MBI"].includes(x) }));
vi.mock("@/lib/automation/decision-audit", () => ({ recordDecision: vi.fn(), recentDecisionAudits: m.audits }));
vi.mock("@/lib/automation/snapshot-consumer", () => ({ resolveCurrentSnapshot: vi.fn() }));
import { GET } from "@/app/api/automation/decisions/route";
const req = (query = "") => new NextRequest(`http://localhost/api/automation/decisions${query}`);
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "u" }); m.companies.mockReturnValue(["MBC"]); });
describe("company scoped decision history", () => {
 it("requires auth and rejects another company", async () => {
  m.user.mockResolvedValueOnce(null); expect((await GET(req())).status).toBe(401);
  expect((await GET(req("?company=MBI"))).status).toBe(403); expect(m.audits).not.toHaveBeenCalled();
 });
 it("filters before limit and never returns raw payload or account", async () => {
  m.audits.mockReturnValue([{ company: "MBI", decisionId: "forbidden" }, { company: "MBC", decisionId: "ok", sourceRefs: ["private"], binding: { accountId: "private" }, proposedPayload: { secret: "private" } }]);
  const response = await GET(req()); const data = await response.json();
  expect(data.decisions).toHaveLength(1); expect(data.decisions[0].decisionId).toBe("ok");
  expect(JSON.stringify(data)).not.toContain("private"); expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("reports storage failure instead of an empty history", async () => {
  m.audits.mockImplementation(() => { throw new Error("corrupt"); }); expect((await GET(req())).status).toBe(503);
 });
});
