// ─────────────────────────────────────────────
// Policy Radar — JSON-file store (data/policy-radar-items.json)
// Seeded from POLICY_RADAR_SEED on first read. Same pattern as
// lib/improvements-store.ts.
// ─────────────────────────────────────────────

import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { classifyImpact } from "./impact-classifier";
import { mapAffectedModules, mapRecommendedActions } from "./action-mapper";
import { POLICY_RADAR_SEED } from "./seed-data";
import type {
  PolicyRadarItem,
  PolicyRadarItemFilters,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "policy-radar-items.json");

async function ensureDataDir(): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

async function readAll(): Promise<PolicyRadarItem[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as PolicyRadarItem[];
  } catch {
    // First run — seed with the curated real items and persist.
    await writeFileAtomic(FILE, JSON.stringify(POLICY_RADAR_SEED, null, 2));
    return POLICY_RADAR_SEED;
  }
}

async function writeAll(items: PolicyRadarItem[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(FILE, JSON.stringify(items, null, 2));
}

export async function getAllItems(): Promise<PolicyRadarItem[]> {
  return readAll();
}

export async function getItemById(id: string): Promise<PolicyRadarItem | null> {
  const items = await readAll();
  return items.find((i) => i.id === id) ?? null;
}

export function filterItems(items: PolicyRadarItem[], filters: PolicyRadarItemFilters): PolicyRadarItem[] {
  return items.filter((item) => {
    if (filters.platform && filters.platform !== "all" && item.platform !== filters.platform) return false;
    if (filters.severity && item.severity !== filters.severity) return false;
    if (filters.category && item.category !== filters.category) return false;
    if (filters.affectedArea && !item.affectedAreas.includes(filters.affectedArea)) return false;
    if (filters.officialOnly && !item.official) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.from && item.publishedAt && item.publishedAt < filters.from) return false;
    if (filters.to && item.publishedAt && item.publishedAt > filters.to) return false;
    return true;
  });
}

export interface NewPolicyItemInput {
  platform: PolicyRadarItem["platform"];
  category: PolicyRadarItem["category"];
  changeType: PolicyRadarItem["changeType"];
  title: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceType: PolicyRadarItem["sourceType"];
  official: boolean;
  publishedAt: string | null;
  summaryShort: string;
  whyItMatters: string;
  tags: string[];
  addedBy: string;
  aiSuggestedActions?: string[];
}

export async function addItem(input: NewPolicyItemInput): Promise<PolicyRadarItem> {
  return withFileLock(FILE, async () => {
    const items = await readAll();
    const { severity, affectedAreas } = classifyImpact({ category: input.category, changeType: input.changeType });
    const item: PolicyRadarItem = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...input,
      verifiedFromSource: input.official,
      discoveredAt: new Date().toISOString(),
      severity,
      affectedAreas,
      affectedModules: mapAffectedModules(affectedAreas),
      recommendedActions: mapRecommendedActions(affectedAreas),
      status: "unread",
      reviewedBy: null,
      reviewedAt: null,
      internalNote: null,
    };
    items.unshift(item);
    await writeAll(items);
    return item;
  });
}

export interface ReviewUpdateInput {
  status?: PolicyRadarItem["status"];
  internalNote?: string | null;
  reviewedBy: string;
}

export async function updateReview(id: string, update: ReviewUpdateInput): Promise<PolicyRadarItem | null> {
  return withFileLock(FILE, async () => {
    const items = await readAll();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;

    const current = items[idx];
    const next: PolicyRadarItem = {
      ...current,
      status: update.status ?? current.status,
      internalNote: update.internalNote !== undefined ? update.internalNote : current.internalNote,
      reviewedBy: update.reviewedBy,
      reviewedAt: new Date().toISOString(),
    };
    items[idx] = next;
    await writeAll(items);
    return next;
  });
}
