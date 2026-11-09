// ─────────────────────────────────────────────
// Competitor Ad Tracker — File-Backed Store
// Storage: data/competitors.json
// Reads: fs.readFileSync (sync, fresh from disk every call — no cache,
//        so there is nothing to invalidate/go stale).
// Writes: withFileLock + writeFileAtomicSync, matching the convention used
//         by lib/audience-tracker.ts, lib/jobs/store.ts, lib/tenants/registry.ts.
// ─────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import type {
  Competitor,
  CompetitorAd,
  CompetitorInsight,
} from "./competitor-config";
import { DEFAULT_COMPETITORS } from "./competitor-config";
import { hasModule } from "@/lib/companies";

// ── File I/O ──

const DATA_PATH = path.join(process.cwd(), "data", "competitors.json");

interface CompetitorStoreData {
  competitors: Competitor[];
  ads: CompetitorAd[];
  insights: CompetitorInsight[];
}

function defaultData(): CompetitorStoreData {
  return {
    competitors: hasModule("matbao") ? [...DEFAULT_COMPETITORS] : [], // Đợt 21 B: bản cài khách bắt đầu TRỐNG (danh sách mẫu là của Mắt Bão)
    ads: [],
    insights: [],
  };
}

function readData(): CompetitorStoreData {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw) as CompetitorStoreData;
  } catch {
    return defaultData();
  }
}

function writeData(data: CompetitorStoreData): void {
  writeFileAtomicSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ── Competitors CRUD ──

export function getCompetitors(): Competitor[] {
  return readData().competitors;
}

export function getCompetitorById(id: string): Competitor | undefined {
  return readData().competitors.find((c) => c.id === id);
}

export async function addCompetitor(
  c: Omit<Competitor, "id" | "addedAt" | "isActive">
): Promise<Competitor> {
  return withFileLock(DATA_PATH, async () => {
    const data = readData();
    const newComp: Competitor = {
      ...c,
      id:
        c.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 20) +
        "-" +
        Date.now().toString(36),
      isActive: true,
      addedAt: new Date().toISOString(),
    };
    data.competitors.push(newComp);
    writeData(data);
    return newComp;
  });
}

export async function removeCompetitor(id: string): Promise<boolean> {
  return withFileLock(DATA_PATH, async () => {
    const data = readData();
    const idx = data.competitors.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    data.competitors.splice(idx, 1);
    // Also remove their ads
    data.ads = data.ads.filter((a) => a.competitorId !== id);
    writeData(data);
    return true;
  });
}

// ── Ads CRUD ──

export function getAllAds(): CompetitorAd[] {
  return readData().ads;
}

export function getAdsByCompetitor(competitorId: string): CompetitorAd[] {
  return readData().ads.filter((a) => a.competitorId === competitorId);
}

export function getAdCounts(): Record<string, { total: number; new7d: number }> {
  const data = readData();
  const now = Date.now();
  const counts: Record<string, { total: number; new7d: number }> = {};
  for (const c of data.competitors) {
    const ads = data.ads.filter((a) => a.competitorId === c.id);
    counts[c.id] = {
      total: ads.length,
      new7d: ads.filter((a) => now - new Date(a.fetchedAt).getTime() < 7 * 86400000).length,
    };
  }
  return counts;
}

export async function upsertAd(ad: CompetitorAd): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    const idx = data.ads.findIndex((a) => a.fbAdId === ad.fbAdId);
    if (idx >= 0) {
      data.ads[idx] = { ...data.ads[idx], ...ad };
    } else {
      data.ads.push(ad);
    }
    writeData(data);
  });
}

export async function clearAdsForCompetitor(competitorId: string): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.ads = data.ads.filter((a) => a.competitorId !== competitorId);
    writeData(data);
  });
}

export async function updateAdAnalysis(
  fbAdId: string,
  analysis: { aiHook: string; aiAngle: string; aiScore: number; aiInsight: CompetitorAd["aiInsight"] }
): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    const ad = data.ads.find((a) => a.fbAdId === fbAdId);
    if (ad) {
      ad.aiHook = analysis.aiHook;
      ad.aiAngle = analysis.aiAngle;
      ad.aiScore = analysis.aiScore;
      ad.aiInsight = analysis.aiInsight;
      ad.analyzedAt = new Date().toISOString();
      writeData(data);
    }
  });
}

// ── Insights ──

export function getLatestInsight(competitorId: string): CompetitorInsight | null {
  const insights = readData().insights;
  const forComp = insights.filter((i) => i.competitorId === competitorId || competitorId === "all");
  return forComp.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

export async function saveInsight(insight: CompetitorInsight): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.insights.push(insight);
    writeData(data);
  });
}
