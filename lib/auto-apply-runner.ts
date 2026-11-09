// ============================================================
// Shared Auto-Apply execution — used by BOTH the nightly cron
// (app/api/cron/improvements-auto-apply) and the on-demand
// "Chạy ngay" button (app/api/automation/auto-apply).
//
// Candidates come from the exact same computation the human Improvements
// dashboard uses (GET /api/improvements), and mutations go through the
// exact same applyOne() the human "Apply" button uses — so there is one
// source of truth for what an improvement is and what applying it does.
//
// Idempotency: a successful real apply immediately dismisses the item
// (lib/improvements-store.ts). Improvements has no separate "already
// applied" ledger, so dismiss-on-apply is the whole guarantee that the
// same negative keyword is not added twice.
// ============================================================
import { applyOne, type ApplyPayload, type Company } from "@/app/api/improvements/apply/route";
import { dismissImprovement } from "@/lib/improvements-store";
import { AUTO_APPLY_ACTIONS, getAutoApplySettings } from "@/lib/auto-apply-settings";

export interface AutoApplyCandidate {
  id: string;
  type: string;
  title: string;
  priority: string;
  company: string;
  status: string;
  canAutoApply: boolean;
  /** VND value of the improvement, as computed by /api/improvements. */
  impactValue?: number;
  /** true = impactValue là ước lượng thô (tỷ lệ gõ tay) — không cộng vào tổng tiền. */
  impactRough?: boolean;
  campaignName?: string;
  applyPayload?: ApplyPayload;
}

export interface AppliedItem {
  id: string;
  type: string;
  title: string;
  company: Company;
  impactValue: number;
  impactRough?: boolean;
  campaignName?: string;
}

export interface FailedItem extends Omit<AppliedItem, "impactValue"> {
  error: string;
}

const ALLOWLIST = new Set<string>(AUTO_APPLY_ACTIONS);

/**
 * Pull live improvements for a company and keep only the ones eligible for
 * automatic execution.
 *
 * `respectSettings` additionally filters by the per-company rule toggles —
 * the cron and the "run now" button both pass true so a disabled rule is
 * never executed. Preview counts use the same filter, so the number shown
 * is the number that would actually run.
 */
export async function fetchAutoApplyCandidates(
  company: Company,
  respectSettings = true,
): Promise<AutoApplyCandidate[]> {
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const res = await fetch(`${base}/api/improvements?company=${company}`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  if (!res.ok) throw new Error(`GET /api/improvements?company=${company} → HTTP ${res.status}`);

  const data = (await res.json()) as { improvements?: AutoApplyCandidate[] };
  const enabled = respectSettings ? getAutoApplySettings(company).enabledRules : null;

  return (data.improvements ?? []).filter((i) => {
    const action = i.applyPayload?.action;
    if (!(i.status === "ACTIVE" && i.canAutoApply && action && ALLOWLIST.has(action))) return false;
    return enabled ? (enabled as string[]).includes(action) : true;
  });
}

/** Tổng chi tiêu ĐO ĐƯỢC của các mục (soát 07/10): bỏ ước lượng thô (impactRough), mỗi chiến dịch tính 1 lần (lấy mục lớn nhất). */
export function sumImpact(candidates: Pick<AutoApplyCandidate, "id" | "company" | "impactValue" | "impactRough" | "campaignName">[]): number {
  const by = new Map<string, number>();
  for (const c of candidates) {
    if (c.impactRough || typeof c.impactValue !== "number" || !(c.impactValue > 0)) continue;
    const k = `${c.company}:${c.campaignName ?? c.id}`;
    by.set(k, Math.max(by.get(k) ?? 0, c.impactValue));
  }
  let total = 0;
  for (const v of by.values()) total += v;
  return total;
}

/**
 * Split "everything the improvements engine flagged as auto-appliable" from
 * "what the operator actually enabled". Callers report both so a candidate
 * held back by a disabled toggle is visible rather than silently missing —
 * the cron's Telegram digest still lists every candidate exactly as before,
 * and only the execution set narrows.
 */
export function splitByEnabledRules(
  company: Company,
  all: AutoApplyCandidate[],
): { eligible: AutoApplyCandidate[]; blocked: AutoApplyCandidate[] } {
  const enabled = getAutoApplySettings(company).enabledRules as readonly string[];
  const eligible: AutoApplyCandidate[] = [];
  const blocked: AutoApplyCandidate[] = [];
  for (const c of all) {
    (enabled.includes(c.applyPayload?.action ?? "") ? eligible : blocked).push(c);
  }
  return { eligible, blocked };
}

export interface RunResult {
  applied: AppliedItem[];
  failed: FailedItem[];
  savings: number;
}

/**
 * Execute the real mutations for the given candidates.
 * Never call with dryRun handling here — the caller decides whether to run;
 * this function always mutates.
 */
export async function applyCandidates(
  company: Company,
  candidates: AutoApplyCandidate[],
): Promise<RunResult> {
  const applied: AppliedItem[] = [];
  const failed: FailedItem[] = [];

  for (const item of candidates) {
    const base = { id: item.id, type: item.type, title: item.title, company };
    try {
      const result = await applyOne(company, item.applyPayload!);
      if (result.success) {
        await dismissImprovement(item.id, company);
        applied.push({ ...base, impactValue: item.impactValue ?? 0, impactRough: item.impactRough, campaignName: item.campaignName });
      } else {
        failed.push({ ...base, error: result.error ?? "unknown" });
      }
    } catch (err) {
      failed.push({ ...base, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { applied, failed, savings: sumImpact(applied) };
}
