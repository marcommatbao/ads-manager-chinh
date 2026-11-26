import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { projectTrackingEvidence, TRACKING_LAYERS } from "@/lib/measure/evidence-contract";
import { TrackingEvidencePanel } from "@/components/measure/TrackingEvidencePanel";
import { I18nProvider } from "@/lib/i18n/client";

// TEST ONLY: synthetic report metadata; never a provider receipt.
const now = Date.parse("2026-11-26T01:00:00Z");
const fixture = () => ({ company: "MBC", collectedAt: new Date(now).toISOString(), sources: [{ id: "gtm", label: "TEST ONLY", status: "ok" as const, rows: 1 }], gtm: [{ id: "TEST ONLY", version: "1", pixelTags: [], googleAdsLabels: [{ tagId: "test", sendTo: "TEST ONLY PRIVATE" }] }] });
describe("tracking evidence projection", () => {
  it("observes configuration only and retains no identifiers, payloads or invented timestamps", () => {
    const result = projectTrackingEvidence("MBC", fixture(), now);
    expect(result.layers.map(x => x.layer)).toEqual(TRACKING_LAYERS);
    expect(result.layers[0]).toMatchObject({ status: "observed", sourceRef: "tag-doctor:gtm" });
    expect(result.layers.slice(1).every(x => x.status === "unverified")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|readAt|collectedAt|healthy|TEST ONLY/);
  });
  it.each(["scope", "stale", "future", "invalid", "empty", "partial", "error", "missing"])("fails closed for %s", kind => {
    const report = fixture();
    if (kind === "scope") report.company = "MBI";
    if (kind === "stale") report.collectedAt = new Date(now - 1800001).toISOString();
    if (kind === "future") report.collectedAt = new Date(now + 1).toISOString();
    if (kind === "invalid") report.collectedAt = "invalid";
    if (kind === "empty") report.gtm = [];
    if (kind === "missing") report.sources = [];
    const input = { ...report, sources: report.sources.map(s => ({ ...s, status: kind === "partial" ? "partial" as const : kind === "error" ? "error" as const : s.status })) };
    expect(projectTrackingEvidence("MBC", input, now).layers.every(x => x.status === "unverified")).toBe(true);
  });
  it("does not promote fired screenshots, variable Names, aggregate orders or receipts from extra fields", () => {
    const input = { ...fixture(), fired: true, screenshot: "Variables Names", platformReceived: true, odooOrders: 100, consent: "blocked", currency: "wrong", duplicate: true };
    expect(projectTrackingEvidence("MBC", input, now).layers.slice(1).every(x => x.status === "unverified")).toBe(true);
  });
  it.each(["vi", "en"] as const)("renders localized semantic rows and keyboard disclosures in %s", locale => {
    const html = renderToStaticMarkup(<I18nProvider locale={locale}><TrackingEvidencePanel evidence={projectTrackingEvidence("MBC", fixture(), now)} /></I18nProvider>);
    expect(html.match(/<details/g)).toHaveLength(5);
    expect(html.match(/<summary/g)).toHaveLength(5);
    expect(html).not.toMatch(/meta\.evidence\.|<table|<svg[^>]*role="img"|PRIVATE/);
    expect(html).toContain(locale === "vi" ? "Chưa xác minh" : "Unverified");
    expect(html).toContain("focus-visible:outline");
    expect(renderToStaticMarkup(<I18nProvider locale={locale}><TrackingEvidencePanel /></I18nProvider>)).toContain(locale === "vi" ? "Chưa có bằng chứng" : "No evidence");
  });
});
