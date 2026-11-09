// ============================================================
// Automation Sim — explanation / metric helpers (pure)
// supportingMetrics · proposedValueChange · impactSummary · warnings
// ============================================================

import type { Campaign } from "@/types/ads.types";
import type { ProposedValueChange, SimProposedAction } from "./types";

export const LARGE_MAGNITUDE_PCT = 50; // |Δ budget| > ngưỡng → cảnh báo

const fmtVnd = (v: number) => `₫${Math.round(v).toLocaleString("vi-VN")}`;

export function buildSupportingMetrics(c: Campaign): Record<string, number> {
  const m = c.metrics;
  const conv = m.conversions ?? 0;
  return {
    spend: Math.round(m.spend ?? 0),
    conversions: conv,
    cpl: conv > 0 ? Math.round((m.spend ?? 0) / conv) : 0,
    roas: Math.round((m.roas ?? 0) * 100) / 100,
    ctr: Math.round((m.ctr ?? 0) * 100) / 100,
    frequency: Math.round((m.frequency ?? 0) * 100) / 100,
    dailyBudget: Math.round(c.dailyBudget ?? 0),
    budgetUsedPct: c.dailyBudget > 0 ? Math.round(((m.spend ?? 0) / c.dailyBudget) * 100) : 0,
  };
}

/** Thay đổi giá trị cụ thể cho action budget; null nếu không phải. */
export function buildProposedValueChange(c: Campaign, action: SimProposedAction): ProposedValueChange | null {
  if (action.type !== "increase_budget" && action.type !== "decrease_budget") return null;
  const pct = Number(action.params?.value) || 0;
  const signed = action.type === "increase_budget" ? pct : -pct;
  const from = Math.round(c.dailyBudget ?? 0);
  const to = Math.round(from * (1 + signed / 100));
  return { field: "daily_budget", fromValue: from, toValue: to, deltaPct: signed };
}

export function buildImpactSummary(c: Campaign, action: SimProposedAction, vc: ProposedValueChange | null, estVnd: number): string {
  if (!action.mutating) return `${action.label} (chỉ tham khảo, không thực thi tự động)`;
  if (vc) return `${action.label}: ${fmtVnd(vc.fromValue)} → ${fmtVnd(vc.toValue)} (${vc.deltaPct >= 0 ? "+" : ""}${vc.deltaPct}%)`;
  if (action.destructive) return `${action.label} — chặn ~${fmtVnd(estVnd)} lãng phí/kỳ`;
  return action.label;
}

export function buildWarnings(c: Campaign, action: SimProposedAction, vc: ProposedValueChange | null): string[] {
  const w: string[] = [];
  const m = c.metrics;
  if (vc && Math.abs(vc.deltaPct) > LARGE_MAGNITUDE_PCT) w.push(`Thay đổi ngân sách lớn (${vc.deltaPct >= 0 ? "+" : ""}${vc.deltaPct}%)`);
  if ((m.frequency ?? 0) >= 3.5) w.push(`Tần suất cao (${(m.frequency ?? 0).toFixed(2)})`);
  if ((m.conversions ?? 0) > 0 && (m.conversions ?? 0) < 5) w.push(`Rất ít chuyển đổi (${m.conversions})`);
  if (action.destructive && (m.spend ?? 0) > 5_000_000) w.push(`Chi tiêu lớn (${fmtVnd(m.spend ?? 0)}) — cân nhắc kỹ`);
  return w;
}

export function isLargeMagnitude(vc: ProposedValueChange | null): boolean {
  return !!vc && Math.abs(vc.deltaPct) > LARGE_MAGNITUDE_PCT;
}
