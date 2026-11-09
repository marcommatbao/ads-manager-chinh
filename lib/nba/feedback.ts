// ============================================================
// NBA — feedback loop (E)
// Ghi nhận recommendation có ích / không, gom theo reasonCode →
// prior ∈ [-1,1] để điều chỉnh confidence vòng sau (hook ai-memory).
// JSON-backed (data/nba-feedback.json) qua file-lock. Không DB.
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import type { NbaFeedbackValue } from "./types";

const FILE = path.join(process.cwd(), "data", "nba-feedback.json");
const LOCK_KEY = "nba-feedback";

interface ReasonTally { helped: number; notHelpful: number; ignored: number }
interface FeedbackDB { byReason: Record<string, ReasonTally> }

function readDB(): FeedbackDB {
  try {
    if (!existsSync(FILE)) return { byReason: {} };
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as FeedbackDB;
    return parsed.byReason ? parsed : { byReason: {} };
  } catch {
    return { byReason: {} };
  }
}

export async function recordFeedback(reasonCode: string, value: NbaFeedbackValue): Promise<void> {
  await withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const t = db.byReason[reasonCode] ?? { helped: 0, notHelpful: 0, ignored: 0 };
    if (value === "helped") t.helped += 1;
    else if (value === "not_helpful") t.notHelpful += 1;
    else t.ignored += 1;
    db.byReason[reasonCode] = t;
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    await writeFileAtomic(FILE, JSON.stringify(db, null, 2));
  });
}

/**
 * prior ∈ [-1,1] cho mỗi reasonCode (Laplace-smoothed):
 * (helped − notHelpful) / (helped + notHelpful + ignored + 2).
 * Dùng làm opts.prior trong scoring → reasonCode từng "có ích" được tin hơn.
 */
export function getPriors(): Record<string, number> {
  const db = readDB();
  const out: Record<string, number> = {};
  for (const [code, t] of Object.entries(db.byReason)) {
    const total = t.helped + t.notHelpful + t.ignored + 2;
    const prior = (t.helped - t.notHelpful) / total;
    out[code] = Math.max(-1, Math.min(1, prior));
  }
  return out;
}
