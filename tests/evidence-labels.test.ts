import { describe, expect, it } from "vitest";
import { evidenceMessageKey } from "@/lib/automation/evidence-labels";
import { makeT } from "@/lib/i18n/translate";

describe("snapshot evidence explanations", () => {
  it.each(["campaign_attributed_revenue", "approved_break_even_roas", "campaign_attribution_coverage", "verified_learning_status", "verified_budget_currency_unit", "daily_period_spend_mismatch"])("provides translated explanation for %s", code => {
    const key = evidenceMessageKey(code);
    expect(key).not.toBe("overview.evidence.unknown");
    for (const locale of ["vi", "en"] as const) {
      const text = makeT(locale)(key);
      expect(text).not.toBe(key);
      expect(text.length).toBeGreaterThan(20);
    }
  });
  it.each(["unknown_future_source", "__proto__", "constructor"])("uses safe fallback for %s", code => {
    expect(evidenceMessageKey(code)).toBe("overview.evidence.unknown");
  });
});
