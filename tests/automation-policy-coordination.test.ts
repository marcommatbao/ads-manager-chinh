import { describe, expect, it } from "vitest";
import { coordinatorLimitsFromPolicy, DEFAULT_AUTOMATION_POLICY } from "@/lib/automation/policy";
const cap = { maxAbsoluteBudgetDeltaPerDayMinor: 100, maxAbsoluteBudgetDeltaPerRunMinor: 0 };
const approved = { ...DEFAULT_AUTOMATION_POLICY, status: "approved" as const, owner: "trusted", globalEnabled: true, applyEnabled: true, absoluteBudgetDeltaCapsByCurrency: { USD: cap } };
describe("trusted policy limits projection (not authorization)", () => {
  it("maps explicit currency with zero retained and fresh projected values", () => {
    const limits = coordinatorLimitsFromPolicy(approved, "USD");
    expect(limits).toEqual({ ...cap, maxMutationsPerDay: 5, maxMutationsPerRun: 5, cooldownHours: 24 });
    limits.maxAbsoluteBudgetDeltaPerDayMinor = 0;
    expect(approved.absoluteBudgetDeltaCapsByCurrency.USD).toEqual(cap);
  });
  it.each([{ status: "draft" as const }, { globalEnabled: false }, { applyEnabled: false }, { owner: null }, { owner: " " }, { absoluteBudgetDeltaCapsByCurrency: {} }])("denies unsafe policy %#", patch => {
    expect(() => coordinatorLimitsFromPolicy({ ...approved, ...patch }, "USD")).toThrow();
  });
  it.each(["VND", "XYZ", "usd", "__proto__", "constructor", ""])("denies missing or invalid currency %s", currency => {
    expect(() => coordinatorLimitsFromPolicy(approved, currency)).toThrow();
  });
});
