// ============================================================
// NBA — persistence (data/next-best-actions.json)
// Sync read (như các lib khác), write qua withFileLock.
// Upsert theo dedupeKey; tôn trọng trạng thái user (dismissed/applied);
// tự expire khi điều kiện không còn / quá hạn.
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import type { NbaRecommendation, NbaCompany, NbaStatus, NbaFeedbackValue } from "./types";

const FILE = path.join(process.cwd(), "data", "next-best-actions.json");
const LOCK_KEY = "next-best-actions";

interface StoreShape {
  recommendations: NbaRecommendation[];
}

function readSync(): NbaRecommendation[] {
  try {
    if (!existsSync(FILE)) return [];
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch {
    return [];
  }
}

async function writeAll(recs: NbaRecommendation[]): Promise<void> {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  await writeFileAtomic(FILE, JSON.stringify({ recommendations: recs }, null, 2));
}

/** Trạng thái do user/hệ thống "chốt" — không tự resurface trong khi còn hiệu lực. */
const USER_LOCKED: NbaStatus[] = [
  "dismissed", "applied", "auto_applied", "resolved", "acknowledged", "snoozed",
];

/** snoozed đã hết hạn snooze → cho phép resurface lại. */
function isLocked(r: NbaRecommendation, now: number): boolean {
  if (!USER_LOCKED.includes(r.status)) return false;
  if (r.status === "snoozed" && r.snoozeUntil && Date.parse(r.snoozeUntil) <= now) return false;
  return Date.parse(r.expiresAt) > now;
}

/**
 * Merge danh sách recommendation mới vào store.
 * - dedupeKey đã bị user dismiss/apply & chưa hết hạn → giữ nguyên.
 * - dedupeKey còn 'new'/'seen' nhưng KHÔNG còn trong incoming → đánh 'expired'.
 * - quá expiresAt → prune.
 */
export async function upsertMany(incoming: NbaRecommendation[]): Promise<NbaRecommendation[]> {
  return withFileLock(LOCK_KEY, async () => {
    const now = Date.now();
    const existing = readSync();
    const byKey = new Map<string, NbaRecommendation>();
    for (const r of existing) byKey.set(r.dedupeKey, r);

    const incomingKeys = new Set(incoming.map(r => r.dedupeKey));

    for (const inc of incoming) {
      const prev = byKey.get(inc.dedupeKey);
      if (prev && isLocked(prev, now)) {
        // Tôn trọng quyết định user / đang snooze — NHƯNG nếu bản ghi sinh ra
        // bằng CÔNG THỨC CŨ thì vẫn phải cập nhật phần SỐ. Giữ nguyên trạng
        // thái, thời hạn hoãn và feedback; chỉ thay con số tác động.
        //
        // Không làm thế thì mục đã "Đã nhận"/"Hoãn" giữ số cũ VĨNH VIỄN, và
        // màn hình trộn lẫn hai công thức mà không ai phân biệt được.
        if ((prev.calcVersion ?? 1) !== (inc.calcVersion ?? 1)) {
          byKey.set(inc.dedupeKey, {
            ...prev,
            calcVersion: inc.calcVersion,
            impactEstimate: inc.impactEstimate,
            estimatedMonthlySavings: inc.estimatedMonthlySavings,
            estimatedMonthlyLift: inc.estimatedMonthlyLift,
            updatedAt: new Date(now).toISOString(),
          });
        }
        continue;
      }
      if (prev) {
        byKey.set(inc.dedupeKey, {
          ...inc,
          id: prev.id,
          createdAt: prev.createdAt,
          status: prev.status === "seen" ? "seen" : "new",
          feedback: prev.feedback, // giữ feedback đã ghi
          updatedAt: new Date(now).toISOString(),
        });
      } else {
        byKey.set(inc.dedupeKey, inc);
      }
    }

    // điều kiện không còn → expire (chỉ với new/seen)
    for (const r of byKey.values()) {
      if (!incomingKeys.has(r.dedupeKey) && (r.status === "new" || r.status === "seen")) {
        r.status = "expired";
      }
    }

    // prune quá hạn (giữ trạng thái đã chốt còn hiệu lực)
    const kept = [...byKey.values()].filter(r => Date.parse(r.expiresAt) > now || isLocked(r, now));
    await writeAll(kept);
    return kept;
  });
}

export interface QueryOpts {
  includeStatuses?: NbaStatus[]; // mặc định: new + seen
}

/** Lấy recommendation theo công ty được phép (RBAC), sắp theo priority.
 *  Mặc định: hàng đợi active (new/seen/acknowledged), ẩn snooze còn hiệu lực. */
export function queryFor(companies: NbaCompany[], opts: QueryOpts = {}): NbaRecommendation[] {
  const now = Date.now();
  const allowed = new Set(companies);
  const statuses = new Set<NbaStatus>(opts.includeStatuses ?? ["new", "seen", "acknowledged"]);
  return readSync()
    .filter(r => {
      if (!allowed.has(r.company) || !statuses.has(r.status)) return false;
      // snooze còn hiệu lực → ẩn (trừ khi caller xin riêng status 'snoozed')
      if (r.status === "snoozed" && !statuses.has("snoozed") && r.snoozeUntil && Date.parse(r.snoozeUntil) > now) return false;
      return true;
    })
    .sort((a, b) => (b.scores?.priority ?? 0) - (a.scores?.priority ?? 0));
}

/** Map dedupeKey → occurrenceCount hiện tại (cho persistence scoring). */
export function getOccurrenceMap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of readSync()) {
    out[r.dedupeKey] = Math.max(out[r.dedupeKey] ?? 0, r.occurrenceCount ?? 1);
  }
  return out;
}

/** Một recommendation theo id (để kiểm công ty TRƯỚC khi đổi trạng thái / hoàn tác). */
export function getRecommendation(id: string): NbaRecommendation | null {
  return readSync().find(r => r.id === id) ?? null;
}

export async function setStatus(id: string, status: NbaStatus): Promise<NbaRecommendation | null> {
  return withFileLock(LOCK_KEY, async () => {
    const recs = readSync();
    const target = recs.find(r => r.id === id);
    if (!target) return null;
    target.status = status;
    target.updatedAt = new Date().toISOString();
    await writeAll(recs);
    return target;
  });
}

/** Ghi feedback (helped/not_helpful/ignored) lên recommendation. */
export async function setFeedback(id: string, feedback: NbaFeedbackValue): Promise<NbaRecommendation | null> {
  return withFileLock(LOCK_KEY, async () => {
    const recs = readSync();
    const target = recs.find(r => r.id === id);
    if (!target) return null;
    target.feedback = feedback;
    target.updatedAt = new Date().toISOString();
    await writeAll(recs);
    return target;
  });
}

/** Snooze tới N giờ sau (ẩn khỏi hàng đợi tới khi hết hạn). */
export async function snooze(id: string, hours: number): Promise<NbaRecommendation | null> {
  return withFileLock(LOCK_KEY, async () => {
    const recs = readSync();
    const target = recs.find(r => r.id === id);
    if (!target) return null;
    const h = Math.max(1, Math.min(720, hours || 24));
    target.status = "snoozed";
    target.snoozeUntil = new Date(Date.now() + h * 3600_000).toISOString();
    target.updatedAt = new Date().toISOString();
    await writeAll(recs);
    return target;
  });
}
