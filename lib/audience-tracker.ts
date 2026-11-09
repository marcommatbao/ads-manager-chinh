// ============================================================
// Audience Segment Library — CRUD + Helpers
// Storage: data/audience-library.json
// ============================================================

import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { randomBytes } from "crypto";
import { withFileLock } from "@/lib/file-lock";

// ── Types ──

export interface AudienceSegmentRecord {
  id: string;
  name: string;
  company: string;
  product: string;
  funnelStage: "TOFU" | "MOFU" | "BOFU";
  objective: string;

  // Full AI analysis data
  demographics: {
    age: string;
    gender: string;
    location: string[];
    income: string;
    jobTitles?: string[];
  };
  interests: string[];
  behaviors: string[];
  jobTitles: string[];
  exclusions: string[];
  painPoints: string[];
  buyingTriggers: string[];
  messageHook: string;
  triggerMoment: string;
  estimatedSize: string;
  emotionalDriver?: string;
  recommendedTones?: string[];
  whyThisSegment?: string;
  competitionLevel?: "low" | "medium" | "high";
  messagingAngle?: string;
  sampleAd?: { primaryText: string; headline: string; cta: string };

  // AI prediction at creation time
  predictedCtr: string;
  predictedCpl?: number | null;

  // Performance (updated from campaigns)
  totalCampaigns: number;
  avgCpl: number | null;
  avgCtr: number | null;
  avgFrequency: number | null;
  totalSpend: number;
  winCount: number; // campaigns that met KPI
  segmentScore: number; // 0-100 composite score

  // Meta
  createdBy: string;
  usageCount: number;
  tags: string[];
  priority: number;

  createdAt: string;
  updatedAt: string;
}

export interface CampaignUsageRecord {
  id: string;
  segmentId: string;
  campaignId: string;
  campaignName: string;
  fbAdSetId?: string;
  cpl: number | null;
  ctr: number | null;
  spend: number | null;
  impressions: number | null;
  leads: number | null;
  frequency: number | null;
  metKpi: boolean;
  usedAt: string;
}

interface LibraryData {
  segments: AudienceSegmentRecord[];
  campaignUsages: CampaignUsageRecord[];
}

// ── File I/O ──

const DATA_PATH = path.join(process.cwd(), "data", "audience-library.json");

function readData(): LibraryData {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw) as LibraryData;
  } catch {
    return { segments: [], campaignUsages: [] };
  }
}

function writeData(data: LibraryData): void {
  writeFileAtomicSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ── ID Generation ──

export function generateSegmentId(): string {
  return `seg_${randomBytes(8).toString("hex")}`;
}

function generateUsageId(): string {
  return `usg_${randomBytes(8).toString("hex")}`;
}

// ── CRUD: Segments ──

export function getAllSegments(): AudienceSegmentRecord[] {
  return readData().segments;
}

export function getSegmentById(id: string): AudienceSegmentRecord | undefined {
  return readData().segments.find((s) => s.id === id);
}

export function saveSegment(
  segment: Omit<AudienceSegmentRecord, "id" | "createdAt" | "updatedAt" | "totalCampaigns" | "avgCpl" | "avgCtr" | "avgFrequency" | "totalSpend" | "winCount" | "usageCount">
): AudienceSegmentRecord {
  const data = readData();
  const now = new Date().toISOString();

  const record: AudienceSegmentRecord = {
    ...segment,
    id: generateSegmentId(),
    totalCampaigns: 0,
    avgCpl: null,
    avgCtr: null,
    avgFrequency: null,
    totalSpend: 0,
    winCount: 0,
    segmentScore: 0,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  data.segments.push(record);
  writeData(data);
  return record;
}

export function updateSegment(
  id: string,
  updates: Partial<AudienceSegmentRecord>
): AudienceSegmentRecord | null {
  const data = readData();
  const idx = data.segments.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  data.segments[idx] = {
    ...data.segments[idx],
    ...updates,
    id, // prevent id overwrite
    updatedAt: new Date().toISOString(),
  };

  writeData(data);
  return data.segments[idx];
}

export function deleteSegment(id: string): boolean {
  const data = readData();
  const before = data.segments.length;
  data.segments = data.segments.filter((s) => s.id !== id);
  // Also clean up usages
  data.campaignUsages = data.campaignUsages.filter((u) => u.segmentId !== id);
  if (data.segments.length === before) return false;
  writeData(data);
  return true;
}

export function incrementUsageCount(id: string): AudienceSegmentRecord | null {
  const data = readData();
  const seg = data.segments.find((s) => s.id === id);
  if (!seg) return null;
  seg.usageCount += 1;
  seg.updatedAt = new Date().toISOString();
  writeData(data);
  return seg;
}

// ── Campaign Usage Tracking ──

export async function recordCampaignUsage(
  usage: Omit<CampaignUsageRecord, "id" | "usedAt">
): Promise<CampaignUsageRecord> {
  // Read-modify-write on the shared library file — serialize concurrent
  // calls via withFileLock so two campaigns reporting in at once can't
  // clobber each other's segment stat recalculation (lost-update race).
  return withFileLock(DATA_PATH, async () => {
    const data = readData();
    const record: CampaignUsageRecord = {
      ...usage,
      id: generateUsageId(),
      usedAt: new Date().toISOString(),
    };

    data.campaignUsages.push(record);

    // Recalculate segment averages
    const segUsages = data.campaignUsages.filter(
      (u) => u.segmentId === usage.segmentId
    );
    const seg = data.segments.find((s) => s.id === usage.segmentId);
    if (seg) {
      seg.totalCampaigns = segUsages.length;
      seg.totalSpend = segUsages.reduce((s, u) => s + (u.spend ?? 0), 0);
      seg.winCount = segUsages.filter((u) => u.metKpi).length;

      const cplVals = segUsages.filter((u) => u.cpl != null).map((u) => u.cpl!);
      seg.avgCpl = cplVals.length > 0
        ? cplVals.reduce((a, b) => a + b, 0) / cplVals.length
        : null;

      const ctrVals = segUsages.filter((u) => u.ctr != null).map((u) => u.ctr!);
      seg.avgCtr = ctrVals.length > 0
        ? ctrVals.reduce((a, b) => a + b, 0) / ctrVals.length
        : null;

      seg.updatedAt = new Date().toISOString();
    }

    writeData(data);
    return record;
  });
}

export function getUsagesForSegment(segmentId: string): CampaignUsageRecord[] {
  return readData().campaignUsages.filter((u) => u.segmentId === segmentId);
}
