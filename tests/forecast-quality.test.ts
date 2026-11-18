import { describe, expect, it } from "vitest";
import { forecastWithQuality } from "@/lib/forecast-quality";

describe("phase 4 forecast quality", () => {
  const base = {
    monthlyBudget: 1_000_000,
    budgetKind: "campaign_budget" as const,
    source: "meta",
    from: "2026-11-01",
    to: "2026-11-18",
    now: new Date("2026-11-18T00:00:00.000Z"),
  };

  it("allows a low-confidence forecast only after minimum observations", () => {
    const result = forecastWithQuality({ ...base, dailySpends: [100, 120, 80] });
    expect(result.forecastAllowed).toBe(true);
    expect(result.quality.confidence).toBe("low");
    expect(result.budgetKind).toBe("campaign_budget");
  });

  it("does not forecast from fewer than three observed days", () => {
    const result = forecastWithQuality({ ...base, dailySpends: [100, 120] });
    expect(result.forecastAllowed).toBe(false);
    expect(result.quality.confidence).toBe("insufficient");
  });

  it("does not turn missing budget into a zero-budget forecast", () => {
    const result = forecastWithQuality({ ...base, monthlyBudget: null, dailySpends: [100, 120, 80] });
    expect(result.forecastAllowed).toBe(false);
    expect(result.quality.confidence).toBe("insufficient");
    expect(result.quality.reason).toContain("Thiếu ngân sách");
  });

  it("keeps account balance distinct from campaign budget", () => {
    const result = forecastWithQuality({ ...base, budgetKind: "account_balance", dailySpends: [100, 120, 80] });
    expect(result.budgetKind).toBe("account_balance");
  });
});
