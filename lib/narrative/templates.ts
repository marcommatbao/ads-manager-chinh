// ============================================================
// Narrative Layer — Vietnamese Business-Tone Templates
//
// Each function returns a single sentence (never paragraph-length).
// Tone rules:
//   - confident:  direct, positive, action-oriented
//   - cautious:   hedge with "có thể", "theo dữ liệu hiện tại"
//   - urgent:     alert tone, name the risk, propose next step
//   - neutral:    factual, no recommendation
//   - blocked:    explain what was prevented and why (non-judgmental)
// ============================================================

import type { NarrativeTone, ConfidenceLabel } from "./types";

// ── Recommendation card ───────────────────────────────────

export function recTitle(reasonCode: string, entityName: string): string {
  const map: Record<string, string> = {
    SCALE_WINNER:            `Tăng ngân sách: ${entityName}`,
    CPL_CRITICAL:            `CPL vượt ngưỡng: ${entityName}`,
    CPL_WARNING:             `Cảnh báo CPL: ${entityName}`,
    ZERO_CONV_SPEND:         `Chi tiêu không chuyển đổi: ${entityName}`,
    CREATIVE_FATIGUE:        `Creative mệt mỏi: ${entityName}`,
    LOW_ROAS_REVIEW:         `ROAS thấp cần xem lại: ${entityName}`,
    PAUSE_FB_AD_LOW_CTR:     `CTR thấp: ${entityName}`,
    DAYPART_OPPORTUNITY:     `Cơ hội theo giờ: ${entityName}`,
    FIX_LOW_QS_KEYWORD:      `Quality Score thấp: ${entityName}`,
    NEGATIVE_KEYWORD_WASTE:  `Từ khóa phủ định lãng phí: ${entityName}`,
  };
  return map[reasonCode] ?? `Gợi ý hành động: ${entityName}`;
}

export function recInsight(reasonCode: string, confidence: number, entityName: string): string {
  const conf = confidence >= 80 ? "với độ tin cậy cao" : confidence >= 65 ? "theo dữ liệu hiện tại" : "tuy nhiên cần theo dõi thêm";
  const map: Record<string, string> = {
    SCALE_WINNER:            `Campaign "${entityName}" đang hiệu quả — AI đề xuất tăng ngân sách ${conf}.`,
    CPL_CRITICAL:            `CPL của "${entityName}" đã vượt ngưỡng an toàn — cần giảm ngân sách hoặc tối ưu ngay.`,
    CPL_WARNING:             `CPL của "${entityName}" đang tăng ${conf} — nên theo dõi sát trong 24h tới.`,
    ZERO_CONV_SPEND:         `"${entityName}" chi tiêu nhưng không có chuyển đổi — AI đề xuất tạm dừng để xem lại targeting.`,
    CREATIVE_FATIGUE:        `Creative trong "${entityName}" đang bị mệt mỏi ${conf} — nên thay thế hoặc rotate mới.`,
    LOW_ROAS_REVIEW:         `ROAS của "${entityName}" dưới kỳ vọng — ${conf}, cần xem lại chiến lược bidding.`,
    PAUSE_FB_AD_LOW_CTR:     `CTR của "${entityName}" thấp hơn benchmark ${conf} — cân nhắc tạm dừng và tối ưu ad copy.`,
    DAYPART_OPPORTUNITY:     `Dữ liệu cho thấy "${entityName}" có cơ hội tăng hiệu quả nếu schedule đúng khung giờ.`,
    FIX_LOW_QS_KEYWORD:      `Quality Score của từ khóa trong "${entityName}" thấp — ảnh hưởng đến chi phí và vị trí.`,
    NEGATIVE_KEYWORD_WASTE:  `"${entityName}" đang chi tiêu cho truy vấn không liên quan — cần thêm từ khóa phủ định.`,
  };
  return map[reasonCode] ?? `AI phát hiện cơ hội cải thiện trên "${entityName}" ${conf}.`;
}

// ── Outcome card ──────────────────────────────────────────

export function outcomeTitle(outcomeLabel: string, entityName: string): string {
  const map: Record<string, string> = {
    significantly_better: `Cải thiện rõ rệt: ${entityName}`,
    better:               `Tiến triển tốt: ${entityName}`,
    neutral:              `Không đổi: ${entityName}`,
    mixed:                `Kết quả lẫn lộn: ${entityName}`,
    worse:                `Giảm hiệu quả: ${entityName}`,
    significantly_worse:  `Sụt giảm mạnh: ${entityName}`,
    inconclusive:         `Chưa đủ dữ liệu: ${entityName}`,
    blocked_by_learning:  `Đang học: ${entityName}`,
    blocked_by_anomaly:   `Bất thường: ${entityName}`,
  };
  return map[outcomeLabel] ?? `Kết quả đánh giá: ${entityName}`;
}

export function outcomeInsight(
  outcomeLabel: string,
  primaryReason: string,
  entityName: string,
  recommendedNextStep: string,
): string {
  if (outcomeLabel === "significantly_better" || outcomeLabel === "better") {
    return `"${entityName}" cho thấy kết quả tích cực: ${primaryReason}. ${recommendedNextStep}.`;
  }
  if (outcomeLabel === "worse" || outcomeLabel === "significantly_worse") {
    return `"${entityName}" ghi nhận sụt giảm: ${primaryReason}. Đề xuất: ${recommendedNextStep}.`;
  }
  if (outcomeLabel === "mixed") {
    return `Kết quả "${entityName}" chưa rõ ràng: ${primaryReason}. ${recommendedNextStep}.`;
  }
  if (outcomeLabel === "inconclusive") {
    return `Chưa đủ dữ liệu để đánh giá "${entityName}". ${recommendedNextStep}.`;
  }
  if (outcomeLabel === "blocked_by_learning") {
    return `"${entityName}" đang trong giai đoạn học — kết quả chưa đáng tin cậy. Chờ thêm dữ liệu.`;
  }
  return `${primaryReason}. ${recommendedNextStep}.`;
}

// ── Safety block card ─────────────────────────────────────

export function blockTitle(entityName: string): string {
  return `Auto-apply bị chặn: ${entityName}`;
}

export function blockInsight(explanation: string, entityName: string): string {
  return `Hành động trên "${entityName}" không được thực thi tự động. ${explanation}`;
}

// ── Memory signal card ────────────────────────────────────

export function signalInsight(event: string, verdict: string, entityName: string): string {
  if (verdict === "better") {
    return `Hành động "${event}" trước đây trên "${entityName}" cho kết quả tích cực — tín hiệu này giúp tăng độ tin cậy cho gợi ý tương tự.`;
  }
  if (verdict === "worse") {
    return `Hành động "${event}" trước đây trên "${entityName}" cho kết quả tệ hơn — AI đang thận trọng hơn với gợi ý tương tự.`;
  }
  return `Lịch sử hành động "${event}" trên "${entityName}" cho thấy kết quả trung lập — chưa có tín hiệu học rõ ràng.`;
}

// ── Confidence caveat ─────────────────────────────────────

export function confidenceCaveat(level: ConfidenceLabel): string | undefined {
  if (level === "high") return undefined;
  if (level === "medium") return "(Độ tin cậy trung bình — nên theo dõi thêm trước khi quyết định quy mô lớn.)";
  if (level === "low") return "(Độ tin cậy thấp — đây là gợi ý định hướng, chưa đủ cơ sở để thực thi tự động.)";
  return "(Chưa đủ dữ liệu — gợi ý này chỉ mang tính tham khảo.)";
}

// ── Briefing headline ─────────────────────────────────────

export function briefingHeadline(
  company:      string,
  urgentCount:  number,
  positiveCount: number,
  totalCards:   number,
): string {
  if (urgentCount > 0 && positiveCount > 0) {
    return `[${company}] Hôm nay: ${urgentCount} vấn đề cần xử lý, ${positiveCount} cơ hội tăng trưởng trong ${totalCards} gợi ý.`;
  }
  if (urgentCount > 0) {
    return `[${company}] Cảnh báo: ${urgentCount} vấn đề cần chú ý ngay hôm nay.`;
  }
  if (positiveCount > 0) {
    return `[${company}] Tín hiệu tốt: ${positiveCount} cơ hội cải thiện hiệu quả đang chờ xem xét.`;
  }
  return `[${company}] Tình trạng ổn định — ${totalCards} thông tin cập nhật hôm nay.`;
}

// ── Tone mapper ───────────────────────────────────────────

export function toneForOutcome(outcomeLabel: string): NarrativeTone {
  if (["significantly_better", "better"].includes(outcomeLabel))   return "confident";
  if (["significantly_worse", "worse"].includes(outcomeLabel))     return "urgent";
  if (["mixed", "inconclusive"].includes(outcomeLabel))            return "cautious";
  if (["blocked_by_learning", "blocked_by_anomaly"].includes(outcomeLabel)) return "neutral";
  return "neutral";
}

export function toneForConfidence(score: number, isPositive: boolean): NarrativeTone {
  if (score >= 80 && isPositive) return "confident";
  if (score >= 80 && !isPositive) return "urgent";
  if (score >= 60) return "cautious";
  return "neutral";
}
