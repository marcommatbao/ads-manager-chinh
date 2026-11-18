import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUser, getCompaniesForRole, readAttributionReport } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getCompaniesForRole: vi.fn(), readAttributionReport: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ getCompaniesForRole }));
vi.mock("@/lib/attribution/report", () => ({ readAttributionReport }));

import { GET } from "@/app/api/attribution/report/route";

const request = (query = "company=MBC&from=2026-11-01&to=2026-11-18") => new NextRequest(`http://localhost/api/attribution/report?${query}`);

describe("GET /api/attribution/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompaniesForRole.mockReturnValue(["MBC"]);
    readAttributionReport.mockResolvedValue({ matched: [], unmatched: [], duplicateOrders: 0, matchedOrderRate: 0, matchedRevenueRate: 0 });
  });

  it("requires authentication", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(readAttributionReport).not.toHaveBeenCalled();
  });

  it("enforces company scope", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    const response = await GET(request("company=MBI&from=2026-11-01&to=2026-11-18"));
    expect(response.status).toBe(403);
  });

  it("returns normalized report for an allowed company and date range", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(readAttributionReport).toHaveBeenCalledWith("MBC", new Date("2026-11-01T00:00:00.000Z"), new Date("2026-11-18T23:59:59.999Z"));
    await expect(response.json()).resolves.toMatchObject({ success: true, attributionLevel: "evidence_bounded" });
  });
});
