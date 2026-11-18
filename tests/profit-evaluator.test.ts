import { describe, expect, it } from "vitest";
import { evaluateBudgetDecision, type BudgetDecisionInput } from "@/lib/automation/profit-evaluator";

const source = (value: number | null, status: "complete" | "unavailable" = "complete") => ({ value, status, source: "test", from: "2026-11-01", to: "2026-11-18", readAt: "2026-11-18T00:00:00.000Z" });
const input = (patch: Partial<BudgetDecisionInput> = {}): BudgetDecisionInput => ({
  company: "MBC", campaignId: "c1", campaignName: "MBC Domain", currentBudget: 1_000_000,
  dailySpend: source(500_000), roas: source(3), breakEvenRoas: source(2), attributionCoverage: source(0.95),
  learningPhase: false, minBudget: 500_000, maxBudget: 2_000_000, maxIncreasePct: 10, maxDecreasePct: 15,
  minAttributionCoverage: 0.8, cooldownHours: 24, now: new Date("2026-11-18T00:00:00.000Z"), ...patch,
});

describe("deterministic budget evaluator", () => {
  it("creates an approval-required increase without calling a provider", () => {
    const result = evaluateBudgetDecision(input());
    expect(result.action).toBe("increase_budget");
    expect(result.proposedBudget).toBe(1_100_000);
    expect(result.requiresApproval).toBe(true);
  });
  it("fails closed on missing source, low attribution, learning, and cooldown", () => {
    expect(evaluateBudgetDecision(input({ roas: source(null, "unavailable") })).reasonCode).toBe("source_unavailable");
    expect(evaluateBudgetDecision(input({ attributionCoverage: source(0.5) })).reasonCode).toBe("attribution_coverage_low");
    expect(evaluateBudgetDecision(input({ learningPhase: true })).reasonCode).toBe("learning_phase");
    expect(evaluateBudgetDecision(input({ lastChangedAt: "2026-11-17T12:00:00.000Z" })).reasonCode).toBe("cooldown");
  });
  it("respects floor and ceiling and holds when no safe mutation remains", () => {
    const result = evaluateBudgetDecision(input({ currentBudget: 2_000_000 }));
    expect(result.action).toBe("hold");
    expect(result.reasonCode).toBe("budget_boundary");
  });
});
