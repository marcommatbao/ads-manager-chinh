// ============================================================
// Phase 6 — evidence-backed profit optimization contract
// ============================================================

export type ProfitConfidence = "high" | "medium" | "insufficient";

export interface ProfitComponent {
  value: number;
  source: string;
  from: string;
  to: string;
  readAt: string;
}

export interface ProfitInput {
  grossRevenue: ProfitComponent;
  refunds: ProfitComponent;
  cogs: ProfitComponent | null;
  adSpend: ProfitComponent;
}

export interface ProfitQuality {
  confidence: ProfitConfidence;
  allowed: boolean;
  reason: string;
  from: string;
  to: string;
  readAt: string;
}

export interface ProfitReport {
  formulaVersion: "phase6-v1";
  requiresBaApproval: boolean;
  quality: ProfitQuality;
  grossRevenue: number | null;
  refunds: number | null;
  netRevenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  adSpend: number | null;
  netProfitAfterAds: number | null;
  grossMarginPct: number | null;
  breakEvenRoas: number | null;
}

function sameRange(input: ProfitInput): boolean {
  const components = [input.grossRevenue, input.refunds, input.adSpend, input.cogs].filter(Boolean) as ProfitComponent[];
  return components.every((component) => component.from === input.grossRevenue.from && component.to === input.grossRevenue.to);
}

export function calculateProfit(input: ProfitInput): ProfitReport {
  const readAt = new Date().toISOString();
  const from = input.grossRevenue.from;
  const to = input.grossRevenue.to;
  const values = [input.grossRevenue, input.refunds, input.adSpend];
  const hasValidValues = values.every((component) =>
    Number.isFinite(component.value) && component.value >= 0,
  );
  const hasCogs = Boolean(input.cogs && Number.isFinite(input.cogs.value) && input.cogs.value >= 0);
  const allowed = hasValidValues && hasCogs && sameRange(input);
  const reason = !hasCogs
    ? "Thiếu giá vốn (COGS); không thể kết luận lợi nhuận hoặc biên lợi nhuận."
    : !hasValidValues
      ? "Một thành phần doanh thu/hoàn tiền/chi quảng cáo không hợp lệ."
      : !sameRange(input)
        ? "Các thành phần không cùng khoảng thời gian; không thể cộng trừ an toàn."
        : "Đủ nguồn và cùng khoảng thời gian để tính lợi nhuận.";

  if (!allowed) {
    return {
      formulaVersion: "phase6-v1",
      requiresBaApproval: true,
      quality: { confidence: "insufficient", allowed: false, reason, from, to, readAt },
      grossRevenue: null, refunds: null, netRevenue: null, cogs: null,
      grossProfit: null, adSpend: null, netProfitAfterAds: null,
      grossMarginPct: null, breakEvenRoas: null,
    };
  }

  const grossRevenue = input.grossRevenue.value;
  const refunds = input.refunds.value;
  const netRevenue = grossRevenue - refunds;
  const cogs = input.cogs!.value;
  const grossProfit = netRevenue - cogs;
  const adSpend = input.adSpend.value;
  const netProfitAfterAds = grossProfit - adSpend;

  return {
    formulaVersion: "phase6-v1",
    requiresBaApproval: true,
    quality: { confidence: "high", allowed: true, reason, from, to, readAt },
    grossRevenue, refunds, netRevenue, cogs, grossProfit, adSpend, netProfitAfterAds,
    grossMarginPct: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : null,
    // Revenue needed to cover COGS and ad spend, expressed as revenue/ad spend.
    breakEvenRoas: adSpend > 0 ? (cogs + adSpend) / adSpend : null,
  };
}
