// ============================================================
// Creative Tracker — AdsCommand
// Persistent creative variant storage + AI learning loop
// Storage: data/creative-library.json
// ============================================================

import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";

/** Chuỗi CTR gõ cứng cũ (không phải dự đoán của AI) — bản ghi mang nó coi như chưa có dự đoán. */
export const LEGACY_PLACEHOLDER_CTR = "1.5-2.5%";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CreativePerformance {
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  frequency: number;
  fatigue_score: number;
  date_start: string;
  date_stop: string;
}

export interface CreativeVariant {
  id: string;
  // Creative content
  headline: string;
  primary_text: string;
  description: string;
  cta: string;
  tone_of_voice: string[];
  product: string;
  segment: string;
  platform: "facebook" | "google";
  // Campaign link
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  ad_id?: string;
  linked_at?: string;
  // Performance data
  performance?: CreativePerformance;
  // AI scoring
  ai_quality_score: number;       // 1-10; 0 = chưa chấm
  predicted_ctr_range: string;    // "2.2-3.0%"
  actual_vs_predicted?: number;   // % error
  // AI learning
  prediction_accuracy?: "accurate" | "underestimated" | "overestimated";
  learning_notes?: string;
  // Meta
  status: "draft" | "active" | "paused" | "retired";
  created_at: string;
  generated_by: "ai" | "manual";
  company: string | null;
}

export interface LearningInsight {
  id: string;
  tone: string;
  segment: string;
  learning: string;
  sample_accurate_ctr: number;
  created_at: string;
}

interface CreativeDB {
  creatives: CreativeVariant[];
  learningInsights: LearningInsight[];
}

// ─────────────────────────────────────────────
// File Storage
// ─────────────────────────────────────────────

const DATA_FILE = path.join(process.cwd(), "data", "creative-library.json");
const LOCK_KEY  = "creative-library";

function readDB(): CreativeDB {
  const empty: CreativeDB = { creatives: [], learningInsights: [] };
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return empty;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf-8").trim();
    if (!raw || raw === "[]" || raw === "{}") {
      return empty;
    }
    const parsed = JSON.parse(raw);
    // Handle if file contains bare array or missing keys
    if (Array.isArray(parsed)) {
      return { creatives: parsed as CreativeVariant[], learningInsights: [] };
    }
    return {
      creatives: Array.isArray(parsed.creatives) ? parsed.creatives : [],
      learningInsights: Array.isArray(parsed.learningInsights) ? parsed.learningInsights : [],
    };
  } catch {
    return empty;
  }
}

function writeDB(db: CreativeDB): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

export function getAllCreatives(): CreativeVariant[] {
  return readDB().creatives;
}

export function getCreativeById(id: string): CreativeVariant | undefined {
  return readDB().creatives.find((c) => c.id === id);
}

export async function saveCreative(creative: CreativeVariant): Promise<CreativeVariant> {
  return withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const idx = db.creatives.findIndex((c) => c.id === creative.id);
    if (idx >= 0) {
      db.creatives[idx] = creative;
    } else {
      db.creatives.unshift(creative); // newest first
    }
    writeDB(db);
    return creative;
  });
}

export async function deleteCreative(id: string): Promise<boolean> {
  return withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const before = db.creatives.length;
    db.creatives = db.creatives.filter((c) => c.id !== id);
    writeDB(db);
    return db.creatives.length < before;
  });
}

export async function updateCreativeStatus(
  id: string,
  status: CreativeVariant["status"]
): Promise<CreativeVariant | null> {
  return withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const c = db.creatives.find((cv) => cv.id === id);
    if (!c) return null;
    c.status = status;
    writeDB(db);
    return c;
  });
}

export async function linkCreativeToCampaign(
  id: string,
  campaignId: string,
  campaignName: string
): Promise<CreativeVariant | null> {
  return withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const c = db.creatives.find((cv) => cv.id === id);
    if (!c) return null;
    c.campaign_id = campaignId;
    c.campaign_name = campaignName;
    c.linked_at = new Date().toISOString();
    c.status = "active";
    writeDB(db);
    return c;
  });
}

export async function updateCreativePerformance(
  id: string,
  performance: CreativePerformance
): Promise<CreativeVariant | null> {
  return withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const c = db.creatives.find((cv) => cv.id === id);
    if (!c) return null;
    c.performance = performance;

    // Compute accuracy vs predicted
    // "1.5-2.5%" là chuỗi gõ cứng cũ (trước 07/10 mọi bản lưu từ thẻ đều mang nó) — không chấm "dự đoán đúng/sai" theo số bịa.
    if (c.predicted_ctr_range && c.predicted_ctr_range !== LEGACY_PLACEHOLDER_CTR) {
      const parts = c.predicted_ctr_range.replace(/%/g, "").split("-");
      const low = parseFloat(parts[0]);
      const high = parseFloat(parts[1]);

      if (!isNaN(low) && !isNaN(high)) {
        const actual = performance.ctr;
        if (actual >= low && actual <= high) {
          c.prediction_accuracy = "accurate";
        } else if (actual > high) {
          c.prediction_accuracy = "underestimated";
        } else {
          c.prediction_accuracy = "overestimated";
        }
        const midpoint = (low + high) / 2;
        c.actual_vs_predicted =
          midpoint > 0 ? Math.round(((actual - midpoint) / midpoint) * 100) : 0;
      }
    }

    writeDB(db);
    return c;
  });
}

// ─────────────────────────────────────────────
// AI Learning Loop
// ─────────────────────────────────────────────

export function getLearningInsights(): LearningInsight[] {
  return readDB().learningInsights;
}

export function getInsightsForToneSegment(
  tone: string,
  segment: string
): LearningInsight[] {
  return readDB().learningInsights.filter(
    (i) =>
      i.tone.toLowerCase().includes(tone.toLowerCase()) ||
      i.segment.toLowerCase().includes(segment.toLowerCase())
  );
}

export async function saveLearningInsight(
  tone: string,
  segment: string,
  learning: string,
  sampleCtr: number
): Promise<LearningInsight> {
  return withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const insight: LearningInsight = {
      id: `insight_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tone,
      segment,
      learning,
      sample_accurate_ctr: sampleCtr,
      created_at: new Date().toISOString(),
    };
    db.learningInsights.unshift(insight);
    // Keep only last 100 insights
    db.learningInsights = db.learningInsights.slice(0, 100);
    writeDB(db);
    return insight;
  });
}

// ─────────────────────────────────────────────
// Helper: Generate creative ID
// ─────────────────────────────────────────────

export function generateCreativeId(): string {
  return `crt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────
// Helper: Parse company from campaign/product name
// ─────────────────────────────────────────────

export function parseCompanyFromName(
  name: string
): string | null {
  if (name.toUpperCase().startsWith("MBC")) return "MBC";
  if (name.toUpperCase().startsWith("MBI")) return "MBI";
  return null;
}

// ─────────────────────────────────────────────
// Helper: Performance badge logic
// ─────────────────────────────────────────────

export function getPerformanceBadge(creative: CreativeVariant): {
  label: string;
  color: "green" | "red" | "orange" | "blue";
} | null {
  if (!creative.performance) return null;
  // Bản ghi cũ mang CTR gõ cứng: vẫn báo mệt mỏi (số đo thật), nhưng không báo "AI đoán đúng/sai".
  if (!creative.prediction_accuracy || creative.predicted_ctr_range === LEGACY_PLACEHOLDER_CTR) {
    return creative.performance.fatigue_score > 60 ? { label: "😓 Cần thay", color: "orange" } : null;
  }

  const fatigue = creative.performance.fatigue_score;

  if (fatigue > 60) {
    return { label: "😓 Cần thay", color: "orange" };
  }

  if (creative.prediction_accuracy === "accurate") {
    return { label: "✅ Đúng dự đoán", color: "green" };
  }
  if (creative.prediction_accuracy === "underestimated") {
    return { label: "🏆 Vượt dự đoán", color: "green" };
  }
  if (creative.prediction_accuracy === "overestimated") {
    const pct = creative.actual_vs_predicted ?? 0;
    if (pct < -30) return { label: "📉 Dưới kỳ vọng", color: "red" };
  }

  return null;
}
