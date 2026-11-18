import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUser, canAccessCompany, getGoogleAdsCustomer } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  canAccessCompany: vi.fn(),
  getGoogleAdsCustomer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ canAccessCompany }));
vi.mock("@/lib/google-ads-client", () => ({ getGoogleAdsCustomer }));
vi.mock("@/lib/not-configured", () => ({ friendlyError: (message: string) => message }));

import { GET } from "@/app/api/google/toolkit/budget-pacing/route";

const request = () => new NextRequest("http://localhost/api/google/toolkit/budget-pacing?company=MBC");

function row(date: string, spendMicros: number) {
  return {
    campaign: { id: "campaign-1", name: "Measured campaign" },
    campaign_budget: { amount_micros: 100_000_000 },
    metrics: { cost_micros: spendMicros, clicks: 10, conversions: 2 },
    segments: { date },
  };
}

describe("GET /api/google/toolkit/budget-pacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-1", role: "admin" });
    canAccessCompany.mockReturnValue(true);
  });

  it("returns evidence-backed campaign budget forecast after observed days", async () => {
    const customer = {
      query: vi.fn()
        .mockResolvedValueOnce([row("2026-11-01", 100_000), row("2026-11-02", 120_000), row("2026-11-03", 80_000)])
        .mockResolvedValueOnce([row("2026-11-01", 100_000), row("2026-11-02", 120_000), row("2026-11-03", 80_000)]),
    };
    getGoogleAdsCustomer.mockReturnValue(customer);

    const response = await GET(request());
    const payload = await response.json();
    const campaign = payload.campaigns[0];

    expect(response.status).toBe(200);
    expect(campaign.forecastAllowed).toBe(true);
    expect(campaign.forecastQuality.confidence).toBe("low");
    expect(campaign.forecastQuality.source).toBe("google_ads_campaign_budget_pacing");
    expect(campaign.forecastQuality.from).toBe("2026-11-01");
    expect(campaign.forecastQuality.to).toBe("2026-11-03");
  });

  it("does not project from fewer observed days", async () => {
    const customer = {
      query: vi.fn()
        .mockResolvedValueOnce([row("2026-11-01", 100_000)])
        .mockResolvedValueOnce([row("2026-11-01", 100_000)]),
    };
    getGoogleAdsCustomer.mockReturnValue(customer);

    const response = await GET(request());
    const campaign = (await response.json()).campaigns[0];

    expect(campaign.forecastAllowed).toBe(false);
    expect(campaign.forecastQuality.confidence).toBe("insufficient");
    expect(campaign.projectedSpend).toBeNull();
    expect(campaign.willExceedBudget).toBe(false);
  });
});
