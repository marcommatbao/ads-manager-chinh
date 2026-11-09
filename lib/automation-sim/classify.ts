// ============================================================
// Automation Sim — outcome classifier (4 buckets) + policy gate
// ============================================================

import type { SimContext, SimulationStatus, SimProposedAction, SimReasonCode, SimRisk } from "./types";

const HARD: SimReasonCode[] = ["ROLE_RESTRICTION", "COOLDOWN_ACTIVE", "RECENT_CHANGE", "MISSING_METRICS", "BUDGET_GUARD"];
const SOFT: SimReasonCode[] = ["LEARNING_PHASE", "LOW_DATA", "NOT_REVERSIBLE", "LOW_CONFIDENCE", "CONFLICTING_RECOMMENDATION", "CAP_EXCEEDED", "LARGE_MAGNITUDE"];

const REASON_TEXT: Record<SimReasonCode, string> = {
  LEARNING_PHASE: "đang trong learning phase",
  COOLDOWN_ACTIVE: "rule còn trong thời gian nghỉ (cooldown)",
  RECENT_CHANGE: "vừa có thay đổi gần đây, chờ đo kết quả",
  LOW_DATA: "dữ liệu chưa đủ tin cậy",
  MISSING_METRICS: "thiếu chỉ số (chưa có chi tiêu/hiển thị)",
  ROLE_RESTRICTION: "ngoài phạm vi công ty/quyền của bạn",
  NOT_REVERSIBLE: "hành động khó hoàn tác",
  CAP_EXCEEDED: "vượt hạn mức tự áp trong lần chạy",
  BUDGET_GUARD: "chạm ngưỡng ngân sách tối thiểu",
  LOW_CONFIDENCE: "độ tin cậy thấp",
  LARGE_MAGNITUDE: "mức thay đổi quá lớn",
  CONFLICTING_RECOMMENDATION: "có đề xuất đối nghịch trên cùng entity",
  POLICY_OFF: "auto-apply đang tắt",
  POLICY_DRY_RUN: "auto-apply đang chạy thử (dry-run)",
};

export interface ClassifyInput {
  action: SimProposedAction;
  blockedBy: SimReasonCode[];
  risk: SimRisk;
  ctx: SimContext;
  capExceeded: boolean;
}

export interface ClassifyOutput {
  simulationStatus: SimulationStatus;
  reasonCodes: SimReasonCode[];
  explanation: string;
}

export function classify(input: ClassifyInput): ClassifyOutput {
  const { action, risk, ctx } = input;
  const reasons = new Set<SimReasonCode>(input.blockedBy);
  if (input.capExceeded) reasons.add("CAP_EXCEEDED");

  const has = (codes: SimReasonCode[]) => codes.some(c => reasons.has(c));
  const explain = (verb: string) =>
    `${action.label} — ${verb}${reasons.size ? `: ${[...reasons].map(r => REASON_TEXT[r]).join("; ")}.` : "."}`;

  // Action không chạm tài khoản → chỉ tham khảo
  if (!action.mutating) {
    return { simulationStatus: "simulate_only", reasonCodes: [...reasons], explanation: explain("hành động tư vấn, không thực thi tự động") };
  }
  // Blocker cứng → chặn
  if (has(HARD)) {
    return { simulationStatus: "blocked", reasonCodes: [...reasons], explanation: explain("BỊ CHẶN") };
  }
  // Blocker mềm → cần người duyệt
  if (has(SOFT)) {
    return { simulationStatus: "manual_review_required", reasonCodes: [...reasons], explanation: explain("cần người duyệt") };
  }
  // Rủi ro cao dù không có blocker → cần người duyệt
  if (risk.band === "high") {
    return { simulationStatus: "manual_review_required", reasonCodes: [...reasons], explanation: explain("rủi ro cao, cần người duyệt") };
  }
  // Đủ điều kiện an toàn — áp policy
  if (!ctx.canApply) {
    return { simulationStatus: "simulate_only", reasonCodes: [...reasons], explanation: explain("bạn không có quyền tự áp (chỉ xem)") };
  }
  if (ctx.policy === "off") {
    reasons.add("POLICY_OFF");
    return { simulationStatus: "simulate_only", reasonCodes: [...reasons], explanation: explain("đủ an toàn nhưng auto-apply đang tắt") };
  }
  if (ctx.policy === "dry_run") reasons.add("POLICY_DRY_RUN");
  return { simulationStatus: "safe_for_auto_apply", reasonCodes: [...reasons], explanation: explain("AN TOÀN để tự áp") };
}
