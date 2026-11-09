// ============================================================
// RSA-EDIT-1 — audit trail for real RSA content edits pushed to
// Google Ads. Not a fit for lib/settings/audit.ts's writeAuditEntry
// (SettingsDomain-scoped, config governance) or lib/mutation-guard.ts
// (automation-vs-automation conflict detection) — this is a person
// manually editing one live ad's content, a different shape of event.
// Same storage pattern as data/quality-score-history.json: JSON file,
// atomic write, capped size.
// ============================================================
import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "rsa-edit-history.json");
const LOCK_KEY = "rsa-edit-history";

export interface RsaEditRecord {
  id: string;
  company: string;
  adId: string;
  adGroupId: string;
  campaignId: string;
  before: { headlines: string[]; descriptions: string[] };
  after: { headlines: string[]; descriptions: string[] };
  editedBy: string; // email
  editedAt: string; // ISO
  source: "manual" | "ai_suggested";
  success: boolean;
  error?: string;
}

export async function readRsaEditHistory(): Promise<RsaEditRecord[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as RsaEditRecord[];
  } catch {
    return [];
  }
}

export async function appendRsaEditRecord(record: Omit<RsaEditRecord, "id">): Promise<void> {
  await withFileLock(LOCK_KEY, async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
    } catch { /* exists */ }
    const existing = await readRsaEditHistory();
    const full: RsaEditRecord = {
      ...record,
      id: `rsaedit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
    // Keep max 2000 records — same cap philosophy as quality-score-history.json.
    const capped = [...existing, full].slice(-2000);
    await writeFileAtomic(FILE, JSON.stringify(capped, null, 2));
  });
}
