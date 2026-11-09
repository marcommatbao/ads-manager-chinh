// ============================================================
// Creative Brief — Audience Resolver
// Merges AudienceSegment[] → AudienceSummary.
// Applies MBC/MBI customer model differences.
// ============================================================

import type { AudienceSegment } from "@/app/(dashboard)/creative/_types";
import type { AudienceSummary, BriefCompany } from "./types";

// Signals for sophistication levels (from job titles / segment names)
const EXPERT_SIGNALS   = /IT manager|developer|CTO|kỹ thuật|sysadmin|devops|system/i;
const BEGINNER_SIGNALS = /chủ shop|bán hàng|tiểu thương|mới|cá nhân|freelancer/i;

function mergePainPoints(segments: AudienceSegment[]): string[] {
  const freq = new Map<string, number>();
  for (const seg of segments) {
    for (const p of seg.painPoints ?? []) {
      freq.set(p, (freq.get(p) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text]) => text);
}

function detectSophistication(
  segments: AudienceSegment[],
): "beginner" | "intermediate" | "expert" {
  const allTitles = segments.flatMap(s => [
    ...(s.demographics?.jobTitles ?? []),
    ...(s.psychographics?.jobTitles ?? []),
    s.segmentName ?? "",
  ]).join(" ");

  if (EXPERT_SIGNALS.test(allTitles)) return "expert";
  if (BEGINNER_SIGNALS.test(allTitles)) return "beginner";
  return "intermediate";
}

function detectSize(segments: AudienceSegment[]): "broad" | "narrow" | "niche" {
  if (segments.length === 1) return "niche";
  const broadKeyword = /rộng|broad|toàn quốc|all/i;
  const hasBroad = segments.some(s => broadKeyword.test(s.estimatedAudienceSize ?? s.segmentName ?? ""));
  return hasBroad ? "broad" : "narrow";
}

function deriveMotivators(
  company: BriefCompany,
  segments: AudienceSegment[],
): string[] {
  // Motivators from buying triggers
  const triggers = segments.flatMap(s => s.buyingTriggers ?? []);
  if (triggers.length > 0) return [...new Set(triggers)].slice(0, 3);

  // Fallback by company
  if (company === "MBC") {
    return [
      "Xây dựng thương hiệu số chuyên nghiệp",
      "Tiết kiệm chi phí vận hành",
      "Tăng tốc độ ra thị trường",
    ];
  }
  return [
    "Tuân thủ pháp lý, tránh phạt",
    "Giảm chi phí giấy tờ",
    "Vận hành trơn tru, không bị gián đoạn",
  ];
}

function primaryPersonaLabel(
  company: BriefCompany,
  segments: AudienceSegment[],
  customNote?: string,
): string {
  if (customNote) return customNote;
  // Use highest-priority segment name
  const top = segments.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
  if (top?.segmentName) return top.segmentName;
  return company === "MBC" ? "Chủ doanh nghiệp SME" : "Kế toán / Chủ doanh nghiệp vừa nhỏ";
}

export function resolveAudience(
  company: BriefCompany,
  segments: AudienceSegment[],
  customNote?: string,
): AudienceSummary {
  if (segments.length === 0 && !customNote) {
    return {
      primaryPersona: company === "MBC" ? "Chủ doanh nghiệp SME" : "Kế toán / Giám đốc SME",
      size: "broad",
      topPainPoints: [],
      motivators: deriveMotivators(company, []),
      sophistication: "intermediate",
    };
  }

  return {
    primaryPersona:  primaryPersonaLabel(company, segments, customNote),
    size:            detectSize(segments),
    topPainPoints:   mergePainPoints(segments),
    motivators:      deriveMotivators(company, segments),
    sophistication:  detectSophistication(segments),
  };
}
