import { describe, expect, it } from "vitest";
import { assessBudgetReconciliation } from "@/lib/automation/reconciliation";
const base = { beforeBudget: 100, proposedBudget: 110, observedBudget: 110, scopeVerified: true, readAt: "2026-11-20T15:00:00Z" };
describe("read-only budget reconciliation", () => {
 it.each([[110, "matches_proposed"], [100, "matches_before"], [115, "different_value"]])("classifies observation %s without proving execution", (value, state) => {
  expect(assessBudgetReconciliation({ ...base, observedBudget: Number(value) })).toMatchObject({ state, executionProven: false, retryAllowed: false, undoAllowed: false });
 });
 it.each([{ scopeVerified: false }, { observedBudget: null }, { observedBudget: NaN }, { readAt: "invalid" }, { proposedBudget: 100 }, { beforeBudget: -1 }])("leaves uncertain or mismatched scope unverified", patch => {
  expect(assessBudgetReconciliation({ ...base, ...patch })).toMatchObject({ state: "unverified", observedBudget: null, retryAllowed: false, undoAllowed: false });
 });
});
