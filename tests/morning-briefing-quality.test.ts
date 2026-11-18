import { describe, expect, it, vi } from "vitest";
import { shouldBlockAiAnalysis, generateAiSummaryWithQualityGate, type BriefingEvidence } from "@/lib/morning-briefing";

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

  it("does not call AI generation when a critical source is unavailable", async () => {
    const generate = vi.fn().mockResolvedValue("ai");
    const result = await generateAiSummaryWithQualityGate(
      [evidence("unavailable")],
      generate,
      () => "blocked",
    );
    expect(result).toBe("blocked");
    expect(generate).not.toHaveBeenCalled();
  });

  it("calls AI generation when sources are usable", async () => {
    const generate = vi.fn().mockResolvedValue("ai");
    const result = await generateAiSummaryWithQualityGate(
      [evidence("complete")],
      generate,
      () => "blocked",
    );
    expect(result).toBe("ai");
    expect(generate).toHaveBeenCalledOnce();
  });
});
