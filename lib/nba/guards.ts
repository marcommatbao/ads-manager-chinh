// ============================================================
// NBA — Safety guards (v2)
// Chạy SAU scoring. Chỉ HẠ cấp actionMode, không nâng.
// Sinh blockedBy[] (typed) + guardFlags[] (mirror, tương thích slice-1).
// Xem docs §5.
// ============================================================

import { getLearningStatus } from "@/lib/campaign-health";
import { REASON_CODES } from "./reason-codes";
import { AUTO_APPLY_CONFIDENCE_FLOOR, LOW_DATA_FLOOR } from "./scoring";
import type { NbaRecommendation, NbaActionMode, NbaCompany, NbaBlockReason } from "./types";

const MODE_RANK: Record<NbaActionMode, number> = {
  advisory_only: 0,
  manual: 1,
  auto_apply_eligible: 2,
};

function downgrade(current: NbaActionMode, to: NbaActionMode): NbaActionMode {
  return MODE_RANK[to] < MODE_RANK[current] ? to : current;
}

export interface GuardOpts {
  /** entity vừa bị đổi (change-tracker) → cooldown/recent-change. */
  recentlyChanged?: boolean;
}

/**
 * Áp guard lên 1 recommendation. Mutate actionMode + blockedBy + guardFlags.
 */
export function applyGuards(
  rec: NbaRecommendation,
  guardCampaign?: unknown,
  opts: GuardOpts = {}
): NbaRecommendation {
  const meta = REASON_CODES[rec.reasonCode];
  const blocks = new Set<NbaBlockReason>();

  // 1) Learning-phase — action phá hoại khi new/learning → advisory_only.
  if (meta.destructive && guardCampaign && typeof guardCampaign === "object") {
    try {
      const learning = getLearningStatus(guardCampaign as Parameters<typeof getLearningStatus>[0]);
      if (learning.blockAutomation) {
        rec.actionMode = downgrade(rec.actionMode, "advisory_only");
        blocks.add("LEARNING_PHASE");
      }
    } catch { /* CampaignLike không hợp lệ → bỏ qua */ }
  }

  // 2) Low data — dữ liệu chưa đủ → không hành động aggressive.
  if (rec.scores.dataCompleteness < LOW_DATA_FLOOR) {
    blocks.add("LOW_DATA");
    if (meta.destructive) rec.actionMode = downgrade(rec.actionMode, "advisory_only");
  }

  // 3) Recent change — vừa đổi entity này → chờ kết quả, tránh xung đột.
  if (opts.recentlyChanged) {
    blocks.add("RECENT_CHANGE");
    blocks.add("COOLDOWN_LIKELY");
    rec.actionMode = downgrade(rec.actionMode, "advisory_only");
  }

  // 4) Confidence floor cho auto-apply.
  if (rec.actionMode === "auto_apply_eligible" && rec.scores.confidence < AUTO_APPLY_CONFIDENCE_FLOOR) {
    rec.actionMode = downgrade(rec.actionMode, "manual");
    blocks.add("LOW_CONFIDENCE");
  }

  // 5) Reversibility — chỉ executor có undo mới auto-apply.
  if (rec.actionMode === "auto_apply_eligible" && rec.executor !== "automation-engine") {
    rec.actionMode = downgrade(rec.actionMode, "manual");
    blocks.add("NOT_REVERSIBLE");
  }

  rec.blockedBy = Array.from(new Set([...rec.blockedBy, ...blocks]));
  rec.guardFlags = Array.from(new Set([...rec.guardFlags, ...rec.blockedBy]));
  return rec;
}

const SCALE_CODES = new Set(["SCALE_WINNER"]);
const CUT_CODES = new Set(["CPL_CRITICAL", "ZERO_CONV_SPEND", "LOW_ROAS_REVIEW", "PAUSE_FB_AD_LOW_CTR"]);

/** Cùng entity có cả tăng & giảm → giữ priority cao hơn, còn lại superseded. */
export function resolveConflicts(recs: NbaRecommendation[]): NbaRecommendation[] {
  const byEntity = new Map<string, NbaRecommendation[]>();
  for (const r of recs) {
    const k = `${r.company}:${r.entityType}:${r.entityId}`;
    const arr = byEntity.get(k) ?? [];
    arr.push(r);
    byEntity.set(k, arr);
  }

  for (const group of byEntity.values()) {
    if (!group.some(r => SCALE_CODES.has(r.reasonCode)) || !group.some(r => CUT_CODES.has(r.reasonCode))) continue;
    const winner = [...group].sort((a, b) => b.scores.priority - a.scores.priority)[0];
    const winnerIsScale = SCALE_CODES.has(winner.reasonCode);
    for (const r of group) {
      if (r === winner) continue;
      const opposite = winnerIsScale ? CUT_CODES.has(r.reasonCode) : SCALE_CODES.has(r.reasonCode);
      if (opposite) {
        r.status = "superseded";
        if (!r.blockedBy.includes("CONFLICT_SUPERSEDED")) r.blockedBy.push("CONFLICT_SUPERSEDED");
        if (!r.guardFlags.includes("CONFLICT_SUPERSEDED")) r.guardFlags.push("CONFLICT_SUPERSEDED");
      }
    }
  }
  return recs;
}

export function filterByCompanies(recs: NbaRecommendation[], companies: NbaCompany[]): NbaRecommendation[] {
  const allowed = new Set(companies);
  return recs.filter(r => allowed.has(r.company));
}

const ACTIVE: ReadonlySet<string> = new Set(["new", "seen", "acknowledged"]);

/**
 * Dedupe chéo nguồn: cùng clusterKey (company:entity:recommendationType)
 * — vd native CREATIVE_FATIGUE + improvements PAUSE_FB_AD_LOW_CTR cùng là
 * REFRESH_CREATIVE trên 1 creative → giữ priority cao nhất, còn lại superseded.
 */
export function dedupeByCluster(recs: NbaRecommendation[]): NbaRecommendation[] {
  const byCluster = new Map<string, NbaRecommendation[]>();
  for (const r of recs) {
    const arr = byCluster.get(r.clusterKey) ?? [];
    arr.push(r);
    byCluster.set(r.clusterKey, arr);
  }
  for (const group of byCluster.values()) {
    const active = group.filter(r => ACTIVE.has(r.status));
    if (active.length <= 1) continue;
    const winner = [...active].sort((a, b) => b.scores.priority - a.scores.priority)[0];
    for (const r of active) {
      if (r === winner) continue;
      r.status = "superseded";
      // gộp nguồn tín hiệu vào winner để giữ vết
      winner.sourceSignals = Array.from(new Set([...winner.sourceSignals, ...r.sourceSignals]));
      winner.reasonCodes = Array.from(new Set([...winner.reasonCodes, ...r.reasonCodes]));
      if (!r.blockedBy.includes("CONFLICT_SUPERSEDED")) r.blockedBy.push("CONFLICT_SUPERSEDED");
    }
  }
  return recs;
}
