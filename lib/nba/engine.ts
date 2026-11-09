// ============================================================
// NBA — orchestrator (v2)
// inputs (typed collections) → signals (collectors + improvements adapter)
// → build recommendation (reason-codes + scoring 6-dim + explain)
// → guards/blocking → conflict resolution. PURE: không gọi API/đọc file.
// ============================================================

import { randomUUID } from "crypto";
import type { Campaign } from "@/types/ads.types";
import type { NbaSignal, NbaRecommendation, NbaContext, NbaInputs } from "./types";
import { COLLECTORS } from "./collectors";
import { improvementsToSignals } from "./collectors/improvements";
import { REASON_CODES } from "./reason-codes";
import { scoreSignal, priorityBand } from "./scoring";
import { applyGuards, resolveConflicts, dedupeByCluster } from "./guards";
import {
  buildSummary,
  buildRecommendedAction,
  buildExpectedOutcome,
  buildSupportingMetrics,
  toExecutionMode,
} from "./explain";

const EXPIRY_DAYS = 3;

interface BuildOpts {
  occurrenceCount: number;
  recentlyChanged: boolean;
  prior: number;
}

/**
 * Phiên bản CÔNG THỨC tính tác động. Tăng số này MỖI KHI đổi cách tính
 * `estimatedMonthlySavings` / `estimatedMonthlyLift`.
 *
 * VÌ SAO CẦN: khuyến nghị được LƯU LẠI (lib/nba/store.ts) và chỉ tính lại khi
 * người dùng bấm "Làm mới" hoặc kho rỗng. Mục đã bấm "Đã nhận"/"Hoãn" còn bị
 * bỏ qua hẳn khi cập nhật. Nên sau một lần sửa công thức, màn hình trộn lẫn
 * số cũ và số mới — tệ hơn hẳn việc tất cả cùng cũ, vì không ai biết con số
 * nào theo công thức nào.
 *
 * v2 (19/09/2026): quy chi tiêu 7 ngày ra mức tháng (×30/7). Trước đó mọi số
 * gắn nhãn "/tháng" thực chất là phần trăm chi tiêu MỘT TUẦN.
 */
export const NBA_CALC_VERSION = 2;

function buildRecommendation(signal: NbaSignal, nowMs: number, opts: BuildOpts): NbaRecommendation {
  const meta = REASON_CODES[signal.reasonCode];
  const dedupeKey = `${signal.company}:${signal.entityType}:${signal.entityId}:${signal.reasonCode}`;
  const clusterKey = `${signal.company}:${signal.entityType}:${signal.entityId}:${meta.recommendationType}`;
  const scores = scoreSignal(signal, { occurrenceCount: opts.occurrenceCount, prior: opts.prior });
  const nowIso = new Date(nowMs).toISOString();

  const imp = signal.impactEstimate;
  // ── Quy chi tiêu 7 NGÀY ra mức THÁNG ───────────────────────────────────
  // LỖI ĐƠN VỊ: các collector tính `estMonthlySavingsVnd` bằng
  // `spend × 20%/30%/15%…`, nhưng `spend` đến từ gatherCampaigns() với
  // defaultRange() = **7 NGÀY** (lib/nba/gather.ts). Không chỗ nào trong
  // lib/nba/ nhân hệ số quy đổi tháng — đã grep, không có.
  //
  // Nghĩa là mọi con số hiện ra kèm chữ "/tháng" thực chất là phần trăm của
  // chi tiêu MỘT TUẦN, tức GHI THẤP quy mô thật khoảng 4,3 lần. Với một con
  // số dùng để xếp thứ tự việc cần làm và để báo cáo lên trên, sai đơn vị
  // còn tệ hơn không có số.
  //
  // Quy đổi ở ĐÂY, một chỗ duy nhất, thay vì sửa 6 collector — để không lần
  // sau thêm collector mới lại quên.
  const WEEK_TO_MONTH = 30 / 7;
  const toMonthly = (v: number | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v * WEEK_TO_MONTH) : undefined;

  const estimatedMonthlyLift = toMonthly(
    imp?.estMonthlyLiftVnd ?? (imp?.direction === "gain" ? imp.estMonthlySavingsVnd : undefined));
  const estimatedMonthlySavings = toMonthly(
    imp && imp.direction !== "gain" ? imp.estMonthlySavingsVnd : undefined);

  const reasonCodes = Array.from(new Set([signal.reasonCode, signal.originReason].filter(Boolean) as string[]));

  const rec: NbaRecommendation = {
    id: randomUUID(),
    calcVersion: NBA_CALC_VERSION,
    dedupeKey,
    company: signal.company,
    platform: signal.platform,
    entityType: signal.entityType,
    entityId: signal.entityId,
    entityName: signal.entityName,

    category: meta.category,
    recommendationType: meta.recommendationType,
    reasonCode: signal.reasonCode,
    reasonCodes,
    sourceSignals: [signal.sourceEngine],

    title: signal.title,
    summary: buildSummary(signal),
    explanation: signal.explanation,
    recommendedAction: buildRecommendedAction(signal),
    expectedOutcome: buildExpectedOutcome(signal),
    evidence: signal.evidence,
    supportingMetrics: buildSupportingMetrics(signal.evidence),
    impactEstimate: imp,
    estimatedMonthlySavings,
    estimatedMonthlyLift,

    scores,
    priorityScore: scores.priority,
    impactScore: scores.impact,
    urgencyScore: scores.urgency,
    confidenceScore: scores.confidence,
    safetyScore: scores.safety,
    dataCompletenessScore: scores.dataCompleteness,
    persistenceScore: scores.persistence,

    executionMode: "advisory_only", // set lại sau guards
    actionMode: meta.defaultActionMode,
    executor: meta.executor,
    blockedBy: [],
    guardFlags: [],
    suggestedAction: signal.suggestedAction,
    internalLink: meta.internalLink,

    occurrenceCount: opts.occurrenceCount,
    status: "new",
    clusterKey,
    generatedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(nowMs + EXPIRY_DAYS * 86_400_000).toISOString(),
  };

  applyGuards(rec, signal._guardCampaign, { recentlyChanged: opts.recentlyChanged });
  rec.executionMode = toExecutionMode(rec.actionMode);
  return rec;
}

/** Chạy engine trên typed input collections. PURE. */
export function runEngine(inputs: NbaInputs, ctx: NbaContext): NbaRecommendation[] {
  const nowMs = ctx.now ?? Date.now();
  const recentlyChanged = new Set(inputs.recentlyChangedEntityIds ?? []);
  const priorOccurrences = inputs.priorOccurrences ?? {};
  const priors = inputs.priors ?? {};

  // 1) Gom tín hiệu: collectors trên campaigns + adapter improvements.
  const signals: NbaSignal[] = [];
  for (const collect of COLLECTORS) {
    try { signals.push(...collect(inputs.campaigns, ctx)); }
    catch (err) { console.warn("[nba] collector failed (non-blocking):", err); }
  }
  if (inputs.improvements?.length) {
    try { signals.push(...improvementsToSignals(inputs.improvements, ctx)); }
    catch (err) { console.warn("[nba] improvements adapter failed:", err); }
  }

  // 2) Build + score + guard.
  const recs = signals.map(s => {
    const dedupeKey = `${s.company}:${s.entityType}:${s.entityId}:${s.reasonCode}`;
    const occurrenceCount = (priorOccurrences[dedupeKey] ?? 0) + 1;
    return buildRecommendation(s, nowMs, {
      occurrenceCount,
      recentlyChanged: recentlyChanged.has(s.entityId),
      prior: priors[s.reasonCode] ?? 0,
    });
  });

  // 3) Xung đột tăng/giảm cùng entity → 4) dedupe chéo nguồn theo cluster.
  return dedupeByCluster(resolveConflicts(recs));
}

/** Wrapper tương thích slice-1: chạy trực tiếp trên Campaign[]. */
export function run(campaigns: Campaign[], ctx: NbaContext): NbaRecommendation[] {
  return runEngine({ campaigns }, ctx);
}

export { priorityBand };
