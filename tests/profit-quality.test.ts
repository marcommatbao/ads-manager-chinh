import { describe, expect, it } from "vitest";
import { calculateProfit, type ProfitComponent } from "@/lib/finance/profit-quality";

const component = (value: number, source = "test"): ProfitComponent => ({
  value, source, from: "2026-11-01", to: "2026-11-30", readAt: "2026-12-01T00:00:00.000Z",
});

describe("phase 6 profit quality", () => {
  it("calculates net revenue, profit, margin, and break-even ROAS from complete sources", () => {
    const result = calculateProfit({
      grossRevenue: component(1_000), refunds: component(100), cogs: component(400), adSpend: component(200),
    });
    expect(result.quality.allowed).toBe(true);
    expect(result.netRevenue).toBe(900);
    expect(result.grossProfit).toBe(500);
    expect(result.netProfitAfterAds).toBe(300);
    expect(result.grossMarginPct).toBeCloseTo(55.5555);
    expect(result.breakEvenRoas).toBe(3);
  });

  it("does not conclude profit when COGS is unavailable", () => {
    const result = calculateProfit({
      grossRevenue: component(1_000), refunds: component(100), cogs: null, adSpend: component(200),
    });
    expect(result.quality.confidence).toBe("insufficient");
    expect(result.netProfitAfterAds).toBeNull();
    expect(result.breakEvenRoas).toBeNull();
  });

  it("rejects components from different ranges", () => {
    const refunds = { ...component(100), to: "2026-11-29" };
    const result = calculateProfit({
      grossRevenue: component(1_000), refunds, cogs: component(400), adSpend: component(200),
    });
    expect(result.quality.allowed).toBe(false);
    expect(result.quality.reason).toContain("cùng khoảng thời gian");
  });
});
