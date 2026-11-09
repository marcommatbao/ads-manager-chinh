// ─────────────────────────────────────────────
// Competitor Intelligence Hub — File-Backed Store
// Storage: data/intelligence.json
// Reads: fs.readFileSync (sync, fresh from disk every call — no cache,
//        so there is nothing to invalidate/go stale).
// Writes: withFileLock + writeFileAtomicSync, matching the convention used
//         by lib/audience-tracker.ts, lib/jobs/store.ts, lib/tenants/registry.ts.
// ─────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { scrubLegacyEstimate, type SimilarWebData } from "./similarweb";
import type {
  SimilarWebKey,
  FBKeywordAd,
  GoogleTransparencyData,
  TikTokAdData,
  ChannelAnalysis,
  IntelAlert,
  MarketAnalysis,
} from "./intelligence-config";

// ── Channel Snapshots (for weekly spike comparison) ──
interface ChannelSnapshot {
  competitorId: string;
  weekOf: string;
  scores: Record<string, number>;
  monthlyVisits: number;
  /** Từ 07/10: ảnh chụp chỉ ghi khi SimilarWeb đo đủ. Ảnh cũ thiếu cờ này có thể dựng trên số bịa → không dùng làm mốc so. */
  measured?: boolean;
}

// ── File I/O ──

const DATA_PATH = path.join(process.cwd(), "data", "intelligence.json");

interface IntelligenceStoreData {
  swKeys: SimilarWebKey[];
  swData: Record<string, SimilarWebData>;
  fbKeywordAds: Record<string, FBKeywordAd[]>;
  googleAds: Record<string, GoogleTransparencyData>;
  tiktokAds: Record<string, TikTokAdData[]>;
  channelAnalysis: Record<string, ChannelAnalysis>;
  marketAnalysis: MarketAnalysis | null;
  alerts: IntelAlert[];
  snapshots: ChannelSnapshot[];
  lastSyncAt: string | null;
}

function defaultData(): IntelligenceStoreData {
  return {
    swKeys: [],
    swData: {},
    fbKeywordAds: {},
    googleAds: {},
    tiktokAds: {},
    channelAnalysis: {},
    marketAnalysis: null,
    alerts: [],
    snapshots: [],
    lastSyncAt: null,
  };
}

function readData(): IntelligenceStoreData {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<IntelligenceStoreData>;
    // Merge over defaults so a store written before a schema addition
    // (e.g. an older file missing a newer collection) never crashes reads.
    return { ...defaultData(), ...parsed };
  } catch {
    return defaultData();
  }
}

function writeData(data: IntelligenceStoreData): void {
  writeFileAtomicSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ── SimilarWeb Keys (Rotation — optional paid keys) ──

export function getSWKeys(): SimilarWebKey[] {
  return readData().swKeys;
}

export async function addSWKey(key: SimilarWebKey): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.swKeys.push(key);
    writeData(data);
  });
}

export async function removeSWKey(id: string): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.swKeys = data.swKeys.filter((k) => k.id !== id);
    writeData(data);
  });
}

export function getActiveSWKey(): SimilarWebKey | null {
  const now = Date.now();
  return (
    readData().swKeys.find(
      (k) =>
        k.isActive &&
        new Date(k.expiresAt).getTime() > now &&
        k.usageCount < 500
    ) || null
  );
}

export async function incrementSWKeyUsage(id: string): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    const key = data.swKeys.find((k) => k.id === id);
    if (key) {
      key.usageCount++;
      writeData(data);
    }
  });
}

// ── SimilarWeb Data (duplicated cache for API response, main cache is in similarweb.ts) ──

export function getSWData(domain: string): SimilarWebData | null {
  const sw = readData().swData[domain];
  return sw ? scrubLegacyEstimate(sw) : null;
}

export async function setSWData(domain: string, swData: SimilarWebData): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.swData[domain] = swData;
    writeData(data);
  });
}

export function getAllSWData(): Record<string, SimilarWebData> {
  const all = readData().swData;
  return Object.fromEntries(Object.entries(all).map(([d, sw]) => [d, scrubLegacyEstimate(sw)]));
}

// ── Facebook Keyword Ads ──

export function getFBKeywordAds(competitorId: string): FBKeywordAd[] {
  return readData().fbKeywordAds[competitorId] || [];
}

export async function setFBKeywordAds(competitorId: string, ads: FBKeywordAd[]): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.fbKeywordAds[competitorId] = ads;
    writeData(data);
  });
}

export function getAllFBKeywordAds(): Record<string, FBKeywordAd[]> {
  return { ...readData().fbKeywordAds };
}

// ── Google Transparency ──

export function getGoogleAds(domain: string): GoogleTransparencyData | null {
  return readData().googleAds[domain] || null;
}

export async function setGoogleAds(domain: string, ggData: GoogleTransparencyData): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.googleAds[domain] = ggData;
    writeData(data);
  });
}

export function getAllGoogleAds(): Record<string, GoogleTransparencyData> {
  return { ...readData().googleAds };
}

// ── TikTok Ads ──

export function getTikTokAds(competitorId: string): TikTokAdData[] {
  return readData().tiktokAds[competitorId] || [];
}

export async function setTikTokAds(competitorId: string, ads: TikTokAdData[]): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.tiktokAds[competitorId] = ads;
    writeData(data);
  });
}

export function getAllTikTokAds(): Record<string, TikTokAdData[]> {
  return { ...readData().tiktokAds };
}

// ── Channel Analysis (AI results) ──

export function getChannelAnalysis(competitorId: string): ChannelAnalysis | null {
  return readData().channelAnalysis[competitorId] || null;
}

export async function setChannelAnalysis(
  competitorId: string,
  analysis: ChannelAnalysis
): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.channelAnalysis[competitorId] = analysis;
    writeData(data);
  });
}

export function getAllChannelAnalysis(): Record<string, ChannelAnalysis> {
  return { ...readData().channelAnalysis };
}

// ── Market Analysis (Gemini batch — tất cả đối thủ cùng lúc) ──

export function getMarketAnalysis(): MarketAnalysis | null {
  return readData().marketAnalysis;
}

export async function setMarketAnalysis(analysis: MarketAnalysis): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.marketAnalysis = analysis;
    writeData(data);
  });
}

// ── Alerts ──

export function getAlerts(limit = 20): IntelAlert[] {
  return readData()
    .alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function addAlert(alert: IntelAlert): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.alerts.push(alert);
    writeData(data);
  });
}

export async function markAlertRead(id: string): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    const a = data.alerts.find((al) => al.id === id);
    if (a) {
      a.isRead = true;
      writeData(data);
    }
  });
}

export async function clearAlerts(): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.alerts = [];
    writeData(data);
  });
}

// ── Channel Snapshots (for weekly spike comparison) ──

export async function saveSnapshot(snapshot: ChannelSnapshot): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.snapshots.push(snapshot);
    writeData(data);
  });
}

export function getLastSnapshot(competitorId: string): ChannelSnapshot | null {
  return (
    readData()
      .snapshots.filter((s) => s.competitorId === competitorId && s.measured === true)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0] || null
  );
}

// ── Last Sync Timestamp ──

export function getLastSyncAt(): string | null {
  return readData().lastSyncAt;
}

export async function setLastSyncAt(ts: string): Promise<void> {
  await withFileLock(DATA_PATH, async () => {
    const data = readData();
    data.lastSyncAt = ts;
    writeData(data);
  });
}
