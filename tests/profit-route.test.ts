import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUser, getCompaniesForRole } = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getCompaniesForRole: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole }));

import { GET } from "@/app/api/finance/profit/route";

const request = (query = "company=MBC&from=2026-11-01&to=2026-11-30") => new NextRequest(`http://localhost/api/finance/profit?${query}`);

describe("GET /api/finance/profit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompaniesForRole.mockReturnValue(["MBC"]);
  });

  it("requires authentication", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });

  it("returns insufficient rather than fake zero profit while ledgers are missing", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    const response = await GET(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.report.quality.allowed).toBe(false);
    expect(payload.report.quality.confidence).toBe("insufficient");
    expect(payload.report.netProfitAfterAds).toBeNull();
    expect(payload.missingSources).toContain("cogs_ledger");
  });

  it("enforces company scope", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    expect((await GET(request("company=MBI&from=2026-11-01&to=2026-11-30"))).status).toBe(403);
  });
});
