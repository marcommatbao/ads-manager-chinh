import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceView, type EvidenceState } from "@/components/reports/LeadOrderEvidence";
import { makeT } from "@/lib/i18n/translate";
import type { AttributionAggregate } from "@/lib/attribution/aggregate";

const meta = { company: "MBC", from: "2026-11-01T00:00:00.000Z", to: "2026-11-26T23:59:59.999Z", readAt: "2026-11-27T12:00:00.000Z", scope: "selected_local_store" as const, status: "available" as const, complete: true, reason: null };
const base: AttributionAggregate = { source: { ...meta, source: "csv" }, leadSource: { ...meta, source: "lead_events" }, status: "available", campaignBinding: "not_established", leadCount: 2, uniqueOrders: 3, matchedOrders: 1, unmatchedOrders: 2, ambiguousOrders: 1, duplicateOrders: 1, duplicateConflicts: 0, currencyCount: 1, matchedOrderRate: 1/3, matchedRevenueRate: .5 };
const ready = (report = base): EvidenceState => ({ status: "ready", report, company: "MBC", from: "2026-11-01", to: "2026-11-26" });

for (const locale of ["vi", "en"] as const) {
  const t = makeT(locale);
  const render = (state: EvidenceState) => renderToStaticMarkup(<EvidenceView state={state} t={t} />);
  describe(`evidence component matrix ${locale}`, () => {
    it.each(["loading", "error", "permission"] as const)("renders %s independently of platform report", status => {
      const html = render({ status });
      expect(html).toContain(t(`overview.leadOrderEvidence.${status}`));
      expect(html).toContain(status === "loading" ? 'role="status"' : 'role="alert"');
      expect(html).not.toContain("overview.leadOrderEvidence.");
    });
    it("renders range, actual read time, unique denominator, duplicates and binding limits", () => {
      const html = render(ready());
      for (const key of ["title", "uniqueOrders", "duplicateConflicts", "ambiguousOrders", "limits", "binding"] as const) expect(html).toContain(t(`overview.leadOrderEvidence.${key}`));
      expect(html).toContain("2026-11-27T12:00:00.000Z"); expect(html).toContain("2026-11-01");
      expect(html).toContain("33.3%"); expect(html).toContain("50.0%");
      expect(html).not.toMatch(/orderId|leadId|orderKey|overview\.evidence\./);
    });
    it("shows successful empty counts and unknown coverage", () => {
      const html = render(ready({ ...base, leadCount: 0, uniqueOrders: 0, matchedOrders: 0, unmatchedOrders: 0, duplicateOrders: 0, ambiguousOrders: 0, duplicateConflicts: 0, currencyCount: 0, matchedOrderRate: null, matchedRevenueRate: null }));
      expect(html).toContain(t("overview.leadOrderEvidence.empty")); expect(html).toContain("<dd");
      expect(html).toContain(t("overview.leadOrderEvidence.unknown")); expect(html).not.toContain("0.0%");
    });
    it.each(["partial", "unavailable"] as const)("shows %s with reason, null counts, no guessed timestamp", status => {
      const html = render(ready({ ...base, status, uniqueOrders: null, leadCount: null, matchedOrders: null, unmatchedOrders: null, duplicateOrders: null, ambiguousOrders: null, duplicateConflicts: null, currencyCount: null, matchedOrderRate: null, matchedRevenueRate: null,
        source: { ...base.source, status: "unavailable", complete: false, reason: "completeness_unverified", readAt: null },
        leadSource: { ...base.leadSource, status: "unavailable", complete: false, reason: "store_invalid", readAt: null } }));
      expect(html).toContain(t(`overview.leadOrderEvidence.${status}`)); expect(html).toContain(t("overview.leadOrderEvidence.completeness_unverified"));
      expect(html).toContain(t("overview.leadOrderEvidence.store_invalid")); expect(html).not.toContain("2026-11-27T12:00:00.000Z");
      expect(html).toContain('>—</dd>'); expect(html).not.toContain("0.0%");
    });
    it("shows null coverage for conflicts/multiple currencies without inventing revenue", () => {
      const html = render(ready({ ...base, duplicateConflicts: 1, currencyCount: 2, matchedOrderRate: null, matchedRevenueRate: null }));
      expect(html).toContain(t("overview.leadOrderEvidence.unknown")); expect(html).toContain(t("overview.leadOrderEvidence.limits")); expect(html).not.toContain("50.0%");
    });
  });
}
