import React from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefReviewPanel } from "@/components/creative/BriefReviewPanel";
import { I18nProvider } from "@/lib/i18n/client";
import type { BriefDraft } from "@/lib/creative-brief/types";
const draft: BriefDraft = {
  id: "fixture-draft", name: "Fixture", revision: 1, contentHash: "fixture-hash", createdAt: "2026-11-27T00:00:00Z", updatedAt: "2026-11-27T00:00:00Z",
  output: {
    id: "generated-fixture", generatedAt: "2026-11-27T00:00:00Z", company: "MBC", platform: "facebook", product: { key: "hosting", displayName: "Hosting", category: "test" }, objective: "conversion", funnelStage: "bottom",
    audienceSummary: { primaryPersona: "test", size: "niche", topPainPoints: [], motivators: [], sophistication: "beginner" }, painPoints: [], usp: "original", valueProposition: "value", proofPoints: [], toneStrategy: { primaryTone: "plain", voiceGuidance: "plain", avoid: [] }, ctaStrategy: { primaryCta: "Read", urgencyFrame: "none", intent: "test" }, complianceNotes: [], sensitiveTerms: [],
  },
  input: { company: "MBC", platform: "facebook", product: "hosting", objective: "conversion", funnelStage: "bottom", selectedSegments: [] },
};
for (const locale of ["vi", "en"] as const) {
  it(`renders real review panel read-only and unreviewed in ${locale}`, () => {
    const html = renderToStaticMarkup(<I18nProvider locale={locale}><BriefReviewPanel draft={draft} canEdit={false} onChange={() => {}} /></I18nProvider>);
    expect(html).toContain(locale === "vi" ? "Chưa rà soát" : "Unreviewed");
    expect(html).toContain(locale === "vi" ? "không xác nhận" : "does not confirm");
    expect(html).toContain("fixture-hash"); expect(html).not.toContain("<input"); expect(html).not.toContain("<button");
    const reviewed = renderToStaticMarkup(<I18nProvider locale={locale}><BriefReviewPanel draft={{ ...draft, review: { revision: 1, contentHash: "fixture-hash", actorId: "server-reviewer", reviewedAt: "2026-11-27T01:00:00Z" } }} canEdit={false} onChange={() => {}} /></I18nProvider>);
    expect(reviewed).toContain(locale === "vi" ? "Đã rà soát nội dung" : "Content reviewed"); expect(reviewed).toContain("server-reviewer");
  });
}

it("renders editor actions for actual content, disables no-op save and repeat review", () => {
  const render = (reviewed: boolean) => renderToStaticMarkup(<I18nProvider locale="en"><BriefReviewPanel draft={{ ...draft, ...(reviewed ? { review: { revision: 1, contentHash: "fixture-hash", actorId: "reviewer", reviewedAt: "2026-11-27T01:00:00Z" } } : {}) }} canEdit={true} onChange={() => {}} /></I18nProvider>);
  const unreviewed = render(false);
  expect(unreviewed).toContain('value="original"');
  expect(unreviewed).toMatch(/<button[^>]*disabled=""[^>]*>Save new revision/);
  expect(unreviewed).toMatch(/<button(?![^>]*disabled="")[^>]*>Record content review/);
  expect(render(true)).toMatch(/<button[^>]*disabled=""[^>]*>Record content review/);
});
