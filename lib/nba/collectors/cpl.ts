// ============================================================
// NBA collector — CPL
// Nguồn: lib/cpl-calculator (ngưỡng riêng MBC/MBI).
// Emit: CPL_CRITICAL / CPL_WARNING / ZERO_CONV_SPEND.
// ============================================================

import type { Campaign } from "@/types/ads.types";
import { getCplThresholds } from "@/lib/cpl-calculator";
import { costLevel, resolveTarget } from "@/lib/targets/resolve";
import type { NbaSignal, NbaContext } from "../types";
import { detectCompany, platformOf, isActive } from "./helpers";
import { inLearning, MIN_CONV_FOR_CPL, ZERO_CONV_MIN_CLICKS, ZERO_CONV_MIN_SPEND_PERIOD } from "@/lib/data-sufficiency";


export function cplCollector(campaigns: Campaign[], ctx: NbaContext): NbaSignal[] {
  const allowed = new Set(ctx.companies);
  const out: NbaSignal[] = [];

  for (const c of campaigns) {
    if (!isActive(c)) continue;
    const company = detectCompany(c);
    if (!company || !allowed.has(company)) continue;

    const spend = c.metrics.spend ?? 0;
    const conv = c.metrics.conversions ?? 0;
    const platform = platformOf(c);
    // Đợt 23: đang học → chưa chấm (số còn dao động mạnh; nền tảng đang dò).
    if (inLearning(c as Parameters<typeof inLearning>[0])) continue;

    // ── Tiêu tiền không chuyển đổi ──
    // Đợt 23: trước đây chi > 50K là báo — nay cần chi đủ lớn VÀ đủ lượt bấm mới kết luận "không chuyển đổi".
    if (conv === 0 && spend > ZERO_CONV_MIN_SPEND_PERIOD && (c.metrics.clicks ?? 0) >= ZERO_CONV_MIN_CLICKS) {
      out.push({
        reasonCode: "ZERO_CONV_SPEND",
        company, platform,
        entityType: "campaign",
        entityId: c.id,
        entityName: c.name,
        title: `"${c.name}" tiêu ₫${Math.round(spend).toLocaleString("vi-VN")} nhưng 0 chuyển đổi`,
        explanation: `Campaign đang chi tiêu mà chưa ghi nhận conversion nào trong kỳ. Cân nhắc tạm dừng hoặc rà soát tracking/targeting.`,
        evidence: [
          { metric: "spend", current: Math.round(spend), unit: "₫" },
          { metric: "conversions", current: 0, unit: "" },
        ],
        severity: "critical",
        sampleSize: c.metrics.clicks ?? 0,
        impactEstimate: { metric: "spend", direction: "reduce_waste", estMonthlySavingsVnd: Math.round(spend) },
        suggestedAction: { type: "PAUSE_CAMPAIGN" },
        sourceEngine: "cpl-calculator",
        _guardCampaign: c,
      });
      continue;
    }

    if (conv < MIN_CONV_FOR_CPL) continue; // Đợt 23: 1–2 chuyển đổi chưa đủ để nói CPL đắt hay rẻ
    const cpl = spend / conv;
    // Đợt 23 (3b): ngưỡng ở Xử lý chiến dịch → Mục tiêu (CPL thu lead) nếu đã nhập; chưa → ngưỡng cũ (suy từ KPI, như classifyCPL).
    const old = getCplThresholds()[company];
    const th = resolveTarget({ company, campaignName: c.name, goalKind: "leads", fallback: old ? { target: old.good, ceiling: old.warning, source: "cpl_calculator" } : null });
    const level = th ? costLevel(cpl, th) : "no_data";

    if (level === "critical") {
      out.push({
        reasonCode: "CPL_CRITICAL",
        company, platform,
        entityType: "campaign",
        entityId: c.id,
        entityName: c.name,
        title: `CPL "${c.name}" = ₫${Math.round(cpl).toLocaleString("vi-VN")} (đỏ)`,
        explanation: `CPL vượt ngưỡng đỏ của ${company}${th?.source === "case_target_cpl" ? ` (trần ₫${Math.round(th.ceiling).toLocaleString("vi-VN")} ở Mục tiêu)` : ""}. Rà soát targeting/creative hoặc giảm bid; nếu xấu kéo dài cân nhắc tạm dừng.`,
        evidence: [
          { metric: "CPL", current: Math.round(cpl), unit: "₫" },
          { metric: "conversions", current: conv, unit: "" },
          { metric: "spend", current: Math.round(spend), unit: "₫" },
        ],
        severity: "critical",
        sampleSize: conv,
        impactEstimate: { metric: "CPL", direction: "save", estMonthlySavingsVnd: Math.round(spend * 0.2) },
        suggestedAction: { type: "REVIEW_OR_PAUSE" },
        sourceEngine: "cpl-calculator",
        _guardCampaign: c,
      });
    } else if (level === "warning") {
      out.push({
        reasonCode: "CPL_WARNING",
        company, platform,
        entityType: "campaign",
        entityId: c.id,
        entityName: c.name,
        title: `CPL "${c.name}" = ₫${Math.round(cpl).toLocaleString("vi-VN")} (theo dõi)`,
        explanation: `CPL ở vùng theo dõi của ${company}. Quan sát thêm, tối ưu nhẹ targeting/creative trước khi can thiệp mạnh.`,
        evidence: [
          { metric: "CPL", current: Math.round(cpl), unit: "₫" },
          { metric: "conversions", current: conv, unit: "" },
        ],
        severity: "warning",
        sampleSize: conv,
        impactEstimate: { metric: "CPL", direction: "save", estMonthlySavingsVnd: Math.round(spend * 0.1) },
        sourceEngine: "cpl-calculator",
        _guardCampaign: c,
      });
    }
  }

  return out;
}
