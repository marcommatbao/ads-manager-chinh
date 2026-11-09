// ============================================================
// Creative AI Studio — Draft Store (auto-save / resume wizard)
// Persistence: data/creative-ai-drafts.json
// File-lock pattern identical to creative-brief/store.ts
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { randomUUID } from "crypto";
import { withFileLock } from "@/lib/file-lock";

export type DraftStepKey = "step1Data" | "step2Data" | "step3Data" | "step4Data";
export type DraftStatus = "ACTIVE" | "LAUNCHED";

export interface CreativeAIDraft {
  id: string;
  name: string;
  company: string;
  currentStep: number;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  step1Data: string | null;
  step2Data: string | null;
  step3Data: string | null;
  step4Data: string | null;
}

const FILE     = path.join(process.cwd(), "data", "creative-ai-drafts.json");
const LOCK_KEY = "creative-ai-drafts";
const CAP      = 100;
const TTL_DAYS = 7;

function readDrafts(): CreativeAIDraft[] {
  try {
    if (!existsSync(FILE)) return [];
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { drafts?: CreativeAIDraft[] };
    return Array.isArray(parsed.drafts) ? parsed.drafts : [];
  } catch {
    return [];
  }
}

async function writeDrafts(drafts: CreativeAIDraft[]): Promise<void> {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  await writeFileAtomic(FILE, JSON.stringify({ drafts }, null, 2));
}

/** Nháp chưa có dữ liệu bước nào (sinh ra lúc chỉ MỞ trang — bản trước 15/10/2026). */
export const isEmptyDraft = (d: Pick<CreativeAIDraft, "step1Data" | "step2Data" | "step3Data" | "step4Data">): boolean =>
  !d.step1Data && !d.step2Data && !d.step3Data && !d.step4Data;
const EMPTY_DRAFT_TTL_MS = 86_400_000;

// Drop expired drafts and cap total count so the store stays bounded. Nháp rỗng quá 1 ngày bị bỏ để không chiếm chỗ nháp thật.
function prune(drafts: CreativeAIDraft[]): CreativeAIDraft[] {
  const now = Date.now();
  return drafts
    .filter(d => new Date(d.expiresAt).getTime() > now)
    .filter(d => !isEmptyDraft(d) || now - new Date(d.updatedAt).getTime() < EMPTY_DRAFT_TTL_MS)
    .slice(0, CAP);
}

export async function createDraft(company: string): Promise<CreativeAIDraft> {
  return withFileLock(LOCK_KEY, async () => {
    const drafts = prune(readDrafts());
    const now = new Date();
    const draft: CreativeAIDraft = {
      id: randomUUID(),
      name: `Campaign ${now.toLocaleDateString("vi-VN")}`,
      company,
      currentStep: 1,
      status: "ACTIVE",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_DAYS * 86_400_000).toISOString(),
      step1Data: null,
      step2Data: null,
      step3Data: null,
      step4Data: null,
    };
    drafts.unshift(draft);
    await writeDrafts(drafts);
    return draft;
  });
}

export function getDraft(id: string, company?: string): CreativeAIDraft | null {
  const draft = prune(readDrafts()).find(d => d.id === id) ?? null;
  if (draft && company && draft.company !== company) return null;
  return draft;
}

// Drafts a resume-picker should offer: same company, not yet launched.
export function listPendingDrafts(company: string, limit = 10): CreativeAIDraft[] {
  return prune(readDrafts())
    .filter(d => d.company === company && d.status === "ACTIVE" && !isEmptyDraft(d))
    .slice(0, limit);
}

export async function updateDraft(
  id: string,
  patch: {
    name?: string;
    status?: DraftStatus;
    currentStep?: number;
    stepKey?: DraftStepKey;
    stepData?: unknown;
  },
): Promise<CreativeAIDraft | null> {
  return withFileLock(LOCK_KEY, async () => {
    const drafts = prune(readDrafts());
    const idx = drafts.findIndex(d => d.id === id);
    if (idx < 0) return null;

    const draft = { ...drafts[idx] };
    if (patch.name !== undefined) draft.name = patch.name;
    if (patch.status !== undefined) draft.status = patch.status;
    if (patch.currentStep !== undefined) draft.currentStep = patch.currentStep;
    if (patch.stepKey === "step1Data") draft.step1Data = JSON.stringify(patch.stepData ?? null);
    else if (patch.stepKey === "step2Data") draft.step2Data = JSON.stringify(patch.stepData ?? null);
    else if (patch.stepKey === "step3Data") draft.step3Data = JSON.stringify(patch.stepData ?? null);
    else if (patch.stepKey === "step4Data") draft.step4Data = JSON.stringify(patch.stepData ?? null);
    draft.updatedAt = new Date().toISOString();

    drafts[idx] = draft;
    await writeDrafts(drafts);
    return draft;
  });
}

export async function deleteDraftById(id: string): Promise<boolean> {
  return withFileLock(LOCK_KEY, async () => {
    const drafts = readDrafts();
    const filtered = drafts.filter(d => d.id !== id);
    if (filtered.length === drafts.length) return false;
    await writeDrafts(filtered);
    return true;
  });
}
