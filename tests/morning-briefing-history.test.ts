import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBriefingHistory, saveBriefing } from "@/lib/morning-briefing-history";
import type { MorningBriefing } from "@/lib/morning-briefing";

const historyPath = path.join(process.cwd(), "data", "morning-briefing-history.json");

function briefing(generatedAt: string): MorningBriefing {
  return {
    date: "2026-11-18",
    generatedAt,
    currency: "VND",
    yesterday: { totalSpend: 1, impressions: 1, clicks: 1, avgCTR: 1, avgCPC: 1, avgCPM: 1, roas: 1, conversions: 1, frequency: 1 },
    last7dAvg: { totalSpend: 1, impressions: 1, clicks: 1, avgCTR: 1, avgCPC: 1, avgCPM: 1, roas: 1, conversions: 1, frequency: 1 },
    monthSoFar: { totalSpend: 1, impressions: 1, clicks: 1, avgCTR: 1, avgCPC: 1, avgCPM: 1, roas: 1, conversions: 1, frequency: 1 },
    alerts: [],
    anomalies: [],
    topCampaigns: [],
    needAttention: [],
    aiSummary: "test",
    forecast: { estimatedMonthSpend: 1, daysLeft: 1, dailyAvg: 1 },
    dataGaps: [],
    evidence: [],
    generationMode: "fallback",
  };
}

afterEach(() => {
  try { fs.unlinkSync(historyPath); } catch { /* test file may not exist */ }
});

describe("morning briefing history", () => {
  it("persists, returns newest first, and deduplicates generatedAt", async () => {
    await saveBriefing(briefing("2026-11-18T02:00:00.000Z"));
    await saveBriefing(briefing("2026-11-18T03:00:00.000Z"));
    await saveBriefing(briefing("2026-11-18T03:00:00.000Z"));

    const entries = getBriefingHistory(10);
    expect(entries.map((entry) => entry.generatedAt)).toEqual([
      "2026-11-18T03:00:00.000Z",
      "2026-11-18T02:00:00.000Z",
    ]);
  });

  it("caps history at 90 entries", async () => {
    for (let i = 0; i < 95; i += 1) {
      await saveBriefing(briefing(`2026-11-18T00:${String(i).padStart(2, "0")}:00.000Z`));
    }
    expect(getBriefingHistory(100)).toHaveLength(90);
  });
});
