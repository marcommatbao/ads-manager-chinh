import { describe, expect, it } from "vitest";
import { shouldBlockAiAnalysis, type BriefingEvidence } from "@/lib/morning-briefing";

const evidence = (status: BriefingEvidence["status"], source: BriefingEvidence["source"] = "meta"): BriefingEvidence => ({
  id: "test",
  source,
  from: "2026-11-17",
  to: "2026-11-17",
  readAt: "2026-11-18T00:00:00.000Z",
  status,
  critical: status === "unavailable",
});

describe("morning briefing AI quality gate", () => {
  it("blocks AI when a Meta source is unavailable", () => {
    expect(shouldBlockAiAnalysis([evidence("complete"), evidence("unavailable")])).toBe(true);
  });

  it("allows analysis when sources are complete or partial", () => {
    expect(shouldBlockAiAnalysis([evidence("complete"), evidence("partial")])).toBe(false);
  });

  it("does not treat an existing fallback record as a source failure", () => {
    expect(shouldBlockAiAnalysis([evidence("partial", "fallback")])).toBe(false);
  });
});
