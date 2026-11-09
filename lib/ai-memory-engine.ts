// ============================================================
// AI Memory Engine — Self-Learning Feedback Loop
// Storage: data/ai-memories.json
// ============================================================

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import {
  getAllSegments,
  getUsagesForSegment,
  type AudienceSegmentRecord,
  type CampaignUsageRecord,
} from "./audience-tracker";

// ── Types ──

export interface AiMemory {
  id: string;

  // Context (matching keys)
  company: string; // MBC | MBI
  product: string;
  funnelStage: string; // TOFU | MOFU | BOFU
  objective: string;

  // Audience characteristics
  ageRange: string; // "24-45"
  locations: string[]; // ["HCM", "HN"]
  incomeRange: string; // "15-50tr"
  keyInterests: string[]; // top 3 interests

  // Actual performance
  actualCpl: number;
  actualCtr: number;
  actualFrequency: number | null;
  actualWinRate: number; // 0-1
  sampleSize: number;

  // AI prediction
  predictedCpl: number | null;
  predictedCtr: string;
  predictionError: number | null; // % deviation

  // Lessons learned
  winningFactors: string[];
  losingFactors: string[];
  bestAgeGroup: string | null;
  bestLocation: string | null;
  bestTime: string | null;

  // Meta
  confidence: number; // 0-1
  createdAt: string;
  updatedAt: string;
}

interface MemoryStore {
  memories: AiMemory[];
}

export interface AiLearningLogEntry {
  id: string;
  segmentId: string;
  status: "LEARNED" | "SKIPPED";
  reasons: string[];
  metrics: Record<string, unknown>;
  createdAt: string;
}

interface LearningLogStore {
  logs: AiLearningLogEntry[];
  exploreCount: number; // tracks analysis count for explore/exploit
}

// ── File I/O ──

const DATA_PATH = path.join(process.cwd(), "data", "ai-memories.json");

function readMemories(): MemoryStore {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw) as MemoryStore;
  } catch {
    return { memories: [] };
  }
}

function writeMemories(data: MemoryStore): void {
  writeFileAtomicSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ── Learning Log I/O ──

const LOG_PATH = path.join(process.cwd(), "data", "ai-learning-log.json");

function readLearningLog(): LearningLogStore {
  try {
    const raw = fs.readFileSync(LOG_PATH, "utf-8");
    return JSON.parse(raw) as LearningLogStore;
  } catch {
    return { logs: [], exploreCount: 0 };
  }
}

function writeLearningLog(data: LearningLogStore): void {
  writeFileAtomicSync(LOG_PATH, JSON.stringify(data, null, 2));
}

function appendLearningLog(entry: AiLearningLogEntry): void {
  const store = readLearningLog();
  store.logs.push(entry);
  // Keep last 500 entries
  if (store.logs.length > 500) store.logs = store.logs.slice(-500);
  writeLearningLog(store);
}

// ── Cache (6h TTL — avoids re-reading JSON on every request) ──

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const memoryCache = new Map<string, { data: AiMemory[]; expiresAt: number }>();

function invalidateCache() {
  memoryCache.clear();
}

// ── Learning Guard Thresholds ──

const LEARNING_GUARD = {
  minCampaigns: 2,
  minTotalSpend: 200000,
  maxCplRatio: 3.0,
  cplThresholds: { MBC: 200000, MBI: 150000 } as Record<string, number>,
};

// ── Special Events Calendar (VN) — avoid noisy data ──

const SPECIAL_EVENTS_VN = [
  // Tết Nguyên Đán
  { name: "Tết 2026", from: "2026-01-26", to: "2026-02-05" },
  { name: "Tết 2027", from: "2027-02-14", to: "2027-02-20" },
  // Lễ cố định (MM = placeholder for year)
  { name: "30/4-1/5", from: "MM-04-28", to: "MM-05-02" },
  { name: "Quốc Khánh", from: "MM-09-01", to: "MM-09-04" },
  { name: "Black Friday", from: "MM-11-25", to: "MM-11-30" },
  { name: "12/12 Sale", from: "MM-12-10", to: "MM-12-13" },
  { name: "Giáng Sinh", from: "MM-12-23", to: "MM-12-27" },
];

export function isSpecialPeriod(date: Date): { isSpecial: boolean; eventName?: string } {
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const year = dateStr.slice(0, 4);

  for (const event of SPECIAL_EVENTS_VN) {
    const from = event.from.replace("MM", year);
    const to = event.to.replace("MM", year);
    if (dateStr >= from && dateStr <= to) {
      return { isSpecial: true, eventName: event.name };
    }
  }
  return { isSpecial: false };
}

function isCtrAnomaly(ctr: number): boolean {
  return ctr < 0.1 || ctr > 10;
}

// ── Explore / Exploit Counter ──

export function getAndIncrementExploreCount(): { count: number; isExplore: boolean } {
  const store = readLearningLog();
  store.exploreCount += 1;
  const isExplore = (store.exploreCount % 5) === 0; // every 5th = explore
  writeLearningLog(store);
  return { count: store.exploreCount, isExplore };
}

// ── Core Functions ──

/**
 * Get relevant memories for a given context.
 * Uses 6h in-memory cache. Filters out low-confidence and low-sample memories.
 */
export function getRelevantMemories(context: {
  company: string;
  funnelStage?: string;
  product?: string;
  objective?: string;
}): AiMemory[] {
  const cacheKey = `${context.company}:${context.funnelStage ?? "ALL"}:${context.product ?? "ALL"}`;
  const cached = memoryCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data; // cache hit
  }

  const store = readMemories();

  // Filter: company match + minimum quality
  let relevant = store.memories.filter(
    (m) => m.company === context.company && m.sampleSize >= 2 && m.confidence >= 0.4
  );

  if (context.funnelStage) {
    const exactMatch = relevant.filter((m) => m.funnelStage === context.funnelStage);
    if (exactMatch.length >= 2) {
      relevant = exactMatch;
    }
  }

  if (context.product) {
    const productMatch = relevant.filter((m) => m.product === context.product);
    const others = relevant.filter((m) => m.product !== context.product);
    relevant = [...productMatch, ...others];
  }

  // Sort by confidence × log(sampleSize) descending
  relevant.sort((a, b) => {
    const scoreA = a.confidence * Math.log2(a.sampleSize + 1);
    const scoreB = b.confidence * Math.log2(b.sampleSize + 1);
    return scoreB - scoreA;
  });

  const top5 = relevant.slice(0, 5);

  // Cache result
  memoryCache.set(cacheKey, { data: top5, expiresAt: Date.now() + CACHE_TTL_MS });

  return top5;
}

/**
 * Compress a memory into ~40 tokens (vs ~200 tokens for the full version).
 * 5 memories ≈ 200 tokens instead of 1,000 → saves ~80% tokens.
 */
function compressMemory(m: AiMemory): string {
  return [
    `[${m.funnelStage}·${m.company}]`,
    `Tuổi:${m.ageRange}`,
    `CPL:₫${Math.round(m.actualCpl / 1000)}K`,
    `CTR:${m.actualCtr.toFixed(1)}%`,
    `WinRate:${Math.round(m.actualWinRate * 100)}%`,
    `n=${m.sampleSize}campaigns`,
    m.bestAgeGroup ? `BestAge:${m.bestAgeGroup}` : "",
    m.bestLocation ? `BestLoc:${m.bestLocation}` : "",
    m.winningFactors?.length ? `Win:${m.winningFactors.slice(0, 2).join(",")}` : "",
    m.losingFactors?.length ? `Lose:${m.losingFactors.slice(0, 1).join(",")}` : "",
  ].filter(Boolean).join(" | ");
}

/**
 * Build a compact prompt section from memories to inject into Gemini prompt.
 * Uses compressed format to save tokens while preserving key insights.
 */
export function buildMemoryPromptSection(memories: AiMemory[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m, i) => `${i + 1}. ${compressMemory(m)}`).join("\n");

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 LỊCH SỬ THẬT MBC/MBI (${memories.length} records):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${lines}

Dựa vào lịch sử: điều chỉnh CPL/CTR, ưu tiên winning factors, tránh losing factors, chọn age/location tối ưu.
`;
}

/**
 * Learn from a segment's campaign performance data.
 * Called after campaigns have run and have real metrics.
 */
export function learnFromSegment(segmentId: string): AiMemory | null {
  const segments = getAllSegments();
  const segment = segments.find((s) => s.id === segmentId);
  if (!segment) return null;

  const usages = getUsagesForSegment(segmentId);
  if (usages.length === 0) return null;

  // ── FIX 3: Learning guards — skip unreliable data ──
  if (usages.length < LEARNING_GUARD.minCampaigns) {
    console.log(`⏭️ Skip learning: ${segment.name} — only ${usages.length} campaigns (need ${LEARNING_GUARD.minCampaigns})`);
    return null;
  }

  const totalSpend = usages.reduce((s, u) => s + (u.spend ?? 0), 0);
  if (totalSpend < LEARNING_GUARD.minTotalSpend) {
    console.log(`⏭️ Skip learning: ${segment.name} — spend ₫${totalSpend} < ₫${LEARNING_GUARD.minTotalSpend}`);
    return null;
  }

  // Calculate aggregates
  const cplVals = usages.filter((u) => u.cpl != null).map((u) => u.cpl!);
  const ctrVals = usages.filter((u) => u.ctr != null).map((u) => u.ctr!);
  const avgCpl = cplVals.length > 0 ? cplVals.reduce((a, b) => a + b, 0) / cplVals.length : 0;
  const avgCtr = ctrVals.length > 0 ? ctrVals.reduce((a, b) => a + b, 0) / ctrVals.length : 0;
  const winRate = usages.filter((u) => u.metKpi).length / usages.length;

  // FIX 3: Skip CPL outliers
  const cplThreshold = LEARNING_GUARD.cplThresholds[segment.company] ?? 200000;
  if (avgCpl > cplThreshold * LEARNING_GUARD.maxCplRatio) {
    console.log(`⏭️ Skip learning: ${segment.name} — CPL ₫${Math.round(avgCpl)} is outlier (> ${LEARNING_GUARD.maxCplRatio}× threshold)`);
    return null;
  }

  // Calculate prediction error
  const predictedCplNum = segment.predictedCpl;
  const predictionError = predictedCplNum && avgCpl > 0
    ? ((avgCpl - predictedCplNum) / predictedCplNum) * 100
    : null;

  // Determine winning/losing factors
  const winningFactors = analyzeWinningFactors(segment, avgCpl, avgCtr, usages);
  const losingFactors = analyzeLosingFactors(segment, avgCpl, avgCtr, usages);

  // Calculate confidence
  const confidence = calculateConfidence(usages.length, winRate);

  // Build memory record
  const memory: AiMemory = {
    id: `mem_${randomBytes(8).toString("hex")}`,
    company: segment.company,
    product: segment.product,
    funnelStage: segment.funnelStage,
    objective: segment.objective,
    ageRange: segment.demographics.age,
    locations: segment.demographics.location,
    incomeRange: segment.demographics.income,
    keyInterests: segment.interests.slice(0, 3),
    actualCpl: avgCpl,
    actualCtr: avgCtr,
    actualFrequency: null,
    actualWinRate: winRate,
    sampleSize: usages.length,
    predictedCpl: segment.predictedCpl ?? null,
    predictedCtr: segment.predictedCtr,
    predictionError,
    winningFactors,
    losingFactors,
    bestAgeGroup: null,
    bestLocation: segment.demographics.location?.[0] ?? null,
    bestTime: null,
    confidence,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Upsert: merge if same company + funnelStage + product exists
  const store = readMemories();
  const existingIdx = store.memories.findIndex(
    (m) =>
      m.company === memory.company &&
      m.funnelStage === memory.funnelStage &&
      m.product === memory.product &&
      m.ageRange === memory.ageRange
  );

  if (existingIdx >= 0) {
    // Merge with weighted average
    const existing = store.memories[existingIdx];
    const totalSamples = existing.sampleSize + memory.sampleSize;
    const w1 = existing.sampleSize / totalSamples;
    const w2 = memory.sampleSize / totalSamples;

    store.memories[existingIdx] = {
      ...existing,
      actualCpl: existing.actualCpl * w1 + memory.actualCpl * w2,
      actualCtr: existing.actualCtr * w1 + memory.actualCtr * w2,
      actualWinRate: existing.actualWinRate * w1 + memory.actualWinRate * w2,
      sampleSize: totalSamples,
      predictionError: memory.predictionError,
      winningFactors: [...new Set([...existing.winningFactors, ...memory.winningFactors])].slice(0, 5),
      losingFactors: [...new Set([...existing.losingFactors, ...memory.losingFactors])].slice(0, 5),
      confidence: Math.max(existing.confidence, memory.confidence),
      updatedAt: new Date().toISOString(),
    };
  } else {
    store.memories.push(memory);
  }

  writeMemories(store);
  invalidateCache(); // bust cache after write

  console.log(`🧠 AI Memory updated: ${memory.company}/${memory.funnelStage}/${memory.product}
    CPL: ₫${Math.round(avgCpl)} | CTR: ${avgCtr.toFixed(2)}%
    Win rate: ${(winRate * 100).toFixed(0)}% | Confidence: ${(confidence * 100).toFixed(0)}%
    Error: ${predictionError !== null ? predictionError.toFixed(1) + "%" : "N/A"}`);

  return memory;
}

/**
 * Run full learning cycle — scan ALL segments with campaign data and learn.
 */
export function runLearningCycle(): {
  memoriesUpdated: number;
  memoriesCreated: number;
  totalMemories: number;
} {
  const segments = getAllSegments();
  const segmentsWithData = segments.filter((s) => s.totalCampaigns > 0);

  let memoriesUpdated = 0;
  let memoriesCreated = 0;

  const storeBefore = readMemories();
  const countBefore = storeBefore.memories.length;

  for (const segment of segmentsWithData) {
    const result = learnFromSegment(segment.id);
    if (result) {
      const storeAfter = readMemories();
      if (storeAfter.memories.length > countBefore + memoriesCreated) {
        memoriesCreated++;
      } else {
        memoriesUpdated++;
      }
    }
  }

  const finalStore = readMemories();

  console.log(`🧠 Learning cycle complete:
    Segments scanned: ${segmentsWithData.length}
    Memories created: ${memoriesCreated}
    Memories updated: ${memoriesUpdated}
    Total memories: ${finalStore.memories.length}`);

  return {
    memoriesUpdated,
    memoriesCreated,
    totalMemories: finalStore.memories.length,
  };
}

/**
 * Get all memories (for admin/debug view).
 */
export function getAllMemories(): AiMemory[] {
  return readMemories().memories;
}

/**
 * Get memory stats.
 */
export function getMemoryStats(): {
  totalMemories: number;
  avgConfidence: number;
  topProduct: string | null;
  totalSamples: number;
  avgPredictionError: number | null;
} {
  const memories = readMemories().memories;
  if (memories.length === 0) {
    return {
      totalMemories: 0,
      avgConfidence: 0,
      topProduct: null,
      totalSamples: 0,
      avgPredictionError: null,
    };
  }

  const avgConfidence = memories.reduce((s, m) => s + m.confidence, 0) / memories.length;
  const totalSamples = memories.reduce((s, m) => s + m.sampleSize, 0);

  // Top product by sample count
  const productCounts: Record<string, number> = {};
  for (const m of memories) {
    productCounts[m.product] = (productCounts[m.product] ?? 0) + m.sampleSize;
  }
  const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Avg prediction error
  const errors = memories.filter((m) => m.predictionError !== null).map((m) => Math.abs(m.predictionError!));
  const avgPredictionError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : null;

  return { totalMemories: memories.length, avgConfidence, topProduct, totalSamples, avgPredictionError };
}

// ── Internal Helpers ──

function analyzeWinningFactors(
  segment: AudienceSegmentRecord,
  avgCpl: number,
  avgCtr: number,
  usages: CampaignUsageRecord[]
): string[] {
  const factors: string[] = [];

  if (segment.predictedCpl && avgCpl < segment.predictedCpl) {
    factors.push("CPL thấp hơn dự đoán AI");
  }
  if (avgCtr > 2.0) {
    factors.push("CTR cao > 2% — creative phù hợp");
  }
  if (avgCtr > 1.5 && avgCtr <= 2.0) {
    factors.push("CTR khá tốt 1.5-2%");
  }

  const winRate = usages.filter((u) => u.metKpi).length / usages.length;
  if (winRate > 0.7) {
    factors.push("Win rate > 70% — segment rất ổn định");
  }

  if (segment.funnelStage === "BOFU" && avgCpl < 100000) {
    factors.push("BOFU CPL < 100K — chất lượng leads cao");
  }

  if (segment.competitionLevel === "low") {
    factors.push("Cạnh tranh thấp — audience fresh");
  }

  return factors.length > 0 ? factors : ["Chưa đủ data để đánh giá"];
}

function analyzeLosingFactors(
  segment: AudienceSegmentRecord,
  avgCpl: number,
  avgCtr: number,
  usages: CampaignUsageRecord[]
): string[] {
  const factors: string[] = [];

  if (segment.predictedCpl && avgCpl > segment.predictedCpl * 1.3) {
    factors.push(`CPL cao hơn dự đoán ${Math.round(((avgCpl - segment.predictedCpl) / segment.predictedCpl) * 100)}%`);
  }
  if (avgCtr < 1.0) {
    factors.push("CTR thấp < 1% — creative hoặc targeting chưa phù hợp");
  }

  const winRate = usages.filter((u) => u.metKpi).length / usages.length;
  if (winRate < 0.3) {
    factors.push("Win rate < 30% — cần review lại segment");
  }

  if (segment.competitionLevel === "high" && avgCpl > 150000) {
    factors.push("Cạnh tranh cao + CPL cao — cân nhắc segment khác");
  }

  return factors;
}

function calculateConfidence(sampleSize: number, winRate: number): number {
  const dataBonusPerSample = 0.05;
  const dataBonus = Math.min(0.35, sampleSize * dataBonusPerSample);
  const winBonus = winRate * 0.30;
  return Math.min(0.95, 0.30 + dataBonus + winBonus);
}

// ── Safe Learn (with all guards) ──

export interface SafeLearnInput {
  segmentId: string;
  campaignId: string;
  company: string;
  actualCpl: number;
  actualCtr: number;
  actualFreq?: number;
  metKpi: boolean;
  spend: number;
  startDate: string; // ISO date
  endDate: string;   // ISO date
  fbError?: boolean;
}

/**
 * Learn from a campaign with full safety guards.
 * Checks: spend, special events, CPL outlier, CTR anomaly, FB errors.
 * Logs every decision (learned vs skipped) to ai-learning-log.json.
 */
export function safeLearnFromSegment(data: SafeLearnInput): {
  learned: boolean;
  reasons: string[];
} {
  const skipReasons: string[] = [];

  // Guard 1: Low spend
  if (data.spend < LEARNING_GUARD.minTotalSpend) {
    skipReasons.push(`Spend quá thấp: ₫${data.spend.toLocaleString()}`);
  }

  // Guard 2: Special event period
  const startCheck = isSpecialPeriod(new Date(data.startDate));
  const endCheck = isSpecialPeriod(new Date(data.endDate));
  if (startCheck.isSpecial || endCheck.isSpecial) {
    skipReasons.push(`Kỳ đặc biệt: ${startCheck.eventName || endCheck.eventName}`);
  }

  // Guard 3: CPL outlier
  const cplThreshold = LEARNING_GUARD.cplThresholds[data.company] ?? 200000;
  if (data.actualCpl > cplThreshold * LEARNING_GUARD.maxCplRatio) {
    skipReasons.push(`CPL outlier: ₫${data.actualCpl.toLocaleString()} (> ${LEARNING_GUARD.maxCplRatio}× ngưỡng)`);
  }

  // Guard 4: FB API error
  if (data.fbError) {
    skipReasons.push("FB API có lỗi trong kỳ này");
  }

  // Guard 5: CTR anomaly
  if (isCtrAnomaly(data.actualCtr)) {
    skipReasons.push(`CTR bất thường: ${data.actualCtr}%`);
  }

  const logEntry: AiLearningLogEntry = {
    id: `log_${randomBytes(6).toString("hex")}`,
    segmentId: data.segmentId,
    status: skipReasons.length > 0 ? "SKIPPED" : "LEARNED",
    reasons: skipReasons,
    metrics: {
      campaignId: data.campaignId,
      company: data.company,
      cpl: data.actualCpl,
      ctr: data.actualCtr,
      spend: data.spend,
    },
    createdAt: new Date().toISOString(),
  };

  if (skipReasons.length > 0) {
    console.log(`⚠️ Skip learning [${data.campaignId}]:`);
    skipReasons.forEach((r) => console.log(`   - ${r}`));
    appendLearningLog(logEntry);
    return { learned: false, reasons: skipReasons };
  }

  // All guards passed → learn normally
  const result = learnFromSegment(data.segmentId);
  appendLearningLog(logEntry);

  if (result) {
    console.log(`✅ Learned from campaign ${data.campaignId}`);
  }

  return { learned: !!result, reasons: [] };
}

// ── Gemini Timeout Wrapper ──

/**
 * Call an async function with a timeout.
 * If timeout is reached, returns null.
 */
export async function callWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 25000
): Promise<{ result: T | null; timedOut: boolean }> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__TIMEOUT__")), timeoutMs)
      ),
    ]);
    return { result, timedOut: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "__TIMEOUT__") {
      console.warn(`⚠️ Gemini timeout after ${timeoutMs}ms`);
      return { result: null, timedOut: true };
    }
    throw err; // re-throw non-timeout errors
  }
}

// ── Learning Stats (for admin dashboard) ──

export function getLearningStats(): {
  totalLearned: number;
  totalSkipped: number;
  skipReasonBreakdown: Record<string, number>;
  exploreCount: number;
  recentLogs: AiLearningLogEntry[];
} {
  const store = readLearningLog();
  const logs = store.logs;

  const learned = logs.filter((l) => l.status === "LEARNED").length;
  const skipped = logs.filter((l) => l.status === "SKIPPED").length;

  // Count skip reasons
  const breakdown: Record<string, number> = {};
  for (const log of logs.filter((l) => l.status === "SKIPPED")) {
    for (const reason of log.reasons) {
      const key = reason.split(":")[0].trim(); // group by prefix
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }
  }

  return {
    totalLearned: learned,
    totalSkipped: skipped,
    skipReasonBreakdown: breakdown,
    exploreCount: store.exploreCount,
    recentLogs: logs.slice(-20), // last 20
  };
}

