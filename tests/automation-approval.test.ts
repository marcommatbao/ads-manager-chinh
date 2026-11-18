import { describe, expect, it } from "vitest";
import { createApproval, isApprovalUsable, snapshotHash } from "@/lib/automation/approval";
import { evaluateBudgetDecision } from "@/lib/automation/profit-evaluator";

const decision = () => evaluateBudgetDecision({ company: "MBC", campaignId: "c1", campaignName: "test", currentBudget: 1_000_000, dailySpend: { value: 500, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, roas: { value: 3, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, breakEvenRoas: { value: 2, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, attributionCoverage: { value: .95, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, learningPhase: false, minBudget: 1, maxBudget: 2_000_000, maxIncreasePct: 10, maxDecreasePct: 15, minAttributionCoverage: .8, cooldownHours: 24, now: new Date("2026-11-18T00:00:00Z") });

describe("automation approval snapshot", () => {
  it("approves exact decision snapshot until TTL", () => {
    const d = decision(); const a = createApproval(d, "manager", new Date("2026-11-18T00:00:00Z"), 30);
    expect(a.snapshotHash).toBe(snapshotHash(d));
    expect(isApprovalUsable(a, d, new Date("2026-11-18T00:20:00Z"))).toBe(true);
    expect(isApprovalUsable(a, d, new Date("2026-11-18T00:31:00Z"))).toBe(false);
  });
  it("rejects changed decision snapshot", () => {
    const d = decision(); const a = createApproval(d, "manager");
    expect(isApprovalUsable(a, { ...d, proposedBudget: (d.proposedBudget ?? 0) + 1 })).toBe(false);
  });
});
