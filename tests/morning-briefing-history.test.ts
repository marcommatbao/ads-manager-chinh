import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as HistoryStore from "@/lib/morning-briefing-history";
import type { MorningBriefing } from "@/lib/morning-briefing";

let historyPath: string;
let fixtureDir: string;
let getBriefingHistory: typeof HistoryStore.getBriefingHistory;
let saveBriefing: typeof HistoryStore.saveBriefing;

beforeEach(async () => {
  vi.resetModules();
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "briefing-history-test-"));
  fs.mkdirSync(path.join(fixtureDir, "data"));
  vi.spyOn(process, "cwd").mockReturnValue(fixtureDir);
  historyPath = path.join(fixtureDir, "data", "morning-briefing-history.json");
  ({ getBriefingHistory, saveBriefing } = await import("@/lib/morning-briefing-history"));
});

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
  vi.restoreAllMocks();
  if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
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

  it("normalizes private diagnostics on write and legacy reads without mutating input", async () => {
    const snapshot = briefing("2026-11-18T03:00:00.000Z");
    const privateDetail = "https://provider.invalid/?access_token=synthetic-history-secret";
    snapshot.dataGaps = [`số liệu hôm qua: ${privateDetail}`, privateDetail];
    snapshot.evidence = [{ id: "số liệu hôm qua", source: "meta", from: snapshot.date, to: snapshot.date,
      readAt: snapshot.generatedAt, critical: true, status: "unavailable", note: privateDetail }];
    await saveBriefing(snapshot);
    expect(JSON.stringify(snapshot)).toContain(privateDetail);
    expect(fs.readFileSync(historyPath, "utf8")).not.toContain(privateDetail);

    // Simulate a record written before normalization was introduced.
    fs.writeFileSync(historyPath, JSON.stringify({ entries: [snapshot] }));
    const [normalized] = getBriefingHistory();
    expect(normalized.dataGaps).toEqual(["số liệu hôm qua: Không lấy được dữ liệu nguồn", "Không lấy được dữ liệu nguồn"]);
    expect(normalized.evidence[0].note).toBe("Không lấy được dữ liệu nguồn");
    expect(JSON.stringify(normalized)).not.toContain(privateDetail);
    // Read normalization does not claim an on-disk historical migration.
    expect(fs.readFileSync(historyPath, "utf8")).toContain(privateDetail);
    await saveBriefing(briefing("2026-11-18T04:00:00.000Z"));
    expect(fs.readFileSync(historyPath, "utf8")).not.toContain(privateDetail);
  });

  it("caps history at 90 entries", async () => {
    for (let i = 0; i < 95; i += 1) {
      await saveBriefing(briefing(`2026-11-18T00:${String(i).padStart(2, "0")}:00.000Z`));
    }
    expect(getBriefingHistory(100)).toHaveLength(90);
  });
});
