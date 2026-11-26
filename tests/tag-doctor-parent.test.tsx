import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ swr: vi.fn() }));
vi.mock("swr", () => ({ default: state.swr }));
vi.mock("@/components/measure/GtmFixPanel", () => ({ GtmFixPanel: () => null }));
vi.mock("@/components/measure/TagDoctorFixPanel", () => ({ ExecutionCard: () => null, TagDoctorFixPanel: () => null }));
import { TagDoctorView } from "@/components/measure/TagDoctorView";
import { I18nProvider } from "@/lib/i18n/client";
import { ApiError } from "@/components/case/api";
const render = () => renderToStaticMarkup(<I18nProvider locale="en"><TagDoctorView company="MBC" range={{ from: "2026-11-01", to: "2026-11-26" }} /></I18nProvider>);
describe("actual Tag Doctor parent render boundaries (SWR mocked)", () => {
  beforeEach(() => { state.swr.mockReset(); });
  it("renders loading without evidence", () => {
    state.swr.mockReturnValue({ isLoading: true });
    const html = render();
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Tracking evidence");
    expect(state.swr).toHaveBeenCalledTimes(1);
    expect(state.swr.mock.calls[0][0]).toContain("company=MBC");
  });
  it.each([new Error("network"), new ApiError("Forbidden (403)")])("renders parent error without evidence", error => {
    state.swr.mockReturnValue({ isLoading: false, error });
    const html = render();
    expect(html).toContain(error instanceof ApiError ? "Forbidden (403)" : "Error while loading tag diagnosis data");
    expect(html).not.toContain("Tracking evidence");
    expect(html).toContain("<button");
  });
  it("renders an empty legacy response with unknown evidence and no invented time", () => {
    state.swr.mockReturnValue({ isLoading: false, data: {
      current: true, company: "MBC", range: { from: "2026-11-01", to: "2026-11-26" },
      roadmap: [], sources: [], canonical: [], gtm: [], issues: [], dualSource: [], fixes: [], gtmFixes: [], history: [],
      gtmFix: { apiConfigured: false, history: [] },
    } });
    const html = render();
    expect(html).toContain("No evidence from the current reader");
    expect(html).not.toContain("<time");
  });
});
