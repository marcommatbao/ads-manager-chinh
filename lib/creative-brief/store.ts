// ============================================================
// Creative Brief — Draft Store
// Persistence: data/creative-brief-drafts.json
// File-lock pattern identical to automation-sim/store.ts
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import type { BriefDraft, BriefInput, CreativeBrief } from "./types";

const FILE     = path.join(process.cwd(), "data", "creative-brief-drafts.json");
const LOCK_KEY = "creative-brief-drafts";
const CAP      = 50; // keep last 50 drafts

function readDrafts(): BriefDraft[] {
  try {
    if (!existsSync(FILE)) return [];
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { drafts?: BriefDraft[] };
    return Array.isArray(parsed.drafts) ? parsed.drafts : [];
  } catch {
    return [];
  }
}

async function writeDrafts(drafts: BriefDraft[]): Promise<void> {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  await writeFileAtomic(FILE, JSON.stringify({ drafts }, null, 2));
}

/** Create or update a draft. If id already exists, overwrites it. */
export async function saveDraft(
  id: string,
  name: string,
  input: BriefInput,
  output?: CreativeBrief,
): Promise<BriefDraft> {
  return withFileLock(LOCK_KEY, async () => {
    const drafts = readDrafts();
    const now    = new Date().toISOString();
    const idx    = drafts.findIndex(d => d.id === id);

    const draft: BriefDraft = {
      id,
      name: name || `Brief ${new Date().toLocaleDateString("vi-VN")}`,
      input,
      output,
      createdAt: idx >= 0 ? drafts[idx].createdAt : now,
      updatedAt: now,
    };

    if (idx >= 0) {
      drafts[idx] = draft;
    } else {
      drafts.unshift(draft);
    }

    await writeDrafts(drafts.slice(0, CAP));
    return draft;
  });
}

export function getDraft(id: string): BriefDraft | null {
  return readDrafts().find(d => d.id === id) ?? null;
}

export function listDrafts(limit = 20): BriefDraft[] {
  return readDrafts().slice(0, limit);
}

export async function deleteDraft(id: string): Promise<boolean> {
  return withFileLock(LOCK_KEY, async () => {
    const drafts = readDrafts();
    const filtered = drafts.filter(d => d.id !== id);
    if (filtered.length === drafts.length) return false;
    await writeDrafts(filtered);
    return true;
  });
}
