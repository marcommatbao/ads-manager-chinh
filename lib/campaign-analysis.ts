// ============================================================
// Chấm hiệu quả một chiến dịch — 5 trụ, THUẦN TÍNH TOÁN
// ============================================================
// File này KHÔNG gọi API, KHÔNG đọc file, KHÔNG gọi AI. Vào là số, ra là kết
// luận. Mọi thứ ở đây kiểm chứng được bằng tay từ chính các con số hiện trên
// trang chi tiết chiến dịch.
//
// VÌ SAO TÁCH RA KHỎI PHẦN GỌI AI:
// Lớp AI (app/api/campaigns/[id]/analysis) chỉ được phép DIỄN GIẢI kết quả
// của file này thành câu tiếng Việt. Nó không được tự chấm điểm, không được
// tự nghĩ ra con số. Ai muốn kiểm "AI nói vậy có đúng không" thì đọc thẳng
// `pillars[].evidence` — đó là số thật, không qua tay mô hình.
//
// HAI LUẬT KHÔNG ĐƯỢC PHÁ:
//
// 1. THIẾU THƯỚC ĐO thì trả `unknown`, TUYỆT ĐỐI không đoán một ngưỡng.
//    Ví dụ: chiến dịch thu lead mà biến CPL_TARGETS_JSON chưa cấu hình →
//    trụ "mục tiêu" là `unknown` kèm lời giải thích, chứ không phải "đạt".
//    Một lời khen dựa trên ngưỡng bịa còn tệ hơn không chấm.
//
// 2. ĐANG HỌC thì KHÔNG được kết luận "kém". Chiến dịch chưa đủ 3 ngày hoặc
//    chưa đủ 50 chuyển đổi thì số liệu chưa có nghĩa — đây là chốt chặn để hệ
//    thống không bao giờ khuyên tắt một chiến dịch chưa kịp chạy. Xem `gated`.
// ============================================================

import { getLearningStatus, type LearningStatus, type LearningPhase } from "./campaign-health";
import { getCPLTarget, detectProductGroup } from "./cpl-targets";
import {
  CTR_BENCHMARK_PCT, CTR_LOW_PCT, CTR_GOOD_PCT, CTR_EXCELLENT_PCT, CTR_MIN_IMPRESSIONS,
  CPC_HIGH_VND, FREQUENCY_WARN, FREQUENCY_CRITICAL,
  ROAS_BREAKEVEN, ROAS_LOSING, ROAS_MIN_SPEND_VND,
  CVR_MIN_CLICKS, NO_DELIVERY_MIN_AGE_DAYS, BUDGET_MIN_VND, BUDGET_CUT_RATIO,
  TREND_MIN_DAYS, TREND_SIGNIFICANT_PCT, ADSET_WASTE_SHARE,
} from "./campaign-benchmarks";
import { MIN_CONV_FOR_CPL } from "./data-sufficiency";

// ─────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────

export type AnalysisPlatform = "facebook" | "google";
export type PillarStatus = "good" | "warn" | "bad" | "unknown";
export type PillarKey = "goal" | "learning" | "funnel" | "trend" | "structure";
export type Severity = "critical" | "warning" | "info";

/** Mục tiêu thật của chiến dịch — quyết định DÙNG THƯỚC NÀO để chấm. */
export type GoalKind = "sales" | "leads" | "traffic" | "awareness" | "unknown";

export interface AnalysisMetrics {
  impressions: number; clicks: number; spend: number;
  ctr: number; cpc: number; cpm: number;
  reach: number; frequency: number;
  conversions: number; leads: number;
  revenue?: number;
  roas?: number | null;
}

export interface AnalysisAdset {
  id: string; name: string; status: string;
  spend: number; impressions: number; clicks: number;
  ctr: number; cpc: number; conversions: number; leads: number;
  revenue?: number; roas?: number | null;
}

export interface AnalysisDaily {
  date: string; spend: number; impressions: number;
  clicks: number; ctr: number; leads: number;
  conversions?: number; revenue?: number;
}

export interface AnalysisCampaign {
  id: string; name: string; status: string; objective: string;
  dailyBudget: number; lifetimeBudget: number;
  startTime?: string; stopTime?: string | null; createdTime?: string;
}

export interface AnalysisInput {
  platform: AnalysisPlatform;
  company: string | null;
  campaign: AnalysisCampaign;
  metrics: AnalysisMetrics;
  adsets: AnalysisAdset[];
  daily: AnalysisDaily[];
  period: { from: string; to: string };
  /** Đợt 23 (3b): CPL mục tiêu / trần từ Xử lý chiến dịch → Mục tiêu (lib/targets/resolve.ts). Thiếu → ngưỡng cũ
   *  CPL_TARGETS_JSON (vượt 1,5 lần là kém) — module này thuần, route truyền vào. */
  leadTarget?: { target: number; ceiling: number; source: string } | null;
}

export interface Pillar {
  key: PillarKey;
  label: string;
  status: PillarStatus;
  /** Kết luận một dòng. */
  headline: string;
  /** "Dựa trên gì" — nói thẳng thước đo đang dùng, kể cả khi thước bị thiếu. */
  basis: string;
  /** Số liệu chứng minh. Người đọc phải tự kiểm được bằng mắt. */
  evidence: string[];
}

/** Hành động ÁP ĐƯỢC NGAY — chỉ dành cho việc đã có đường ghi thật, có kiểm quyền. */
export type ApplyAction =
  | { kind: "PAUSE_CAMPAIGN" }
  | { kind: "SET_DAILY_BUDGET"; currentDailyBudget: number; newDailyBudget: number };

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** Vấn đề là gì, đo bằng số nào. */
  detail: string;
  /** Nên làm gì. Câu này phải cụ thể tới mức bấm được. */
  recommendation: string;
  /**
   * Có nút "Áp ngay" hay không.
   * `null` = KHÔNG áp được từ đây, và `manualHint` nói rõ phải làm ở đâu.
   * Cố tình không bịa ra nút cho việc hệ thống chưa ghi được — một cái nút
   * bấm vào không đổi gì còn tệ hơn không có nút.
   */
  apply: ApplyAction | null;
  manualHint?: string;
}

export interface CampaignAnalysis {
  goalKind: GoalKind;
  /** 0-100, hoặc null khi không đủ thước đo để chấm. */
  score: number | null;
  /** Đang trong giai đoạn học → mọi kết luận tiêu cực bị hạ xuống "cần theo dõi". */
  gated: boolean;
  gateReason: string | null;
  verdict: string;
  pillars: Pillar[];
  findings: Finding[];
  /** Cảnh báo về chính CHẤT LƯỢNG DỮ LIỆU, tách khỏi kết luận về chiến dịch. */
  dataWarnings: string[];
  /**
   * Tóm tắt giai đoạn học — CHỈ những trường đếm được.
   *
   * Cố ý KHÔNG trả nguyên `LearningStatus` của campaign-health.ts: hai trường
   * `reason` và `tooltip` của nó chứa câu phỏng đoán gõ sẵn
   * ("Ít conversions — audience có thể quá hẹp"). Ngày 23/09 câu đó đã lọt qua
   * đây vào phần số liệu rồi lên màn hình, mâu thuẫn với chính trụ "Nghẽn ở
   * đâu" đo được là tệp KHÔNG hẹp. Cắt tại nguồn để người nối dây sau không
   * vô tình bày lại nó ra.
   */
  learning: { phase: LearningPhase; ageDays: number; conversions: number; blockAutomation: boolean } | null;
}

// ─────────────────────────────────────────────
// Tiện ích
// ─────────────────────────────────────────────

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`;
const pct = (n: number) => `${n.toFixed(2)}%`;
const num = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Chia an toàn: mẫu số 0 trả null (KHÔNG phải 0 — hai thứ khác nhau). */
function div(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from), b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// ─────────────────────────────────────────────
// Nhận diện mục tiêu → chọn thước đo
// ─────────────────────────────────────────────

/**
 * Meta trả về enum mục tiêu rõ ràng. Google trả `advertising_channel_type`
 * (SEARCH/PERFORMANCE_MAX/DISPLAY…) — thứ đó nói về KÊNH, không nói về mục
 * tiêu, nên không suy ra được "bán hàng" hay "thu lead".
 *
 * Với Google ta suy từ DỮ LIỆU: có giá trị chuyển đổi (conversions_value) thì
 * chiến dịch này đang được theo dõi theo doanh thu → chấm bằng ROAS; không có
 * thì chấm bằng chi phí trên mỗi chuyển đổi.
 */
export function detectGoalKind(platform: AnalysisPlatform, objective: string, metrics: AnalysisMetrics): GoalKind {
  const o = (objective ?? "").toUpperCase();

  if (platform === "google") {
    if ((metrics.revenue ?? 0) > 0) return "sales";
    if (metrics.conversions > 0) return "leads";
    return "traffic";
  }

  if (o.includes("SALES") || o.includes("CONVERSION") || o.includes("PURCHASE")) return "sales";
  if (o.includes("LEAD")) return "leads";
  if (o.includes("TRAFFIC") || o.includes("LINK_CLICK")) return "traffic";
  if (o.includes("AWARENESS") || o.includes("REACH") || o.includes("ENGAGEMENT") || o.includes("VIDEO_VIEW")) return "awareness";
  return "unknown";
}

const GOAL_LABEL: Record<GoalKind, string> = {
  sales: "Doanh số",
  leads: "Khách hàng tiềm năng",
  traffic: "Lưu lượng truy cập",
  awareness: "Nhận biết thương hiệu",
  unknown: "Không xác định",
};

// ─────────────────────────────────────────────
// Trụ 1 — Mục tiêu ↔ kết quả
// ─────────────────────────────────────────────

function pillarGoal(input: AnalysisInput, goalKind: GoalKind, warnings: string[], findings: Finding[]): Pillar {
  const m = input.metrics;
  const evidence: string[] = [
    `Mục tiêu: ${GOAL_LABEL[goalKind]}${input.campaign.objective ? ` (${input.campaign.objective})` : ""}`,
    `Chi phí: ${vnd(m.spend)}`,
  ];

  if (goalKind === "sales") {
    const revenue = m.revenue ?? 0;
    const roas = div(revenue, m.spend);

    // Bẫy thường gặp nhất: có đơn nhưng Pixel/tag không gửi GIÁ TRỊ đơn hàng.
    // Nhìn qua thì tưởng chiến dịch không ra doanh thu, thật ra là mất đo đạc.
    // Phải tách bạch, nếu không AI sẽ khuyên tắt một chiến dịch đang có lãi.
    if (m.conversions > 0 && revenue === 0) {
      warnings.push(
        `Có ${num(m.conversions)} chuyển đổi nhưng doanh thu ghi nhận bằng 0 — ` +
        `${input.platform === "facebook" ? "Pixel" : "thẻ chuyển đổi Google"} nhiều khả năng không gửi giá trị đơn hàng về. ` +
        `Chưa sửa chỗ này thì KHÔNG chấm được hiệu quả theo doanh số.`
      );
      findings.push({
        id: "tracking-no-value",
        severity: "critical",
        title: "Không đo được doanh thu dù đã có đơn",
        detail: `${num(m.conversions)} chuyển đổi, doanh thu ghi nhận ${vnd(0)}. ROAS vì vậy không tính được.`,
        recommendation:
          input.platform === "facebook"
            ? "Kiểm tra sự kiện Purchase của Pixel có gửi kèm tham số `value` và `currency` không."
            : "Kiểm tra thẻ chuyển đổi Google Ads có bật 'Sử dụng giá trị chuyển đổi' không.",
        apply: null,
        manualHint: input.platform === "facebook"
          ? "Meta Events Manager → Pixel → Test Events"
          : "Google Ads → Mục tiêu → Chuyển đổi → Chỉnh sửa hành động",
      });
      evidence.push(`Chuyển đổi: ${num(m.conversions)}`, "Doanh thu: không đo được");
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "unknown",
        // Không mở đầu bằng "Chưa chấm được" — chip trạng thái ngay cạnh đã
        // nói điều đó, và câu kết luận tổng cũng chèn lại chuỗi này nên sẽ
        // thành "Chưa chấm được điểm tổng: chưa chấm được — ...".
        headline: "chiến dịch bán hàng nhưng hệ thống không nhận được giá trị đơn hàng",
        basis: "Thước đo cho mục tiêu Doanh số là ROAS = doanh thu ÷ chi phí. Thiếu doanh thu thì không có thước.",
        evidence,
      };
    }

    evidence.push(`Doanh thu: ${vnd(revenue)}`, `Chuyển đổi: ${num(m.conversions)}`);
    if (roas === null) {
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "unknown",
        headline: "Chưa tiêu đồng nào trong kỳ — chưa có gì để chấm",
        basis: "ROAS = doanh thu ÷ chi phí; chi phí bằng 0 thì phép chia không có nghĩa.",
        evidence,
      };
    }

    evidence.push(`ROAS: ${roas.toFixed(2)}x`);
    const cpa = div(m.spend, m.conversions);
    if (cpa !== null) evidence.push(`Chi phí mỗi đơn: ${vnd(cpa)}`);

    if (roas < ROAS_LOSING && m.spend > ROAS_MIN_SPEND_VND) {
      findings.push({
        id: "roas-losing",
        severity: "critical",
        title: `Đang lỗ — ROAS ${roas.toFixed(2)}x`,
        detail: `Tiêu ${vnd(m.spend)} thu về ${vnd(revenue)}. Mỗi đồng bỏ ra chỉ thu lại ${roas.toFixed(2)} đồng.`,
        recommendation: input.campaign.status === "ACTIVE"
          ? "Tạm dừng chiến dịch, rà lại đối tượng và nội dung quảng cáo trước khi chạy tiếp."
          : "Chiến dịch đã dừng sẵn. Rà lại đối tượng và nội dung quảng cáo trước khi bật chạy lại.",
        // CHỈ dựng nút khi chiến dịch đang THẬT SỰ chạy.
        //
        // Không có điều kiện này thì một chiến dịch đã PAUSED mà lỗ vẫn hiện
        // nút "Tạm dừng". Bấm vào, Meta nhận PAUSED → PAUSED và trả `success`,
        // panel in "✅ Đã áp dụng" — người dùng tin là vừa xử lý xong rồi bỏ
        // đi, trong khi không có gì thay đổi. Một cái nút báo thành công mà
        // không làm gì còn tệ hơn hẳn không có nút.
        apply: input.campaign.status === "ACTIVE" ? { kind: "PAUSE_CAMPAIGN" } : null,
        manualHint: input.campaign.status === "ACTIVE"
          ? undefined
          : `Chiến dịch đang ở trạng thái ${input.campaign.status} — không còn gì để tạm dừng.`,
      });
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "bad",
        headline: `Đang lỗ: thu về ${vnd(revenue)} trên ${vnd(m.spend)} đã tiêu`,
        basis: `ROAS dưới ${ROAS_LOSING}x (và đã tiêu quá ${vnd(ROAS_MIN_SPEND_VND)}) được xếp là đang lỗ.`,
        evidence,
      };
    }
    if (roas < ROAS_BREAKEVEN) {
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "warn",
        headline: `Chưa hoà vốn — ROAS ${roas.toFixed(2)}x`,
        basis: `ROAS 1,0x là điểm hoà vốn theo định nghĩa: thu về đúng bằng số đã tiêu.`,
        evidence,
      };
    }
    return {
      key: "goal", label: "Mục tiêu ↔ Kết quả", status: "good",
      headline: `Có lãi — mỗi đồng chi thu về ${roas.toFixed(2)} đồng`,
      basis: "ROAS từ 1,0x trở lên là đã vượt điểm hoà vốn.",
      evidence,
    };
  }

  if (goalKind === "leads") {
    const leadCount = input.platform === "google" ? m.conversions : m.leads;
    const cpl = div(m.spend, leadCount);
    const own = input.leadTarget && input.leadTarget.target > 0 && input.leadTarget.ceiling > 0 ? input.leadTarget : null;
    const target = own ? own.target : getCPLTarget(input.campaign.name);
    const group = detectProductGroup(input.campaign.name);

    evidence.push(`Số lead: ${num(leadCount)}`);
    if (cpl !== null) evidence.push(`Chi phí mỗi lead: ${vnd(cpl)}`);

    if (leadCount === 0) {
      if (m.spend > 0) {
        findings.push({
          id: "leads-zero",
          severity: "critical",
          title: "Đã tiêu tiền nhưng chưa có lead nào",
          detail: `Tiêu ${vnd(m.spend)}, ${num(m.clicks)} click, 0 lead.`,
          recommendation: m.clicks >= CVR_MIN_CLICKS
            ? "Có click mà không ra lead — nghi ngờ trang đích hoặc biểu mẫu, không phải quảng cáo. Kiểm tra trang đích trước."
            : "Chưa đủ click để kết luận. Theo dõi thêm hoặc kiểm tra lại việc đo chuyển đổi.",
          apply: null,
          manualHint: "Mở trang đích, tự điền thử biểu mẫu một lần để chắc chắn lead có về.",
        });
      }
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: m.spend > 0 ? "bad" : "unknown",
        headline: m.spend > 0 ? `Tiêu ${vnd(m.spend)} nhưng chưa có lead nào` : "Chưa có dữ liệu",
        basis: "Thước đo cho mục tiêu Khách hàng tiềm năng là số lead và chi phí mỗi lead.",
        evidence,
      };
    }

    // Thiếu ngưỡng thì nói thẳng là thiếu, không tự chọn một con số.
    if (target <= 0) {
      warnings.push(
        `Chưa cấu hình ngưỡng CPL cho nhóm "${group}" (biến môi trường CPL_TARGETS_JSON) — ` +
        `nên chỉ báo được CPL thực tế, không nói được là đắt hay rẻ.`
      );
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "unknown",
        headline: `Chi phí mỗi lead ${vnd(cpl!)} — chưa có ngưỡng để đối chiếu`,
        basis: `Ngưỡng CPL theo nhóm sản phẩm đọc từ biến CPL_TARGETS_JSON; nhóm "${group}" hiện chưa có giá trị.`,
        evidence,
      };
    }

    evidence.push(own ? `Mục tiêu CPL (Xử lý chiến dịch → Mục tiêu): ${vnd(own.target)}, trần ${vnd(own.ceiling)}` : `Ngưỡng CPL nhóm ${group}: ${vnd(target)}`);
    // Đợt 23: 1–2 lead chưa đủ để nói CPL đắt hay rẻ (một lead may / rủi làm CPL nhảy gấp đôi).
    if (leadCount < MIN_CONV_FOR_CPL) {
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "unknown",
        headline: `Mới có ${num(leadCount)} lead — chưa đủ để kết luận chi phí mỗi lead đắt hay rẻ`,
        basis: `Cần từ ${MIN_CONV_FOR_CPL} lead trở lên mới so với ngưỡng ${vnd(target)} của nhóm ${group}.`,
        evidence,
      };
    }
    const ratio = cpl! / target;
    // Có mục tiêu ở Xử lý chiến dịch: vượt TRẦN là kém, vượt mục tiêu là hơi đắt. Không có: như cũ (vượt 1,5 lần ngưỡng là kém).
    const overCeiling = own ? cpl! > own.ceiling : ratio > 1.5;
    if (overCeiling) {
      findings.push({
        id: "cpl-over",
        severity: "critical",
        title: `Chi phí mỗi lead vượt ngưỡng ${Math.round((ratio - 1) * 100)}%`,
        detail: `CPL thực tế ${vnd(cpl!)} so với ngưỡng ${vnd(target)} của nhóm ${group}.`,
        recommendation: "Giảm ngân sách ngày để hạn chế thiệt hại, đồng thời rà lại đối tượng và nội dung.",
        // Nút chỉ dựng khi mức mới THẬT SỰ thấp hơn mức đang chạy.
        //
        // `Math.max(10_000, …)` là để không gửi đi một con số mà cả hai route
        // ngân sách đều từ chối (tối thiểu ₫10.000/ngày). Nhưng chiến dịch nào
        // đang đặt đúng ₫10.000 thì phép cắt 30% bị kẹp ngược về ₫10.000 — nút
        // hiện ra với nhãn "giảm xuống ₫10.000" trong khi nó đã là ₫10.000 rồi.
        // Bấm vào không đổi gì mà vẫn báo thành công.
        apply: (() => {
          const current = input.campaign.dailyBudget;
          if (current <= 0) return null;
          const next = Math.max(BUDGET_MIN_VND, Math.round(current * BUDGET_CUT_RATIO));
          if (next >= current) return null;
          return { kind: "SET_DAILY_BUDGET" as const, currentDailyBudget: current, newDailyBudget: next };
        })(),
        manualHint: input.campaign.dailyBudget <= 0
          ? "Chiến dịch dùng ngân sách trọn đời hoặc ngân sách đặt ở cấp nhóm quảng cáo — sửa trực tiếp trên trình quản lý."
          : input.campaign.dailyBudget <= BUDGET_MIN_VND
          ? `Ngân sách đang ở mức tối thiểu ${vnd(BUDGET_MIN_VND)}/ngày, không cắt thêm được. Cân nhắc tạm dừng thay vì giảm.`
          : undefined,
      });
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "bad",
        headline: `Lead quá đắt: ${vnd(cpl!)} so với ngưỡng ${vnd(target)}`,
        basis: own ? `So CPL thực tế với mục tiêu ở Xử lý chiến dịch → Mục tiêu. Vượt trần ${vnd(own.ceiling)} là kém.` : `So CPL thực tế với ngưỡng nhóm sản phẩm "${group}". Vượt quá 1,5 lần là kém.`,
        evidence,
      };
    }
    if (ratio > 1) {
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "warn",
        headline: `Lead hơi đắt: ${vnd(cpl!)} so với ngưỡng ${vnd(target)}`,
        basis: `So CPL thực tế với ngưỡng nhóm sản phẩm "${group}".`,
        evidence,
      };
    }
    return {
      key: "goal", label: "Mục tiêu ↔ Kết quả", status: "good",
      headline: `Lead trong ngưỡng: ${vnd(cpl!)} (ngưỡng ${vnd(target)})`,
      basis: `So CPL thực tế với ngưỡng nhóm sản phẩm "${group}".`,
      evidence,
    };
  }

  if (goalKind === "traffic") {
    evidence.push(`Click: ${num(m.clicks)}`, `Chi phí mỗi click: ${vnd(m.cpc)}`);
    if (m.clicks === 0) {
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: m.spend > 0 ? "bad" : "unknown",
        headline: m.spend > 0 ? "Đã tiêu tiền nhưng chưa có click nào" : "Chưa có dữ liệu",
        basis: "Thước đo cho mục tiêu Lưu lượng là số click và chi phí mỗi click.",
        evidence,
      };
    }
    if (m.cpc > CPC_HIGH_VND) {
      return {
        key: "goal", label: "Mục tiêu ↔ Kết quả", status: "warn",
        headline: `Click đắt: ${vnd(m.cpc)} mỗi click`,
        basis: `Mốc tham chiếu nội bộ: trên ${vnd(CPC_HIGH_VND)} một click là đắt.`,
        evidence,
      };
    }
    return {
      key: "goal", label: "Mục tiêu ↔ Kết quả", status: "good",
      headline: `Đưa được ${num(m.clicks)} lượt truy cập với ${vnd(m.cpc)}/click`,
      basis: `Mốc tham chiếu nội bộ: trên ${vnd(CPC_HIGH_VND)} một click là đắt.`,
      evidence,
    };
  }

  if (goalKind === "awareness") {
    evidence.push(`Lượt hiển thị: ${num(m.impressions)}`, `Chi phí mỗi 1.000 hiển thị: ${vnd(m.cpm)}`);
    if (m.reach > 0) evidence.push(`Số người tiếp cận: ${num(m.reach)}`);
    warnings.push("Chưa có ngưỡng CPM nội bộ để đối chiếu — phần mục tiêu chỉ báo số, không xếp loại.");
    return {
      key: "goal", label: "Mục tiêu ↔ Kết quả", status: "unknown",
      headline: `Tiếp cận ${num(m.reach || m.impressions)} lượt với CPM ${vnd(m.cpm)}`,
      basis: "Mục tiêu nhận biết đo bằng CPM và độ phủ. Hệ thống chưa có ngưỡng CPM để nói đắt hay rẻ.",
      evidence,
    };
  }

  return {
    key: "goal", label: "Mục tiêu ↔ Kết quả", status: "unknown",
    headline: "Không đọc được mục tiêu của chiến dịch nên chưa chọn được thước đo",
    basis: `Giá trị mục tiêu nhận được: "${input.campaign.objective || "(trống)"}".`,
    evidence,
  };
}

// ─────────────────────────────────────────────
// Trụ 2 — Giai đoạn học
// ─────────────────────────────────────────────

function pillarLearning(input: AnalysisInput): { pillar: Pillar; learning: LearningStatus | null } {
  // Google không trả về ngày tạo/ngày bắt đầu (route trả chuỗi rỗng), nên
  // không suy được tuổi chiến dịch. Bảng Chiến dịch cũng bỏ qua phần này với
  // Google — giữ nguyên cách đó thay vì đoán tuổi từ dữ liệu.
  if (input.platform === "google") {
    return {
      learning: null,
      pillar: {
        key: "learning", label: "Giai đoạn học", status: "unknown",
        headline: "Không áp dụng cho Google Ads ở màn hình này",
        basis: "Google Ads không trả về ngày tạo chiến dịch qua đường dữ liệu đang dùng, nên không tính được tuổi chiến dịch.",
        evidence: [],
      },
    };
  }

  const learning = getLearningStatus({
    created_time: input.campaign.createdTime,
    start_time: input.campaign.startTime,
    metrics: { conversions: input.metrics.conversions, spend: input.metrics.spend },
  });

  const evidence = [
    `Tuổi chiến dịch: ${learning.ageDays} ngày`,
    `Chuyển đổi tích luỹ: ${num(learning.conversions)}`,
  ];

  if (learning.phase === "active") {
    return {
      learning,
      pillar: {
        key: "learning", label: "Giai đoạn học", status: "good",
        headline: "Đã qua giai đoạn học — số liệu đủ tin để ra quyết định",
        basis: "Meta coi một chiến dịch là ổn định khi đã chạy từ 7 ngày và có từ 50 chuyển đổi trở lên.",
        evidence,
      },
    };
  }

  // KHÔNG đổ `learning.reason` vào phần số liệu.
  //
  // Với pha `learning_limited`, campaign-health.ts trả sẵn chuỗi
  // "Ít conversions — audience có thể quá hẹp". Đó là một GIẢ THUYẾT, không
  // phải thứ đo được — và nó nằm lẫn trong danh sách số liệu nên lớp AI đọc
  // vào rồi nhắc lại y nguyên thành "tệp đối tượng có thể đang quá hẹp".
  //
  // Đo thật trên một chiến dịch live ngày 23/09: tần suất 2,6 lần (dưới ngưỡng
  // bão hoà 3,5) và CTR 4,58% (trên mốc tham chiếu 2%) — tức số liệu nói tệp
  // KHÔNG hẹp. Câu phỏng đoán kia hiện ngay cạnh trụ "Nghẽn ở đâu" đang xếp
  // loại Tốt, thành ra hai ô trên cùng màn hình nói ngược nhau.
  //
  // Chỉ đưa vào đây thứ đếm được. Muốn nói nguyên nhân thì phải có phép đo
  // riêng cho nguyên nhân đó.
  const shortfall = Math.max(0, 50 - learning.conversions);
  if (shortfall > 0) {
    evidence.push(`Còn thiếu ${num(shortfall)} chuyển đổi nữa để đạt mốc ổn định 50`);
  }

  // `blockAutomation` phân biệt hai mức rất khác nhau và headline phải theo:
  // pha "new"/"learning" là CHƯA ĐỦ DỮ LIỆU để kết luận, còn "learning_limited"
  // (đã đủ 7 ngày, chỉ thiếu chuyển đổi) thì campaign-health cho phép
  // automation chạy — nói "chưa nên kết luận vội" ở mức đó là mạnh quá.
  const tooEarly = learning.blockAutomation;
  return {
    learning,
    pillar: {
      key: "learning", label: "Giai đoạn học", status: "warn",
      headline: tooEarly
        ? `${learning.badge ?? "Đang học"} — chưa đủ dữ liệu để kết luận`
        : `${learning.badge ?? "Học hạn chế"} — số liệu dùng được nhưng còn dao động, nên theo dõi sát`,
      basis: "Meta coi một chiến dịch là ổn định khi đã chạy từ 7 ngày và có từ 50 chuyển đổi trở lên. Chưa đạt thì số liệu còn dao động mạnh.",
      evidence,
    },
  };
}

// ─────────────────────────────────────────────
// Trụ 3 — Nghẽn ở đâu trong phễu
// ─────────────────────────────────────────────

function pillarFunnel(input: AnalysisInput, goalKind: GoalKind, findings: Finding[]): Pillar {
  const m = input.metrics;
  const ageDays = input.campaign.startTime || input.campaign.createdTime
    ? daysBetween(String(input.campaign.startTime || input.campaign.createdTime), new Date().toISOString())
    : 999;

  const evidence: string[] = [`Hiển thị: ${num(m.impressions)}`, `Click: ${num(m.clicks)} (CTR ${pct(m.ctr)})`];
  if (input.platform === "facebook" && m.reach > 0) {
    evidence.push(`Người tiếp cận: ${num(m.reach)} (tần suất ${m.frequency.toFixed(1)} lần/người)`);
  }
  const convCount = goalKind === "leads" && input.platform === "facebook" ? m.leads : m.conversions;
  evidence.push(`Chuyển đổi: ${num(convCount)}`);
  const cvr = div(convCount, m.clicks);
  if (cvr !== null) evidence.push(`Tỷ lệ chuyển đổi trên click: ${pct(cvr * 100)}`);

  const basis =
    "Đi lần lượt ba chặng: hiển thị → click → chuyển đổi. Chặng nào hụt so với mốc thì đó là chỗ nghẽn. " +
    `Mốc dùng ở đây: CTR tham chiếu ${CTR_BENCHMARK_PCT}%, CTR dưới ${CTR_LOW_PCT}% là kém (chỉ xét khi đã trên ${num(CTR_MIN_IMPRESSIONS)} hiển thị), tần suất trên ${FREQUENCY_WARN} lần là bắt đầu bão hoà.`;

  // Chặng 0 — không phân phối
  if (m.impressions === 0) {
    if (input.campaign.status === "ACTIVE" && ageDays > NO_DELIVERY_MIN_AGE_DAYS) {
      findings.push({
        id: "no-delivery",
        severity: "critical",
        title: "Chiến dịch bật nhưng không phân phối",
        detail: `0 lượt hiển thị sau ${ageDays} ngày ở trạng thái đang chạy.`,
        recommendation: "Kiểm tra quảng cáo có bị từ chối không, hoặc ngân sách/giá thầu đặt quá thấp.",
        apply: null,
        manualHint: input.platform === "facebook"
          ? "Meta Ads Manager → cột Trạng thái phân phối của từng nhóm quảng cáo"
          : "Google Ads → cột Trạng thái của từng nhóm quảng cáo",
      });
      return {
        key: "funnel", label: "Nghẽn ở đâu", status: "bad",
        headline: `Không phân phối: 0 hiển thị sau ${ageDays} ngày`,
        basis, evidence,
      };
    }
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "unknown",
      headline: "Chưa có lượt hiển thị nào trong kỳ",
      basis, evidence,
    };
  }

  // ── Ba chặng dưới đây GOM tất cả vấn đề, không thoát sớm ──
  //
  // Bản đầu thoát ngay khi gặp vấn đề đầu tiên. Đo thử với một chiến dịch
  // thật (tần suất 6,2 lần VÀ CTR 0,47%) thì phần bão hoà che mất hẳn phần
  // CTR — người dùng sửa xong cái được báo, chạy lại, mới biết còn cái nữa.
  // Hai chuyện này có nguyên nhân khác nhau và sửa bằng hai việc khác nhau,
  // nên phải nói ra cùng lúc. `headline` vẫn chỉ nêu chặng nghẽn NẶNG NHẤT.
  const saturatedCritical = input.platform === "facebook" && m.frequency > FREQUENCY_CRITICAL;
  const saturatedWarn = input.platform === "facebook" && m.frequency > FREQUENCY_WARN;
  const ctrLow = m.ctr < CTR_LOW_PCT && m.impressions > CTR_MIN_IMPRESSIONS;
  const cvrZero = goalKind !== "traffic" && goalKind !== "awareness"
    && m.clicks >= CVR_MIN_CLICKS && convCount === 0;

  if (saturatedCritical) {
    findings.push({
      id: "frequency-critical",
      severity: "critical",
      title: `Bão hoà nặng — mỗi người đã thấy quảng cáo ${m.frequency.toFixed(1)} lần`,
      detail: `${num(m.impressions)} lượt hiển thị nhưng chỉ tới ${num(m.reach)} người. Tệp đối tượng đã xem đi xem lại.`,
      recommendation: "Mở rộng tệp đối tượng và thay nội dung quảng cáo mới. Giữ nguyên thì tiền vẫn tiêu mà người xem không tăng.",
      apply: null,
      manualHint: "Tạo nội dung mới ở Creative Studio, hoặc nới điều kiện nhắm chọn ở nhóm quảng cáo.",
    });
  } else if (saturatedWarn) {
    findings.push({
      id: "frequency-warn",
      severity: "warning",
      title: `Tệp bắt đầu bão hoà — ${m.frequency.toFixed(1)} lần/người`,
      detail: `${num(m.impressions)} lượt hiển thị trên ${num(m.reach)} người.`,
      recommendation: "Chuẩn bị nội dung mới hoặc mở rộng tệp trước khi CTR tụt.",
      apply: null,
      manualHint: "Creative Studio → tạo nội dung mới.",
    });
  }

  if (ctrLow) {
    findings.push({
      id: "ctr-low",
      severity: "warning",
      title: `CTR ${pct(m.ctr)} — thấp hơn nhiều so với mốc ${CTR_BENCHMARK_PCT}%`,
      detail: saturatedWarn
        ? `${num(m.impressions)} lượt hiển thị chỉ ra ${num(m.clicks)} click, và mỗi người đã thấy ${m.frequency.toFixed(1)} lần — quảng cáo đã cũ với tệp này.`
        : `${num(m.impressions)} lượt hiển thị chỉ ra ${num(m.clicks)} click.`,
      recommendation: saturatedWarn
        ? "Thay nội dung quảng cáo mới và mở rộng tệp — người xem đã chán, không phải do đặt giá thầu."
        : "Thử nội dung quảng cáo khác hoặc thu hẹp tệp cho đúng người hơn.",
      apply: null,
      manualHint: "Creative Studio → tạo nội dung mới cho chiến dịch này.",
    });
  }

  if (cvrZero) {
    findings.push({
      id: "cvr-zero",
      severity: "critical",
      title: `${num(m.clicks)} click nhưng không có chuyển đổi nào`,
      detail: "Quảng cáo kéo được người bấm vào, nhưng sau khi vào thì không ai hoàn tất. Nghẽn nằm SAU cú click.",
      recommendation: "Kiểm tra trang đích (tốc độ tải, biểu mẫu, trải nghiệm trên điện thoại) và kiểm tra việc đo chuyển đổi có hoạt động không.",
      apply: null,
      manualHint: "Tự mở trang đích trên điện thoại và đi hết một lượt như khách hàng.",
    });
  }

  // Chặng nghẽn NẶNG NHẤT quyết định kết luận một dòng của trụ này.
  if (cvrZero) {
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "bad",
      headline: "Nghẽn sau cú click — người vào rồi rời đi mà không hoàn tất",
      basis, evidence,
    };
  }
  if (saturatedCritical) {
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "bad",
      headline: `Nghẽn ở tệp đối tượng — tần suất ${m.frequency.toFixed(1)} lần/người${ctrLow ? `, kéo CTR xuống ${pct(m.ctr)}` : ""}`,
      basis, evidence,
    };
  }
  if (ctrLow) {
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "bad",
      headline: `Nghẽn ở khâu thu hút: thấy nhiều nhưng ${pct(m.ctr)} mới bấm`,
      basis, evidence,
    };
  }
  if (saturatedWarn) {
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "warn",
      headline: `Tệp bắt đầu bão hoà — mỗi người đã thấy ${m.frequency.toFixed(1)} lần`,
      basis, evidence,
    };
  }

  if (m.ctr >= CTR_EXCELLENT_PCT) {
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "good",
      headline: `Không thấy nghẽn — CTR ${pct(m.ctr)}, trên mốc tham chiếu`,
      basis, evidence,
    };
  }
  if (m.ctr >= CTR_GOOD_PCT) {
    return {
      key: "funnel", label: "Nghẽn ở đâu", status: "good",
      headline: `Phễu thông — CTR ${pct(m.ctr)} đạt mốc tham chiếu`,
      basis, evidence,
    };
  }
  return {
    key: "funnel", label: "Nghẽn ở đâu", status: "warn",
    headline: `CTR ${pct(m.ctr)} — dưới mốc tham chiếu ${CTR_BENCHMARK_PCT}% nhưng chưa tới mức báo động`,
    basis, evidence,
  };
}

// ─────────────────────────────────────────────
// Trụ 4 — Xu hướng theo ngày
// ─────────────────────────────────────────────

function pillarTrend(input: AnalysisInput, goalKind: GoalKind, findings: Finding[]): Pillar {
  const days = input.daily.filter(d => d.spend > 0 || d.impressions > 0);
  const basis =
    `Chia kỳ làm đôi rồi so nửa sau với nửa đầu. Cần tối thiểu ${TREND_MIN_DAYS} ngày có dữ liệu; ` +
    `chênh lệch dưới ${TREND_SIGNIFICANT_PCT}% coi như đi ngang.`;

  if (days.length < TREND_MIN_DAYS) {
    return {
      key: "trend", label: "Xu hướng", status: "unknown",
      headline: `Mới có ${days.length} ngày dữ liệu — chưa đủ để nói xu hướng`,
      basis,
      evidence: [`Số ngày có dữ liệu: ${days.length}/${TREND_MIN_DAYS} cần thiết`],
    };
  }

  const mid = Math.floor(days.length / 2);
  const first = days.slice(0, mid);
  const second = days.slice(mid);
  const sum = (xs: AnalysisDaily[], pick: (d: AnalysisDaily) => number) => xs.reduce((s, d) => s + pick(d), 0);

  const convOf = (d: AnalysisDaily) =>
    goalKind === "leads" && input.platform === "facebook" ? d.leads : (d.conversions ?? d.leads);

  const firstSpend = sum(first, d => d.spend), secondSpend = sum(second, d => d.spend);
  const firstClicks = sum(first, d => d.clicks), secondClicks = sum(second, d => d.clicks);
  const firstImpr = sum(first, d => d.impressions), secondImpr = sum(second, d => d.impressions);
  const firstConv = sum(first, convOf), secondConv = sum(second, convOf);

  const firstCtr = div(firstClicks, firstImpr);
  const secondCtr = div(secondClicks, secondImpr);
  const firstCpa = div(firstSpend, firstConv);
  const secondCpa = div(secondSpend, secondConv);

  const evidence: string[] = [
    `Nửa đầu (${first[0].date} → ${first[first.length - 1].date}): ${vnd(firstSpend)}, ${num(firstClicks)} click, ${num(firstConv)} chuyển đổi`,
    `Nửa sau (${second[0].date} → ${second[second.length - 1].date}): ${vnd(secondSpend)}, ${num(secondClicks)} click, ${num(secondConv)} chuyển đổi`,
  ];
  if (firstCtr !== null && secondCtr !== null) {
    evidence.push(`CTR: ${pct(firstCtr * 100)} → ${pct(secondCtr * 100)}`);
  }
  if (firstCpa !== null && secondCpa !== null) {
    evidence.push(`Chi phí mỗi chuyển đổi: ${vnd(firstCpa)} → ${vnd(secondCpa)}`);
  }

  // Chi phí mỗi chuyển đổi là chỉ số đáng tin nhất để nói tốt lên hay xấu đi.
  if (firstCpa !== null && secondCpa !== null) {
    const change = ((secondCpa - firstCpa) / firstCpa) * 100;
    if (change > TREND_SIGNIFICANT_PCT) {
      findings.push({
        id: "trend-cpa-worse",
        severity: "warning",
        title: `Chi phí mỗi chuyển đổi đang tăng ${Math.round(change)}%`,
        detail: `Từ ${vnd(firstCpa)} ở nửa đầu kỳ lên ${vnd(secondCpa)} ở nửa sau.`,
        recommendation: "Chiến dịch đang đắt dần lên. Kiểm tra tần suất và độ mới của nội dung trước khi tăng thêm ngân sách.",
        apply: null,
        manualHint: "Xem bảng 'Xu hướng theo ngày' ngay dưới để tìm ngày bắt đầu xấu đi.",
      });
      return {
        key: "trend", label: "Xu hướng", status: "bad",
        headline: `Đang xấu đi — chi phí mỗi chuyển đổi tăng ${Math.round(change)}%`,
        basis, evidence,
      };
    }
    if (change < -TREND_SIGNIFICANT_PCT) {
      return {
        key: "trend", label: "Xu hướng", status: "good",
        headline: `Đang tốt lên — chi phí mỗi chuyển đổi giảm ${Math.round(Math.abs(change))}%`,
        basis, evidence,
      };
    }
    return {
      key: "trend", label: "Xu hướng", status: "good",
      headline: "Đi ngang — chi phí mỗi chuyển đổi ổn định giữa hai nửa kỳ",
      basis, evidence,
    };
  }

  // Không có chuyển đổi ở cả hai nửa thì lùi về so CTR.
  if (firstCtr !== null && secondCtr !== null && firstCtr > 0) {
    const change = ((secondCtr - firstCtr) / firstCtr) * 100;
    if (change < -TREND_SIGNIFICANT_PCT) {
      findings.push({
        id: "trend-ctr-worse",
        severity: "warning",
        title: `CTR đang tụt ${Math.round(Math.abs(change))}%`,
        detail: `Từ ${pct(firstCtr * 100)} xuống ${pct(secondCtr * 100)}.`,
        recommendation: "Dấu hiệu quen thuộc của nội dung quảng cáo đã cũ với tệp. Chuẩn bị nội dung mới.",
        apply: null,
        manualHint: "Creative Studio → tạo nội dung mới.",
      });
      return {
        key: "trend", label: "Xu hướng", status: "bad",
        headline: `CTR đang tụt ${Math.round(Math.abs(change))}% so với nửa đầu kỳ`,
        basis, evidence,
      };
    }
    return {
      key: "trend", label: "Xu hướng", status: change > TREND_SIGNIFICANT_PCT ? "good" : "warn",
      headline: change > TREND_SIGNIFICANT_PCT
        ? `CTR đang lên ${Math.round(change)}%`
        : "CTR đi ngang, nhưng chưa có chuyển đổi nào để so chi phí",
      basis, evidence,
    };
  }

  return {
    key: "trend", label: "Xu hướng", status: "unknown",
    headline: "Chưa đủ chuyển đổi hoặc click để so hai nửa kỳ",
    basis, evidence,
  };
}

// ─────────────────────────────────────────────
// Trụ 5 — Cấu trúc bên trong chiến dịch
// ─────────────────────────────────────────────

function pillarStructure(input: AnalysisInput, goalKind: GoalKind, findings: Finding[]): Pillar {
  const unitName = input.platform === "google" ? "nhóm quảng cáo" : "nhóm đối tượng";
  const spending = input.adsets.filter(a => a.spend > 0);
  const basis =
    `So các ${unitName} với nhau trong cùng một chiến dịch — cùng sản phẩm, cùng thời điểm, nên chênh lệch là do chính ` +
    `${unitName} đó. ${unitName === "nhóm quảng cáo" ? "Nhóm" : "Nhóm"} nào ăn từ ${Math.round(ADSET_WASTE_SHARE * 100)}% ngân sách trở lên mà không ra chuyển đổi thì gọi tên.`;

  if (spending.length === 0) {
    return {
      key: "structure", label: "Cấu trúc bên trong", status: "unknown",
      headline: `Chưa có ${unitName} nào tiêu tiền trong kỳ`,
      basis, evidence: [],
    };
  }
  if (spending.length === 1) {
    return {
      key: "structure", label: "Cấu trúc bên trong", status: "unknown",
      headline: `Chỉ có một ${unitName} đang tiêu tiền — không có gì để so sánh`,
      basis,
      evidence: [`${spending[0].name}: ${vnd(spending[0].spend)}, ${num(spending[0].conversions)} chuyển đổi`],
    };
  }

  const convOf = (a: AnalysisAdset) =>
    goalKind === "leads" && input.platform === "facebook" ? a.leads : a.conversions;

  const totalSpend = spending.reduce((s, a) => s + a.spend, 0);
  const evidence = spending
    .slice()
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6)
    .map(a => {
      const cpa = div(a.spend, convOf(a));
      return `${a.name}: ${vnd(a.spend)} (${Math.round((a.spend / totalSpend) * 100)}% ngân sách), ` +
             `${num(convOf(a))} chuyển đổi${cpa !== null ? `, ${vnd(cpa)}/chuyển đổi` : ""}`;
    });

  const wasteful = spending.filter(a => convOf(a) === 0 && a.spend / totalSpend >= ADSET_WASTE_SHARE);
  const wastedSpend = wasteful.reduce((s, a) => s + a.spend, 0);

  if (wasteful.length > 0) {
    findings.push({
      id: "adset-waste",
      severity: "warning",
      title: `${wasteful.length} ${unitName} tiêu ${vnd(wastedSpend)} mà không ra chuyển đổi nào`,
      detail: wasteful.map(a => `${a.name} — ${vnd(a.spend)}, ${num(a.clicks)} click, 0 chuyển đổi`).join("; "),
      recommendation: `Tắt ${wasteful.length > 1 ? `${wasteful.length} ` : ""}${unitName} này và dồn ngân sách sang nhóm đang ra kết quả.`,
      // Hệ thống CHƯA có đường ghi ở cấp nhóm — nói thẳng thay vì dựng một
      // cái nút bấm vào không đổi được gì.
      apply: null,
      manualHint: input.platform === "facebook"
        ? "Meta Ads Manager → mở chiến dịch → tắt nhóm đối tượng tương ứng"
        : "Google Ads → mở chiến dịch → tắt nhóm quảng cáo tương ứng",
    });
    return {
      key: "structure", label: "Cấu trúc bên trong", status: "bad",
      headline: `${vnd(wastedSpend)} đang chảy vào ${wasteful.length} ${unitName} không ra kết quả`,
      basis, evidence,
    };
  }

  const withConv = spending.filter(a => convOf(a) > 0);
  if (withConv.length >= 2) {
    const sorted = withConv
      .map(a => ({ a, cpa: a.spend / convOf(a) }))
      .sort((x, y) => x.cpa - y.cpa);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (worst.cpa > best.cpa * 2) {
      findings.push({
        id: "adset-spread",
        severity: "info",
        title: `Chênh lệch lớn giữa các ${unitName}`,
        detail: `"${best.a.name}" tốn ${vnd(best.cpa)}/chuyển đổi, trong khi "${worst.a.name}" tốn ${vnd(worst.cpa)} — gấp ${(worst.cpa / best.cpa).toFixed(1)} lần.`,
        recommendation: `Dồn thêm ngân sách cho "${best.a.name}" và giảm ở "${worst.a.name}".`,
        apply: null,
        manualHint: `Ngân sách ở cấp ${unitName} phải chỉnh trực tiếp trên trình quản lý.`,
      });
      return {
        key: "structure", label: "Cấu trúc bên trong", status: "warn",
        headline: `Hiệu quả lệch nhau ${(worst.cpa / best.cpa).toFixed(1)} lần giữa các ${unitName}`,
        basis, evidence,
      };
    }
  }

  return {
    key: "structure", label: "Cấu trúc bên trong", status: "good",
    headline: `Các ${unitName} đang chạy đều tay, không có nhóm nào đốt tiền vô ích`,
    basis, evidence,
  };
}

// ─────────────────────────────────────────────
// Tổng hợp
// ─────────────────────────────────────────────

const STATUS_POINTS: Record<Exclude<PillarStatus, "unknown">, number> = {
  good: 100, warn: 55, bad: 15,
};

/** Trọng số — trụ "mục tiêu" nặng nhất vì nó trả lời đúng câu hỏi tiền có đẻ ra kết quả không. */
const PILLAR_WEIGHT: Record<PillarKey, number> = {
  goal: 3, funnel: 2, trend: 2, structure: 1, learning: 1,
};

export function analyzeCampaign(input: AnalysisInput): CampaignAnalysis {
  const warnings: string[] = [];
  const findings: Finding[] = [];

  const goalKind = detectGoalKind(input.platform, input.campaign.objective, input.metrics);

  const goal = pillarGoal(input, goalKind, warnings, findings);
  const { pillar: learningPillar, learning } = pillarLearning(input);
  const funnel = pillarFunnel(input, goalKind, findings);
  const trend = pillarTrend(input, goalKind, findings);
  const structure = pillarStructure(input, goalKind, findings);

  const pillars = [goal, learningPillar, funnel, trend, structure];

  // ── Chốt chặn giai đoạn học ──
  // Chiến dịch chưa đủ tuổi/chuyển đổi thì mọi kết luận tiêu cực bị hạ một bậc
  // và mọi đề xuất TẮT bị gỡ nút áp. Đây là chốt quan trọng nhất của cả file:
  // không có nó, hệ thống sẽ khuyên tắt chiến dịch mới vào đúng lúc nó cần
  // được để yên mà chạy.
  const gated = learning !== null && learning.blockAutomation;
  const gateReason = gated
    ? `Chiến dịch mới ${learning!.ageDays} ngày tuổi với ${num(learning!.conversions)} chuyển đổi — chưa qua giai đoạn học. ` +
      `Số liệu giai đoạn này còn dao động mạnh, nên hệ thống không đề xuất tắt hay cắt ngân sách.`
    : null;

  const effectiveFindings = gated
    ? findings.map(f =>
        f.apply?.kind === "PAUSE_CAMPAIGN" || f.apply?.kind === "SET_DAILY_BUDGET"
          ? {
              ...f,
              severity: f.severity === "critical" ? ("warning" as Severity) : f.severity,
              apply: null,
              // PHẢI viết lại cả câu khuyên, không chỉ gỡ cái nút.
              // Đo thử lần đầu: nút biến mất đúng như thiết kế, nhưng dòng
              // "Nên làm: Tạm dừng chiến dịch..." vẫn còn nguyên ngay dưới lời
              // chặn "hệ thống không đề xuất tắt". Người đọc thấy hai câu đá
              // nhau thì sẽ tin câu nào nghe dứt khoát hơn — tức là câu sai.
              recommendation:
                `Chưa nên xử lý vội: chiến dịch còn trong giai đoạn học nên số liệu chưa ổn định. ` +
                `Để chạy thêm cho đủ 7 ngày và 50 chuyển đổi rồi chấm lại. ` +
                `Nếu cần can thiệp gấp thì tự quyết và thao tác tay.`,
              manualHint: "Đang trong giai đoạn học — hệ thống tạm khoá thao tác tắt/cắt ngân sách.",
            }
          : f
      )
    : findings;

  // ── Điểm tổng ──
  //
  // KHÔNG CHẤM ĐIỂM KHI KHÔNG ĐO ĐƯỢC MỤC TIÊU.
  //
  // Đo thử với một chiến dịch thật: chiến dịch bán hàng có 64 đơn nhưng Pixel
  // không gửi giá trị đơn về → trụ "mục tiêu" là `unknown`. Bản đầu vẫn in ra
  // "58/100 — mức trung bình", chấm từ bốn trụ phụ. Con số đó trông như một
  // phán quyết về chiến dịch, trong khi câu hỏi quan trọng nhất — tiền bỏ ra
  // có đẻ ra doanh thu không — còn chưa trả lời được. Tệ hơn nữa là nó ĐỘNG
  // ĐẬY theo thứ khác: cùng một chiến dịch, chỉ vì thiếu biến ngưỡng CPL mà
  // điểm tụt từ 57 xuống 39, làm như chiến dịch vừa xấu đi.
  //
  // Thiếu thước thì nói là thiếu thước. Các trụ còn lại vẫn hiện đầy đủ bên
  // dưới, và phần "cần làm gì" vẫn hoạt động — chỉ không có điểm tổng.
  let score: number | null = null;
  if (goal.status !== "unknown") {
    let weighted = 0, totalWeight = 0;
    for (const p of pillars) {
      if (p.status === "unknown") continue;
      const w = PILLAR_WEIGHT[p.key];
      weighted += STATUS_POINTS[p.status] * w;
      totalWeight += w;
    }
    score = totalWeight > 0 ? Math.round(weighted / totalWeight) : null;
  }

  // Sắp xếp NGAY ĐÂY, trước khi dựng câu kết luận. Đặt ở cuối hàm như bản đầu
  // thì `effectiveFindings[0]` lúc viết kết luận vẫn là mục được đẩy vào sớm
  // nhất, nên câu "nặng nhất là X" có thể chỉ tên một cảnh báo nhẹ trong khi
  // một mục nghiêm trọng đang nằm ngay dưới.
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  effectiveFindings.sort((a, b) => order[a.severity] - order[b.severity]);

  // ── Kết luận một câu ──
  const worst = effectiveFindings[0];
  // Trụ xếp loại kém, theo đúng thứ tự trọng số (nặng nhất đứng trước) để câu
  // kết luận nêu đúng cái đáng lo nhất chứ không phải cái tình cờ đứng đầu mảng.
  const badPillars = pillars
    .filter(p => p.status === "bad")
    .sort((a, b) => PILLAR_WEIGHT[b.key] - PILLAR_WEIGHT[a.key]);
  let verdict: string;
  if (goal.status === "unknown") {
    verdict =
      `Chưa chấm được điểm tổng: ${goal.headline.toLowerCase()}. ` +
      (effectiveFindings.length > 0
        ? `Dù vậy đã thấy ${effectiveFindings.length} việc cần xử lý, nặng nhất là: ${worst.title}.`
        : "Các trụ còn lại chưa thấy vấn đề nào.");
  } else if (score === null) {
    verdict = "Chưa đủ dữ liệu để chấm hiệu quả chiến dịch này.";
  } else if (gated) {
    verdict = `Chiến dịch còn trong giai đoạn học — tạm chấm ${score}/100, nhưng chưa nên dùng con số này để ra quyết định tắt/mở.`;
  } else if (score >= 75 && badPillars.length > 0) {
    // ĐIỂM CAO KHÔNG ĐƯỢC PHÉP NUỐT MẤT MỘT TRỤ XẾP LOẠI KÉM.
    //
    // Đo thật 23/09 trên "MBC - VIBE HOSTING - 10/9": ROAS 7,26x kéo điểm lên
    // 76, vừa đủ vượt mốc 75, nên câu kết luận in ra "Chiến dịch đang chạy
    // tốt" — ngay phía dưới là trụ Xu hướng đeo nhãn đỏ "Kém" (chi phí mỗi
    // chuyển đổi tăng 28%) và ô "Cần làm gì" đang có 1 việc. Người đọc lướt
    // qua chỉ thấy dòng đầu, và dòng đầu đang nói ngược phần còn lại.
    //
    // Điểm tổng là số trung bình có trọng số nên một trụ hỏng luôn bị các trụ
    // tốt pha loãng. Vì vậy câu kết luận phải tự nêu trụ hỏng ra, không dựa
    // vào việc người đọc kéo xuống nhìn nhãn màu.
    verdict =
      `Nhìn chung tốt (${score}/100) nhưng có ${badPillars.length} điểm phải xử lý. ${goal.headline}. ` +
      `Đáng lo nhất là ${badPillars[0].label.toLowerCase()}: ${badPillars[0].headline.toLowerCase()}.`;
  } else if (score >= 75) {
    verdict = `Chiến dịch đang chạy tốt (${score}/100). ${goal.headline}`;
  } else if (score >= 50) {
    verdict = `Chiến dịch ở mức trung bình (${score}/100), có chỗ cần sửa. ${goal.headline}`;
  } else {
    verdict = `Chiến dịch đang có vấn đề (${score}/100). ${goal.headline}`;
  }

  return {
    goalKind, score, gated, gateReason, verdict,
    pillars, findings: effectiveFindings,
    dataWarnings: warnings,
    // Lọc xuống còn trường đếm được — xem ghi chú ở khai báo kiểu.
    learning: learning
      ? {
          phase: learning.phase,
          ageDays: learning.ageDays,
          conversions: learning.conversions,
          blockAutomation: learning.blockAutomation,
        }
      : null,
  };
}
