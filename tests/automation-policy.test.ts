import { describe, expect, it } from "vitest";
import { DEFAULT_AUTOMATION_POLICY, policyBlocksCampaign, validateAutomationPolicy } from "@/lib/automation/policy";
import { evaluateBudgetDecision } from "@/lib/automation/profit-evaluator";

describe("automation policy", () => {
  it.each([
    { maxIncreasePct: -1 }, { minAttributionCoverage: 2 },
    { minBudget: 100, maxBudget: 10 }, { cooldownHours: "24" },
    { maxMutationsPerRun: 10, maxMutationsPerDay: 5 },
    { status: "approved", owner: null }, { minObservedDays: 3.5 },
  ])("rejects invalid policy %j", patch => {
    expect(() => validateAutomationPolicy({ ...DEFAULT_AUTOMATION_POLICY, ...patch })).toThrow();
  });
  it("never enables apply for draft or globally disabled policy", () => {
    expect(validateAutomationPolicy({ ...DEFAULT_AUTOMATION_POLICY, globalEnabled: true, applyEnabled: true }).applyEnabled).toBe(false);
    expect(validateAutomationPolicy({ ...DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "test-owner", applyEnabled: true }).applyEnabled).toBe(false);
  });
  it("defaults fail-closed", () => {
    expect(DEFAULT_AUTOMATION_POLICY.globalEnabled).toBe(false);
    expect(DEFAULT_AUTOMATION_POLICY.applyEnabled).toBe(false);
    expect(policyBlocksCampaign(DEFAULT_AUTOMATION_POLICY, "c1")).toBe("automation_disabled");
  });
  it("blocks protected campaigns even when policy is enabled", () => {
    const policy = { ...DEFAULT_AUTOMATION_POLICY, status: "approved" as const, globalEnabled: true, protectedCampaignIds: ["c1"] };
    expect(policyBlocksCampaign(policy, "c1")).toBe("protected_campaign");
    const result = evaluateBudgetDecision({ company: "MBC", campaignId: "c1", campaignName: "protected", currentBudget: 1_000_000, dailySpend: { value: 1, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, roas: { value: 3, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, breakEvenRoas: { value: 2, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, attributionCoverage: { value: .95, source: "s", from: "a", to: "b", readAt: "r", status: "complete" }, learningPhase: false, minBudget: 1, maxBudget: 2_000_000, maxIncreasePct: 10, maxDecreasePct: 15, minAttributionCoverage: .8, cooldownHours: 24, policy });
    expect(result.reasonCode).toBe("protected_campaign");
  });
});

describe("absolute delta policy caps", () => {
  const cap = { maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 50 };
  it("reads legacy policy with empty caps and OFF defaults", () => {
    const { absoluteBudgetDeltaCapsByCurrency: omitted, ...legacy } = DEFAULT_AUTOMATION_POLICY;
    void omitted;
    expect(validateAutomationPolicy(legacy).absoluteBudgetDeltaCapsByCurrency).toEqual({});
    expect(DEFAULT_AUTOMATION_POLICY.absoluteBudgetDeltaCapsByCurrency).toEqual({});
  });
  it.each([null, [], { XYZ: cap }, { usd: cap }, JSON.parse('{"__proto__":{}}'), { constructor: cap }, Object.create({ USD: cap }), { USD: Object.create(cap) }, { USD: { ...cap, unit: "major" } }, { USD: { day: 100, run: 50 } }, { USD: { ...cap, maxAbsoluteBudgetDeltaPerRunMinor: 101 } }, { USD: { ...cap, maxAbsoluteBudgetDeltaPerDayMinor: Number.MAX_SAFE_INTEGER + 1 } }, { USD: { ...cap, maxAbsoluteBudgetDeltaPerRunMinor: -1 } }, { USD: { ...cap, maxAbsoluteBudgetDeltaPerRunMinor: .5 } }, { USD: { ...cap, maxAbsoluteBudgetDeltaPerRunMinor: "50" } }, { USD: JSON.parse('{"maxAbsoluteBudgetDeltaPerDayMinor":100,"maxAbsoluteBudgetDeltaPerRunMinor":50,"__proto__":{}}') }])("rejects malformed caps %#", caps => {
    expect(() => validateAutomationPolicy({ ...DEFAULT_AUTOMATION_POLICY, absoluteBudgetDeltaCapsByCurrency: caps })).toThrow();
  });
  it("projects independent ISO caps including zero and safe integer boundary", () => {
    const caps = { USD: cap, VND: { maxAbsoluteBudgetDeltaPerDayMinor: Number.MAX_SAFE_INTEGER, maxAbsoluteBudgetDeltaPerRunMinor: 0 } };
    expect(validateAutomationPolicy({ ...DEFAULT_AUTOMATION_POLICY, absoluteBudgetDeltaCapsByCurrency: caps }).absoluteBudgetDeltaCapsByCurrency).toEqual(caps);
  });
});
