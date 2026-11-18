import { beforeEach, describe, expect, it, vi } from "vitest";

const { readGroup } = vi.hoisted(() => ({ readGroup: vi.fn() }));
vi.mock("@/lib/odoo-client", () => ({ readGroup }));
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

import { getCampaignRevenue } from "@/lib/campaign-revenue";

describe("phase 5 campaign-label attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports matched and unmatched order/revenue rates without assigning untagged revenue", async () => {
    readGroup
      .mockResolvedValueOnce([
        { campaign_id: [1, "domain_brand"], amount_untaxed: 700, __count: 2 },
      ])
      .mockResolvedValueOnce([
        { amount_untaxed: 1_000, __count: 3 },
      ]);

    const report = await getCampaignRevenue("2026-11-01", "2026-11-18", "MBC");

    expect(report.attributionLevel).toBe("campaign_label");
    expect(report.totalOrders).toBe(3);
    expect(report.ordersWithoutCampaign).toBe(1);
    expect(report.revenueWithoutCampaign).toBe(300);
    expect(report.matchedOrderRate).toBeCloseTo(2 / 3);
    expect(report.matchedRevenueRate).toBeCloseTo(0.7);
    expect(report.rows).toEqual([{ campaign: "domain_brand", orders: 2, revenue: 700, aov: 350 }]);
  });

  it("refuses MBI attribution when the available business rule cannot separate it", async () => {
    const report = await getCampaignRevenue("2026-11-01", "2026-11-18", "MBI");
    expect(readGroup).not.toHaveBeenCalled();
    expect(report.attributionLevel).toBe("campaign_label");
    expect(report.error).toMatch(/Chưa đo được doanh thu theo nhãn campaign cho MBI/);
    expect(report.rows).toEqual([]);
    expect(report.matchedOrderRate).toBe(0);
  });

  it("returns an explicit error instead of a zero-revenue attribution when Odoo fails", async () => {
    readGroup.mockRejectedValue(new Error("Odoo unavailable"));
    const report = await getCampaignRevenue("2026-11-01", "2026-11-18", "MBC");
    expect(report.error).toBe("Odoo unavailable");
    expect(report.totalRevenue).toBe(0);
    expect(report.rows).toEqual([]);
  });
});
