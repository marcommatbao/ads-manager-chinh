// ============================================================
// Creative Brief — Tone Engine
// Matrix: company × objective × funnelStage × sophistication
// → ToneStrategy
// ============================================================

import type { BriefCompany, BriefFunnelStage, BriefObjective, ToneStrategy } from "./types";

interface ToneEntry {
  primaryTone:    string;
  secondaryTone?: string;
  voiceGuidance:  string;
}

type ToneKey = `${BriefCompany}:${BriefObjective}:${BriefFunnelStage}`;

const TONE_MATRIX: Partial<Record<ToneKey, ToneEntry>> = {
  // ── MBC ──────────────────────────────────────────────────
  "MBC:awareness:top": {
    primaryTone:   "educational",
    voiceGuidance: "Dạy, không bán. Bắt đầu bằng kiến thức hoặc câu hỏi khiến người đọc tự nhận ra vấn đề của mình.",
  },
  "MBC:consideration:mid": {
    primaryTone:   "authoritative",
    secondaryTone: "helpful",
    voiceGuidance: "So sánh rõ ràng, nêu ưu điểm cụ thể. Tránh nói chung chung — đưa ra con số và tính năng thực tế.",
  },
  "MBC:conversion:bottom": {
    primaryTone:   "proof-driven",
    secondaryTone: "urgent",
    voiceGuidance: "Dẫn bằng bằng chứng (số liệu, khách hàng thực tế) rồi mới kêu gọi. CTA rõ, thời gian cụ thể.",
  },
  "MBC:retention:mid": {
    primaryTone:   "partnership",
    voiceGuidance: "Tôn vinh sự chung thủy của khách. Nói về tương lai cùng nhau, không nói về sản phẩm mới.",
  },
  "MBC:retention:bottom": {
    primaryTone:   "partnership",
    secondaryTone: "exclusive",
    voiceGuidance: "Đặc quyền khách hàng lâu năm. Tone thân mật, như nói với người quen cũ.",
  },

  // ── MBI ──────────────────────────────────────────────────
  "MBI:awareness:top": {
    primaryTone:   "empathetic",
    voiceGuidance: "Bắt đầu từ nỗi đau thực tế (thuế/phạt/giấy tờ). Đặt mình vào vị trí khách — họ không muốn biết về sản phẩm, họ muốn giải quyết vấn đề.",
  },
  "MBI:consideration:mid": {
    primaryTone:   "compliance-aware",
    secondaryTone: "reassuring",
    voiceGuidance: "Nhấn mạnh tính pháp lý và tin cậy. Khách MBI lo ngại rủi ro hơn là cơ hội — hãy loại bỏ nỗi lo trước khi nói lợi ích.",
  },
  "MBI:conversion:bottom": {
    primaryTone:   "outcome-focused",
    secondaryTone: "social-proof",
    voiceGuidance: "Kết quả cụ thể: tiết kiệm X giờ/tháng, tránh phạt Y triệu. Thêm tên/ngành khách đã dùng nếu có.",
  },
  "MBI:retention:mid": {
    primaryTone:   "trusted-partner",
    voiceGuidance: "Nhắc về hành trình đã đồng hành. Nâng cấp = tự nhiên, không phải sales pitch.",
  },
};

// Company-level overrides for `avoid[]`
const COMPANY_AVOID: Record<BriefCompany, string[]> = {
  MBC: [
    "tốt nhất (không có nguồn)",
    "rẻ nhất (không so sánh được)",
    "đảm bảo uptime 100%",
    "không bao giờ lỗi",
    "jargon kỹ thuật với audience beginner",
  ],
  MBI: [
    "đảm bảo (nếu không có SLA cụ thể)",
    "giảm X% (nếu không có promo context)",
    "nhanh nhất (không chứng minh được)",
    "phức tạp hoá quy trình kế toán",
    "dùng tiếng nước ngoài với SME truyền thống",
  ],
};

// Funnel-level tone guardrails
const FUNNEL_AVOID: Record<BriefFunnelStage, string[]> = {
  top: ["urgency cao (Đăng ký ngay)", "discount heavy", "so sánh đối thủ trực tiếp"],
  mid: ["quá emotional", "thiếu thông tin cụ thể"],
  bottom: ["quá nhiều thông tin — overwhelm", "không có CTA rõ"],
};

function fallbackTone(company: BriefCompany, funnelStage: BriefFunnelStage): ToneEntry {
  const defaults: Record<BriefCompany, Record<BriefFunnelStage, ToneEntry>> = {
    MBC: {
      top:    { primaryTone: "educational",   voiceGuidance: "Giáo dục và tạo nhận thức. Tone thân thiện, không sales." },
      mid:    { primaryTone: "authoritative", voiceGuidance: "Thể hiện chuyên môn và ưu thế. So sánh cụ thể." },
      bottom: { primaryTone: "direct",        voiceGuidance: "Đi thẳng vào lợi ích và CTA. Ngắn gọn, thuyết phục." },
    },
    MBI: {
      top:    { primaryTone: "empathetic",    voiceGuidance: "Hiểu vấn đề trước, giải pháp sau." },
      mid:    { primaryTone: "reassuring",    voiceGuidance: "Giảm rủi ro, tăng tin tưởng." },
      bottom: { primaryTone: "outcome-led",   voiceGuidance: "Kết quả cụ thể + bằng chứng xã hội." },
    },
  };
  return defaults[company][funnelStage];
}

export function deriveTone(
  company: BriefCompany,
  objective: BriefObjective,
  funnelStage: BriefFunnelStage,
  overrideTone?: string,
): ToneStrategy {
  const key = `${company}:${objective}:${funnelStage}` as ToneKey;
  const entry = TONE_MATRIX[key] ?? fallbackTone(company, funnelStage);

  const avoid = [
    ...COMPANY_AVOID[company],
    ...FUNNEL_AVOID[funnelStage],
  ];

  return {
    primaryTone:    overrideTone ?? entry.primaryTone,
    secondaryTone:  entry.secondaryTone,
    voiceGuidance:  entry.voiceGuidance,
    avoid,
  };
}
