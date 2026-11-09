// ─────────────────────────────────────────────
// Lưu vết mỗi lần đổi ngân sách PMax từ AI Advisor.
//
// Không có nút hoàn tác tự động trong mini-spec này, nên bản ghi phải đủ để một
// người chỉnh tay lại: trước bao nhiêu, sau bao nhiêu, ai bấm, lúc nào, và dựa
// trên căn cứ gì. Cũng là nguồn cho cooldown — đã đổi thì phải có thời gian đo
// trước khi đổi tiếp, đúng như guardrail mà chính thẻ đề xuất đang dặn.
// ─────────────────────────────────────────────
import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "pmax-budget-applies.json");

/** Số ngày phải chờ trước khi đổi ngân sách campaign đó lần nữa. */
export const APPLY_COOLDOWN_DAYS = 7;

export interface BudgetApplyRecord {
  recommendationId: string;
  campaignId: string;
  campaignName: string;
  company: string;
  beforeVnd: number;
  afterVnd: number;
  basis: string[];
  appliedBy: string;
  appliedAt: string;
}

export async function readBudgetApplies(): Promise<BudgetApplyRecord[]> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as BudgetApplyRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordBudgetApply(
  input: Omit<BudgetApplyRecord, "appliedAt">,
): Promise<BudgetApplyRecord> {
  const record: BudgetApplyRecord = { ...input, appliedAt: new Date().toISOString() };
  await withFileLock(FILE, async () => {
    const all = await readBudgetApplies();
    all.unshift(record);
    try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
    await writeFileAtomic(FILE, JSON.stringify(all.slice(0, 500), null, 2));
  });
  return record;
}

/** Lần đổi gần nhất của một campaign — dùng cho cooldown. */
export async function lastApplyFor(
  campaignId: string,
  company: string,
): Promise<BudgetApplyRecord | null> {
  const all = await readBudgetApplies();
  let best: BudgetApplyRecord | null = null;
  for (const r of all) {
    if (r.campaignId !== campaignId || r.company !== company) continue;
    if (!best || r.appliedAt > best.appliedAt) best = r;
  }
  return best;
}
