// ============================================================
// AdsCommand — Creative Brief Generator
// Generates a formatted markdown brief for export as PDF/DOCX
// ============================================================

import type { AdCreative } from "@/types/ads.types";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AudienceSegmentBrief {
  segmentName: string;
  priority: number;
  demographics: {
    age: string;
    gender: string;
    location: string[];
    income: string;
  };
  psychographics?: {
    interests: string[];
    behaviors: string[];
    jobTitles: string[];
  };
  painPoints: string[];
  buyingTriggers?: string[];
  messagingAngle?: string;
  estimatedCTR: string;
  difficulty?: string;
}

export interface CompetitorInsightsBrief {
  weaknesses: string[];
  differentiators: string[];
  avoidTopics: string[];
}

export interface BriefData {
  productName: string;
  objective: string;
  platform: string; // "Facebook" | "Google" | "Facebook + Google"
  bestTimeToRun?: {
    daysOfWeek: string[];
    timeOfDay: string;
    reasoning: string;
  };
  budgetRecommendation?: {
    minimumDaily: number;
    optimalDaily: number;
    reasoning: string;
  };
  audienceSegments?: AudienceSegmentBrief[];
  competitorInsights?: CompetitorInsightsBrief;
  creatives: AdCreative[];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function fmtDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtVND(n: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─────────────────────────────────────────────
// Main Generator
// ─────────────────────────────────────────────

export function generateAdsBrief(data: BriefData): string {
  const lines: string[] = [];

  // ── Header ──
  lines.push(`# CREATIVE BRIEF — ${data.productName}`);
  lines.push(`**Ngày tạo:** ${fmtDate()}`);
  lines.push(`**Tạo bởi:** AdsCommand AI`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 1. Campaign Info ──
  lines.push("## 1. THÔNG TIN CHIẾN DỊCH");
  lines.push("");
  lines.push(`- **Sản phẩm:** ${data.productName}`);
  lines.push(`- **Mục tiêu:** ${data.objective}`);
  lines.push(`- **Nền tảng:** ${data.platform}`);
  if (data.bestTimeToRun) {
    lines.push(
      `- **Thời gian đề xuất:** ${data.bestTimeToRun.daysOfWeek.join(", ")} | ${data.bestTimeToRun.timeOfDay}`
    );
    lines.push(`  - _${data.bestTimeToRun.reasoning}_`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 2. Audience ──
  if (data.audienceSegments && data.audienceSegments.length > 0) {
    lines.push("## 2. CHÂN DUNG KHÁCH HÀNG MỤC TIÊU");
    lines.push("");

    data.audienceSegments.forEach((seg, i) => {
      const priorityLabel = seg.priority === 1 ? " ⭐ Ưu tiên cao" : "";
      lines.push(`### Phân khúc ${i + 1}: ${seg.segmentName}${priorityLabel}`);
      lines.push("");

      // Demographics table
      lines.push("| Tiêu chí | Chi tiết |");
      lines.push("|----------|----------|");
      lines.push(`| Độ tuổi | ${seg.demographics.age} |`);
      lines.push(`| Giới tính | ${seg.demographics.gender} |`);
      lines.push(`| Địa điểm | ${seg.demographics.location.join(", ")} |`);
      lines.push(`| Thu nhập | ${seg.demographics.income} |`);
      lines.push(`| Độ khó tiếp cận | ${seg.difficulty ?? 'N/A'} |`);
      lines.push(`| CTR AI ước tính | ${seg.estimatedCTR || "—"} |`);
      lines.push("");

      // Interests
      if (seg.psychographics?.interests && seg.psychographics.interests.length > 0) {
        lines.push("**Interests để target trên Facebook:**");
        lines.push(seg.psychographics.interests.map((i) => `\`${i}\``).join("  "));
        lines.push("");
      }

      // Job titles
      if (seg.psychographics?.jobTitles && seg.psychographics.jobTitles.length > 0) {
        lines.push("**Job Titles:**");
        lines.push(seg.psychographics.jobTitles.map((j) => `\`${j}\``).join("  "));
        lines.push("");
      }

      // Pain points
      if (seg.painPoints.length > 0) {
        lines.push("**Pain Points:**");
        seg.painPoints.forEach((p, j) => lines.push(`${j + 1}. ${p}`));
        lines.push("");
      }

      // Buying triggers
      if (seg.buyingTriggers && seg.buyingTriggers.length > 0) {
        lines.push("**Buying Triggers:**");
        seg.buyingTriggers.forEach((t) => lines.push(`- ${t}`));
        lines.push("");
      }

      // Messaging angle
      if (seg.messagingAngle) {
        lines.push(`**Góc thông điệp:** _${seg.messagingAngle}_`);
        lines.push("");
      }
    });

    lines.push("---");
    lines.push("");
  }

  // ── 3. Competitor Insights ──
  if (data.competitorInsights) {
    lines.push("## 3. INSIGHT CẠNH TRANH");
    lines.push("");

    if (data.competitorInsights.weaknesses.length > 0) {
      lines.push("**Khai thác điểm yếu đối thủ:**");
      data.competitorInsights.weaknesses.forEach((w) => lines.push(`- ✅ ${w}`));
      lines.push("");
    }

    if (data.competitorInsights.differentiators.length > 0) {
      lines.push("**Điểm khác biệt cần nhấn mạnh:**");
      data.competitorInsights.differentiators.forEach((d) => lines.push(`- ✅ ${d}`));
      lines.push("");
    }

    if (data.competitorInsights.avoidTopics.length > 0) {
      lines.push("**Chủ đề nên tránh:**");
      data.competitorInsights.avoidTopics.forEach((a) => lines.push(`- ⚠️ ${a}`));
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // ── 4. Creatives ──
  if (data.creatives.length > 0) {
    lines.push("## 4. CREATIVES ĐỀ XUẤT");
    lines.push("");

    data.creatives.forEach((c, i) => {
      const isFb = c.platform === "facebook";
      const scoreStr = c.score != null ? ` (Score: ${c.score}/10)` : "";
      const formatStr = isFb ? "Facebook Feed" : "Google Search";

      lines.push(`### Creative ${i + 1}${scoreStr}`);
      lines.push(`**Format:** ${formatStr}`);
      lines.push("");

      if (isFb) {
        lines.push(`**Primary Text:**`);
        lines.push(`> ${c.primaryText}`);
        lines.push("");
        lines.push(`**Headline:** ${c.headline}`);
        lines.push("");
        lines.push(`**Description:** ${c.description}`);
        lines.push("");
        lines.push(`**CTA:** \`${c.cta}\``);
      } else {
        lines.push(`**Headline:** ${c.headline}`);
        if (c.primaryText) {
          lines.push(`**Headlines (alt):** ${c.primaryText}`);
        }
        lines.push("");
        lines.push(`**Description:**`);
        lines.push(`> ${c.description}`);
      }

      if (c.reason) {
        lines.push("");
        lines.push(`_💡 ${c.reason}_`);
      }

      lines.push("");
    });

    lines.push("---");
    lines.push("");
  }

  // ── 5. Budget & KPI ──
  if (data.budgetRecommendation) {
    lines.push("## 5. NGÂN SÁCH & KPI DỰ KIẾN");
    lines.push("");
    lines.push(
      `- **Ngân sách/ngày đề xuất:** ${fmtVND(data.budgetRecommendation.minimumDaily)} — ${fmtVND(data.budgetRecommendation.optimalDaily)}`
    );
    lines.push(`- _${data.budgetRecommendation.reasoning}_`);

    // Add estimated metrics from segments if available
    if (data.audienceSegments && data.audienceSegments.length > 0) {
      const ctrs = data.audienceSegments.map((s) => s.estimatedCTR).filter(Boolean);
      if (ctrs.length > 0) lines.push(`- **CTR AI ước tính:** ${ctrs.join(" / ")}`);
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ── Footer ──
  lines.push("*Tạo bởi AdsCommand — Powered by Gemini AI*");

  return lines.join("\n");
}

// ─────────────────────────────────────────────
// Export as downloadable text file (client-side)
// ─────────────────────────────────────────────

export function downloadBriefAsMarkdown(data: BriefData): void {
  const md = generateAdsBrief(data);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `AdsCommand-Brief-${data.productName.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// Build mailto link with brief content
// ─────────────────────────────────────────────

export function buildEmailLink(data: BriefData, toEmail?: string): string {
  const brief = generateAdsBrief(data);
  const subject = encodeURIComponent(`[AdsCommand] Creative Brief — ${data.productName}`);
  const body = encodeURIComponent(brief);
  const to = toEmail ? encodeURIComponent(toEmail) : "";
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
