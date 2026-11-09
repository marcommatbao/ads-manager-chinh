// ============================================================
// AdsCommand — Campaign Health & Learning Phase Detector
// Detects whether a campaign is in learning phase and provides
// badges, tooltips, and automation guard decisions.
// ------------------------------------------------------------
// LỊCH SỬ — ghi 24/09/2026, thay cho cảnh báo cũ ngày 16/09.
//
// File này TỪNG chứa một bản "campaign health" thứ hai chạy song song với
// `getCampaignHealthBadge()` trong components/CampaignTable.tsx, và ngưỡng hai
// bên ĐÃ LỆCH: CPC cảnh báo 35.000đ ở đây ↔ 20.000đ bên kia; CTR thấp cần
// >1.000 hiển thị ở đây ↔ >5.000 bên kia. Cả bản đó lẫn ba export không ai gọi
// (`getHealthScore`, `getCampaignHealth`, `shouldBlockAction`,
// `BLOCKED_ACTIONS_IN_LEARNING`) đã được GỠ ngày 24/09 — ngưỡng lệch nằm ngay
// bên trong `getHealthScore` nên gỡ hàm chết là ngưỡng lệch đi theo.
//
// Ngưỡng dùng chung nay nằm ở `lib/campaign-benchmarks.ts`, và cả
// CampaignTable lẫn tấm "Phân tích hiệu quả" ở trang chi tiết đều import từ
// đó. Thêm ngưỡng mới thì thêm VÀO ĐÓ, đừng gõ số thẳng vào file này.
//
// BÀI HỌC ĐÁNG GIỮ: chú thích cũ khẳng định `getCampaignHealth` "đang dùng ở
// 9 nơi". Grep lại đúng lúc gỡ thì ra **0 nơi** — chỗ gọi đã biến mất trong
// khoảng giữa hai lần đo mà không ai cập nhật chú thích. Chú thích đếm số chỗ
// dùng sẽ mục theo thời gian; luôn grep lại ngay trước khi dựa vào nó.
//
// Còn đúng MỘT export sống: `getLearningStatus` (17 nơi). Đụng vào nó là đụng
// hành vi thật.
// ============================================================

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type LearningPhase =
  | "new"              // < 3 days
  | "learning"         // < 7 days OR < 50 conversions
  | "learning_limited" // >= 7 days but < 50 conversions
  | "active";          // mature campaign

export interface LearningStatus {
  phase: LearningPhase;
  ageDays: number;
  conversions: number;
  badge: string | null;        // e.g. "🆕 Mới (1d)"
  badgeColor: "blue" | "yellow" | "green" | "gray";
  blockAutomation: boolean;    // true = skip destructive rules
  reason: string | null;       // human-readable explanation
  retryDate: string | null;    // ISO date when learning ends
  tooltip: string | null;      // full tooltip text
}

// ─────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────

function daysSince(dateStr: string | undefined | null): number {
  if (!dateStr) return 999; // unknown = treat as mature
  const created = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - created) / 86400000);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ─────────────────────────────────────────────
// Learning Phase Detector
// ─────────────────────────────────────────────

interface CampaignLike {
  created_time?: string;
  start_time?: string;
  startDate?: string;
  metrics?: {
    conversions?: number;
    spend?: number;
    impressions?: number;
    ctr?: number;
    cpc?: number;
    roas?: number;
    frequency?: number;
  };
}

export function getLearningStatus(campaign: CampaignLike): LearningStatus {
  const createdTime = campaign.created_time || campaign.start_time || campaign.startDate;
  const ageDays = daysSince(createdTime);
  const conversions = campaign.metrics?.conversions ?? 0;

  // Phase 1: Brand new (< 3 days)
  if (ageDays < 3) {
    const retryDate = createdTime
      ? addDays(new Date(createdTime), 3).toISOString()
      : null;

    return {
      phase: "new",
      ageDays,
      conversions,
      badge: `🆕 Mới (${ageDays}d)`,
      badgeColor: "blue",
      blockAutomation: true,
      reason: "Campaign quá mới, chưa đủ data",
      retryDate,
      tooltip: [
        "🆕 Campaign mới",
        `Campaign ${ageDays} ngày tuổi.`,
        `Automation rules sẽ không tự pause campaign này cho đến khi đủ 3 ngày.`,
        `Cần thêm ${Math.max(0, 50 - conversions)} conversions để ổn định.`,
      ].join("\n"),
    };
  }

  // Phase 2: Learning (< 7 days OR < 50 conversions)
  if (ageDays < 7 || conversions < 50) {
    if (ageDays < 7) {
      const retryDate = createdTime
        ? addDays(new Date(createdTime), 7).toISOString()
        : null;

      return {
        phase: "learning",
        ageDays,
        conversions,
        badge: `🎓 Đang học (${ageDays}d)`,
        badgeColor: "blue",
        blockAutomation: true,
        reason: `${ageDays} ngày tuổi, cần thêm ${Math.max(0, 50 - conversions)} conversions`,
        retryDate,
        tooltip: [
          "🎓 Đang học",
          `Campaign ${ageDays} ngày tuổi.`,
          `Automation rules sẽ không tự pause campaign này`,
          `cho đến khi đủ 7 ngày.`,
          `Hiện có ${conversions}/50 conversions.`,
        ].join("\n"),
      };
    }

    // Phase 3: Learning Limited (>= 7 days but < 50 conversions)
    return {
      phase: "learning_limited",
      ageDays,
      conversions,
      badge: "⚡ Học hạn chế",
      badgeColor: "yellow",
      blockAutomation: false, // allow automation but warn
      reason: "Ít conversions — audience có thể quá hẹp",
      retryDate: null,
      tooltip: [
        "⚡ Học hạn chế",
        `Campaign ${ageDays} ngày tuổi nhưng chỉ có ${conversions} conversions.`,
        `Audience có thể quá hẹp hoặc budget quá thấp.`,
        `Automation được phép chạy nhưng nên theo dõi sát.`,
      ].join("\n"),
    };
  }

  // Phase 4: Active / Mature
  return {
    phase: "active",
    ageDays,
    conversions,
    badge: null,
    badgeColor: "green",
    blockAutomation: false,
    reason: null,
    retryDate: null,
    tooltip: null,
  };
}
