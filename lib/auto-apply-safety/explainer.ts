// ============================================================
// Auto-Apply Safety — Explanation + PostAction Plan Builder
//
// Turns raw block reasons into a human-readable Vietnamese
// summary and generates the PostActionEvaluationPlan.
// ============================================================

import type {
  BlockReason,
  PostActionEvaluationPlan,
  PostEvalWindow,
  RollbackThreshold,
  SafetyCheckInput,
  ExecutionDecision,
} from "./types";

// ── Vietnamese explanation ────────────────────────────────

const BLOCK_VI: Record<string, string> = {
  env_mode_off:           "Auto-apply đã tắt trong cấu hình hệ thống (NBA_AUTO_APPLY=off)",
  env_mode_dry_run:       "Đang chạy ở chế độ mô phỏng (NBA_AUTO_APPLY=dry_run) — chưa thực thi thật",
  learning_phase:         "Campaign đang trong giai đoạn học của Meta — tác động sẽ không đáng tin cậy",
  anomaly_active:         "Phát hiện bất thường chỉ số trên entity này — cần điều tra trước khi thay đổi",
  cooldown_recent_change: "Entity vừa được thay đổi gần đây (<24h) — hệ thống đang trong thời gian chờ",
  low_confidence:         "Độ tin cậy của gợi ý chưa đủ cao để tự động áp dụng hành động này",
  memory_worse_entity:    "Entity này có kết quả 'tệ hơn' sau hành động tương tự trong 14 ngày qua",
  memory_worse_pattern:   "Hơn 50% hành động cùng loại trên các entity tương tự cho kết quả tệ gần đây",
  insufficient_data:      "Dữ liệu chi tiêu/lượt hiển thị chưa đủ để đưa ra quyết định đáng tin cậy",
  rate_limited:           "Đã đạt giới hạn số lần auto-apply trên entity này trong khoảng thời gian ngắn",
  unsupported_action:     "Loại hành động này chưa được hỗ trợ bởi executor tự động",
  budget_cap_hit:         "Ngân sách đã đạt mức trần — không thể tăng thêm",
};

export function buildExplanation(
  decision:    ExecutionDecision,
  blockReasons: BlockReason[],
  input:       SafetyCheckInput,
): string {
  const entity = `${input.entityType} "${input.entityName}"`;

  if (decision === "proceed") {
    return `Hành động trên ${entity} đã qua kiểm tra an toàn — được phép thực thi tự động.`;
  }

  if (decision === "dry_run") {
    const dryReason = blockReasons.find(r => r.code === "env_mode_dry_run");
    if (dryReason) {
      return `${entity}: ${BLOCK_VI.env_mode_dry_run}. Hành động sẽ được mô phỏng và ghi log, không chạm tài khoản quảng cáo thật.`;
    }
  }

  if (blockReasons.length === 0) {
    return `${entity}: Không thể thực thi — lý do không xác định.`;
  }

  const primary = blockReasons[0];
  const primaryText = BLOCK_VI[primary.code] ?? primary.message;
  const additional = blockReasons.slice(1).map(r => BLOCK_VI[r.code] ?? r.message);

  let text = `${entity} bị chặn: ${primaryText}.`;
  if (additional.length === 1) {
    text += ` Ngoài ra: ${additional[0]}.`;
  } else if (additional.length > 1) {
    text += ` Và ${additional.length} lý do khác: ${additional.slice(0, 2).join("; ")}.`;
  }
  return text;
}

// ── Post-action evaluation plan ───────────────────────────

function windowsForEvent(event: string, entityType: string): PostEvalWindow[] {
  const now = Date.now();
  const h   = (hours: number) => new Date(now + hours * 3_600_000).toISOString();

  const group = event.split(".")[0];

  // Budget changes: 24h quick check + 7d primary
  if (group === "budget") {
    const isIncrease = event.includes("increase");
    const metric = isIncrease ? "leads" : "cpl";
    const target  = isIncrease ? "improve" : "improve";
    return [
      { label: "24h",  dueAt: h(24),  primaryMetric: "cpl",    target: "maintain" },
      { label: "72h",  dueAt: h(72),  primaryMetric: metric,   target },
      { label: "7d",   dueAt: h(168), primaryMetric: metric,   target },
      { label: "14d",  dueAt: h(336), primaryMetric: "roas",   target: "improve" },
    ];
  }

  // Pause actions: 3d check, then 7d
  if (group === "campaign" || group === "adset") {
    return [
      { label: "72h", dueAt: h(72),  primaryMetric: "spend", target: "neutral" },
      { label: "7d",  dueAt: h(168), primaryMetric: "cpl",   target: "improve" },
    ];
  }

  // Creative actions
  if (group === "creative") {
    return [
      { label: "24h", dueAt: h(24),  primaryMetric: "ctr",       target: "improve" },
      { label: "72h", dueAt: h(72),  primaryMetric: "frequency",  target: "improve" },
      { label: "7d",  dueAt: h(168), primaryMetric: "leads",      target: "maintain" },
    ];
  }

  // NBA / automation events — generic
  return [
    { label: "24h", dueAt: h(24),  primaryMetric: "cpl",   target: "maintain" },
    { label: "7d",  dueAt: h(168), primaryMetric: "roas",  target: "improve" },
  ];
}

function rollbacksForEvent(event: string, input: SafetyCheckInput): RollbackThreshold[] {
  const group = event.split(".")[0];

  if (group === "budget" && event.includes("increase")) {
    // Alert if CPL spikes >30% from baseline
    return [
      { metric: "cpl", threshold: 1.30, direction: "above", actionType: "alert" },
      { metric: "cpl", threshold: 1.60, direction: "above", actionType: "pause" },
    ];
  }

  if (group === "budget" && event.includes("decrease")) {
    // Alert if leads drop >40%
    return [
      { metric: "leads", threshold: 0.60, direction: "below", actionType: "alert" },
    ];
  }

  if (group === "campaign" || group === "adset") {
    return [
      { metric: "spend", threshold: 0.10, direction: "above", actionType: "alert" },
    ];
  }

  return [];
}

export function buildEvaluationPlan(
  input:        SafetyCheckInput,
  reviewRequired = false,
): PostActionEvaluationPlan {
  const windows = windowsForEvent(input.event, input.entityType);
  const primary = windows[Math.min(1, windows.length - 1)].label; // 72h or first available

  const rollbacks = rollbacksForEvent(input.event, input);

  // Destructive actions always require review
  const isDestructive = ["campaign.pause", "adset.pause", "budget.decrease"].includes(input.event);

  return {
    evaluationWindows:  windows,
    primaryWindow:      primary,
    rollbackThresholds: rollbacks,
    reviewRequired:     reviewRequired || isDestructive,
    reviewNote: isDestructive
      ? `Hành động "${input.event}" cần được xem lại thủ công sau khi hoàn thành cửa sổ đánh giá`
      : undefined,
  };
}
