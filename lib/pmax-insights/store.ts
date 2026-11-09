// ─────────────────────────────────────────────
// PMax Insights 2.0 — JSON-file store for recommendations + draft actions
// (Stage 2). Same pattern as lib/policy-radar/store.ts.
// ─────────────────────────────────────────────

import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import type { PMaxRecommendation, PMaxDraftAction, RecommendationReviewState } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RECS_FILE = path.join(DATA_DIR, "pmax-recommendations.json");
const DRAFTS_FILE = path.join(DATA_DIR, "pmax-draft-actions.json");

async function ensureDataDir(): Promise<void> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

async function readJson<T>(file: string): Promise<T[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function writeJson<T>(file: string, data: T[]): Promise<void> {
  await ensureDataDir();
  await writeFileAtomic(file, JSON.stringify(data, null, 2));
}

// ── Recommendations ──

export async function getRecommendations(company: string): Promise<PMaxRecommendation[]> {
  const all = await readJson<PMaxRecommendation>(RECS_FILE);
  return all.filter((r) => r.company === company);
}

/**
 * Upserts freshly-computed recommendations, keyed by campaignId — but
 * PRESERVES an existing recommendation's reviewState/reviewedAt/reviewedBy
 * if one already exists for that campaign, so a "Đã xem"/"Bỏ qua" doesn't
 * silently reset every time the advisor tab recomputes from live scores.
 * Only the content (title/reason/evidence/...) refreshes.
 */
/** Số ngày sau khi áp dụng thì thẻ được mở lại để cân nhắc lần kế — khớp với
 *  APPLY_COOLDOWN_DAYS trong lib/pmax-insights/budget-apply-log.ts. */
const APPLIED_STATE_TTL_DAYS = 7;

function expireApplied(existing: PMaxRecommendation | undefined): RecommendationReviewState {
  if (!existing) return "unread";
  if (existing.reviewState !== "applied") return existing.reviewState;
  const at = existing.reviewedAt ? Date.parse(existing.reviewedAt) : NaN;
  if (Number.isNaN(at)) return "applied";
  const days = (Date.now() - at) / 86400000;
  return days >= APPLIED_STATE_TTL_DAYS ? "unread" : "applied";
}

export async function upsertRecommendations(
  company: string,
  fresh: Omit<PMaxRecommendation, "id" | "reviewState" | "createdAt" | "reviewedAt" | "reviewedBy">[]
): Promise<PMaxRecommendation[]> {
  return withFileLock(RECS_FILE, async () => {
    const all = await readJson<PMaxRecommendation>(RECS_FILE);
    const others = all.filter((r) => r.company !== company);
    const existingByCampaign = new Map(all.filter((r) => r.company === company).map((r) => [r.campaignId, r]));

    const next: PMaxRecommendation[] = fresh.map((f) => {
      const existing = existingByCampaign.get(f.campaignId);
      return {
        ...f,
        id: existing?.id ?? `pmaxrec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        // "applied" phải hết hạn. Không thì sau lần tăng ngân sách đầu tiên,
        // thẻ đó khoá nút vĩnh viễn — tính năng chỉ dùng được đúng một lần cho
        // mỗi campaign, kể cả khi cooldown đã qua và số liệu lại đủ điều kiện.
        reviewState: expireApplied(existing),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        reviewedAt: existing?.reviewedAt ?? null,
        reviewedBy: existing?.reviewedBy ?? null,
      };
    });

    await writeJson(RECS_FILE, [...others, ...next]);
    return next;
  });
}

export async function updateRecommendationState(
  id: string,
  reviewState: RecommendationReviewState,
  reviewedBy: string
): Promise<PMaxRecommendation | null> {
  return withFileLock(RECS_FILE, async () => {
    const all = await readJson<PMaxRecommendation>(RECS_FILE);
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    all[idx] = { ...all[idx], reviewState, reviewedAt: new Date().toISOString(), reviewedBy };
    await writeJson(RECS_FILE, all);
    return all[idx];
  });
}

export async function getRecommendationById(id: string): Promise<PMaxRecommendation | null> {
  const all = await readJson<PMaxRecommendation>(RECS_FILE);
  return all.find((r) => r.id === id) ?? null;
}

// ── Draft actions ──

export async function getDraftActions(company: string): Promise<PMaxDraftAction[]> {
  const all = await readJson<PMaxDraftAction>(DRAFTS_FILE);
  return all.filter((d) => d.company === company).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addDraftAction(input: Omit<PMaxDraftAction, "id" | "createdAt">): Promise<PMaxDraftAction> {
  return withFileLock(DRAFTS_FILE, async () => {
    const all = await readJson<PMaxDraftAction>(DRAFTS_FILE);
    const draft: PMaxDraftAction = {
      ...input,
      id: `pmaxdraft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    all.unshift(draft);
    await writeJson(DRAFTS_FILE, all.slice(0, 500));
    return draft;
  });
}
