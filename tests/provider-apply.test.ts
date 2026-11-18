import { describe, expect, it } from "vitest";
import { createApproval } from "@/lib/automation/approval";
import { evaluateBudgetDecision } from "@/lib/automation/profit-evaluator";
import { applyApprovedBudget, type BudgetProviderAdapter } from "@/lib/automation/provider-apply";

const decision = () => evaluateBudgetDecision({ company: "MBC", campaignId: "c1", campaignName: "test", currentBudget: 1_000_000, dailySpend: { value: 500, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, roas: { value: 3, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, breakEvenRoas: { value: 2, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, attributionCoverage: { value: .95, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, learningPhase: false, minBudget: 1, maxBudget: 2_000_000, maxIncreasePct: 10, maxDecreasePct: 15, minAttributionCoverage: .8, cooldownHours: 24, now: new Date("2026-11-18T00:00:00Z") });
const adapter = (afterDelta = 0): BudgetProviderAdapter => { let budget = 1_000_000; return { provider: "meta", readBudget: async () => budget, setBudget: async (_id, value) => { budget = value + afterDelta; return { accepted: true, requestHash: "hash" }; } }; };

describe("provider apply orchestration", () => {
  it("applies only an approved decision and verifies read-back", async () => { const d = decision(); const a = createApproval(d, "manager"); const result = await applyApprovedBudget(d, a, adapter()); expect(result.status).toBe("applied"); expect(result.before).toBe(1_000_000); expect(result.after).toBe(1_100_000); });
  it("blocks changed current budget and expired approval", async () => { const d = decision(); const a = createApproval(d, "manager", new Date("2026-11-18T00:00:00Z"), 1); expect((await applyApprovedBudget(d, a, adapter(), new Date("2026-11-18T00:02:00Z"))).reason).toBe("approval_expired"); expect((await applyApprovedBudget(d, createApproval(d, "manager"), { ...adapter(), readBudget: async () => 999 } as BudgetProviderAdapter)).reason).toBe("current_budget_changed"); });
  it("reports provider read-back mismatch", async () => { const d = decision(); const a = createApproval(d, "manager"); const result = await applyApprovedBudget(d, a, adapter(10)); expect(result.status).toBe("readback_mismatch"); });
});
