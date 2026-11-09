// ============================================================
// Chiến lược đấu thầu Google Ads
// ------------------------------------------------------------
// Trước bản này tool GHIM CỨNG: Search luôn `maximize_conversions`, PMax luôn
// `maximize_conversion_value`. Không chọn được gì. Tệ hơn, màn creative hiện
// một khối "💰 Bidding Recommendation: Strategy / Target CPA / Lý do" trông
// như GỢI Ý, nhưng con số Target CPA đó được lấy thẳng áp vào campaign thật —
// tức AI đang đặt giá thầu mục tiêu mà nhãn thì bảo đó chỉ là đề xuất, và
// không có nút nào sửa hay tắt.
//
// ĐO THẬT bằng validate_only trên tài khoản MBC ngày 18/09/2026 (tạo campaign
// Search thử, và update campaign PMax thật — PMax không tạo thử được vì
// Brand Guidelines đòi logo):
//
//   CAMPAIGN SEARCH
//     ✅ maximize_conversions            (có/không target_cpa_micros)
//     ✅ maximize_conversion_value       (có/không target_roas)
//     ✅ target_spend                    (có/không cpc_bid_ceiling_micros)
//     ✅ manual_cpc  { enhanced_cpc_enabled: false }
//     ✅ target_impression_share
//     ❌ manual_cpc  { enhanced_cpc_enabled: true }  → "operation is not allowed
//        for the given context" (Google đã khai tử Enhanced CPC)
//     ❌ target_cpa / target_roas dạng trường riêng (kiểu cũ) → cùng câu lỗi
//
//   CAMPAIGN PERFORMANCE MAX
//     ✅ maximize_conversions / maximize_conversion_value (có/không mục tiêu)
//     ❌ manual_cpc → "operation is not allowed for the given context"
//     ⚠️ target_spend được API CHẤP NHẬN, nhưng giao diện Google Ads không cho
//        PMax chạy Maximize Clicks. Không mở ra ở đây: mở một lựa chọn mà
//        chính Google không hỗ trợ thì lúc nó chạy sai sẽ không có cách nào
//        biết. Chấp nhận qua validate_only KHÔNG có nghĩa là chạy đúng.
//
//   GIÁ TRỊ BIÊN — Google KHÔNG chặn gì cả:
//     ✅ target_roas = 0.01 · 1.0 · 100      (1% tới 10.000%)
//     ✅ target_cpa = 1.000₫  ·  target_cpa = 0  ← nhận cả số 0
//   Nghĩa là không thể trông vào Google để bắt số vô lý. Phải tự chặn ở đây.
// ============================================================

export type BiddingStrategy =
  | "MAXIMIZE_CONVERSIONS"
  | "MAXIMIZE_CONVERSION_VALUE"
  | "MAXIMIZE_CLICKS"
  | "MANUAL_CPC"
  | "TARGET_IMPRESSION_SHARE";

export type ImpressionShareLocation = "ANYWHERE_ON_PAGE" | "TOP_OF_PAGE" | "ABSOLUTE_TOP_OF_PAGE";

export interface BiddingConfig {
  strategy: BiddingStrategy;
  /** Giá mỗi chuyển đổi mong muốn, ĐƠN VỊ ĐỒNG. Rỗng = để Google tự chạy. */
  targetCpaVnd?: number | null;
  /** 3 = 300% (thu 3đ trên mỗi 1đ chi). Rỗng = để Google tự chạy. */
  targetRoas?: number | null;
  /** Trần CPC, đồng. Dùng cho Maximize Clicks và Target Impression Share. */
  cpcCeilingVnd?: number | null;
  /** Giá thầu CPC thủ công ở cấp nhóm quảng cáo, đồng. */
  manualCpcVnd?: number | null;
  impressionShareLocation?: ImpressionShareLocation;
  /** 65 = muốn hiện ở 65% số lượt tìm kiếm hợp lệ. */
  impressionSharePercent?: number | null;
}

export const DEFAULT_BIDDING: BiddingConfig = { strategy: "MAXIMIZE_CONVERSIONS" };

/** Giá thầu CPC mặc định ở cấp nhóm quảng cáo (5.000₫) — giá trị vốn đã ghim
 *  cứng trong route launch từ trước, nay thành sửa được khi chọn Manual CPC. */
export const DEFAULT_AD_GROUP_CPC_VND = 5_000;

export interface StrategyInfo {
  key: BiddingStrategy;
  label: string;
  /** Một câu nói campaign sẽ đuổi theo cái gì. */
  what: string;
  /** Khi nào nên dùng — theo nghiệp vụ, không phải theo tài liệu API. */
  whenToUse: string;
  /** Loại campaign dùng được. */
  channels: Array<"SEARCH" | "PMAX">;
}

export const BIDDING_STRATEGIES: StrategyInfo[] = [
  {
    key: "MAXIMIZE_CONVERSIONS",
    label: "Tối đa chuyển đổi",
    what: "Google tiêu hết ngân sách để lấy NHIỀU chuyển đổi nhất, không quan tâm mỗi cái giá bao nhiêu.",
    whenToUse: "Mặc định an toàn cho campaign mới. Đặt thêm Target CPA khi đã biết mình chịu được giá nào.",
    channels: ["SEARCH", "PMAX"],
  },
  {
    key: "MAXIMIZE_CONVERSION_VALUE",
    label: "Tối đa giá trị chuyển đổi",
    what: "Google đuổi theo TỔNG TIỀN của chuyển đổi, không phải số lượng — ưu tiên đơn to hơn đơn nhiều.",
    whenToUse: "Chỉ dùng khi hành động chuyển đổi có GỬI GIÁ TRỊ về Google. Không có giá trị thì chiến lược này không có gì để tối đa.",
    channels: ["SEARCH", "PMAX"],
  },
  {
    key: "MAXIMIZE_CLICKS",
    label: "Tối đa lượt bấm",
    what: "Google tiêu hết ngân sách để lấy nhiều lượt bấm nhất. KHÔNG nhìn chuyển đổi.",
    whenToUse: "Kéo lưu lượng lúc mới mở, hoặc khi chưa đo được chuyển đổi. Nhớ đặt trần CPC, không thì giá mỗi lượt bấm dễ vọt.",
    channels: ["SEARCH"],
  },
  {
    key: "MANUAL_CPC",
    label: "CPC thủ công",
    what: "Bạn tự đặt giá thầu, Google không tự điều chỉnh.",
    whenToUse: "Khi muốn kiểm soát chặt vài ngày đầu. Đổi lại phải theo dõi tay hằng ngày — không có tự động hoá nào chạy hộ.",
    channels: ["SEARCH"],
  },
  {
    key: "TARGET_IMPRESSION_SHARE",
    label: "Tỉ lệ hiển thị mục tiêu",
    what: "Google đấu thầu để quảng cáo XUẤT HIỆN ở vị trí bạn chọn, với tần suất bạn chọn.",
    whenToUse: "Giữ thương hiệu luôn hiện trên từ khoá quan trọng. Đây là chiến lược đuổi theo ĐỘ HIỂN THỊ, không đuổi theo đơn hàng.",
    channels: ["SEARCH"],
  },
];

export function strategiesFor(channel: "SEARCH" | "PMAX"): StrategyInfo[] {
  return BIDDING_STRATEGIES.filter((s) => s.channels.includes(channel));
}

export interface BiddingCheck {
  /** Chặn hẳn — không gửi lên Google. */
  errors: string[];
  /** Gửi được nhưng người dùng nên biết trước. */
  warnings: string[];
}

/**
 * Kiểm cấu hình đấu thầu TRƯỚC khi gửi.
 *
 * Google nhận cả `target_cpa = 0` và `target_roas = 10000%` mà không nói gì
 * (đã đo), nên mọi lan can hợp lý phải nằm ở đây. Tách ERRORS (chặn) khỏi
 * WARNINGS (cho qua nhưng nói trước) có chủ đích: chặn nhầm một cấu hình hợp
 * lệ còn khó chịu hơn để lọt một cấu hình liều.
 */
export function checkBidding(
  cfg: BiddingConfig,
  channel: "SEARCH" | "PMAX",
  ctx: {
    dailyBudgetVnd: number;
    /** Số chuyển đổi 30 ngày của các hành động ĐÃ CHỌN. `null` = chưa đo được
     *  — KHÁC HẲN 0 (đo rồi và bằng không), nên không gộp hai cái làm một. */
    conversions30d?: number | null;
    /** Các hành động đã chọn có gửi GIÁ TRỊ tiền về không. */
    hasConversionValue?: boolean | null;
  },
): BiddingCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const allowed = strategiesFor(channel).some((s) => s.key === cfg.strategy);
  if (!allowed) {
    errors.push(`Chiến lược "${cfg.strategy}" không dùng được cho campaign ${channel === "PMAX" ? "Performance Max" : "Search"}.`);
    return { errors, warnings };
  }

  const newCampaignNoHistory = ctx.conversions30d === 0;

  if (cfg.strategy === "MAXIMIZE_CONVERSIONS" && cfg.targetCpaVnd != null) {
    if (cfg.targetCpaVnd <= 0) {
      // Google NHẬN target_cpa = 0 (đã đo) — nên phải tự chặn.
      errors.push("Target CPA phải lớn hơn 0. Để trống nếu muốn Google tự chạy.");
    } else if (cfg.targetCpaVnd > ctx.dailyBudgetVnd) {
      warnings.push(
        `Target CPA ${cfg.targetCpaVnd.toLocaleString("vi-VN")}₫ CAO HƠN ngân sách ngày ` +
        `${ctx.dailyBudgetVnd.toLocaleString("vi-VN")}₫ — mỗi ngày chưa đủ tiền cho một chuyển đổi, Google sẽ rất khó tiêu hết ngân sách.`);
    }
    if (newCampaignNoHistory) {
      warnings.push("Hành động chuyển đổi đã chọn có 0 chuyển đổi trong 30 ngày. Đặt Target CPA khi Google chưa có gì để học thường làm campaign tiêu rất ít hoặc không chạy.");
    }
  }

  if (cfg.strategy === "MAXIMIZE_CONVERSION_VALUE") {
    if (ctx.hasConversionValue === false) {
      warnings.push("Hành động chuyển đổi đã chọn KHÔNG gửi giá trị tiền về Google. Chiến lược này đuổi theo tổng tiền — không có giá trị thì nó không có gì để tối đa, kết quả gần như Tối đa chuyển đổi.");
    }
    if (cfg.targetRoas != null) {
      if (cfg.targetRoas <= 0) {
        errors.push("Target ROAS phải lớn hơn 0. Để trống nếu muốn Google tự chạy.");
      } else if (cfg.targetRoas < 1) {
        warnings.push(`Target ROAS ${(cfg.targetRoas * 100).toFixed(0)}% nghĩa là thu về ÍT HƠN số tiền bỏ ra. Cố ý thì được, nhưng nói trước để khỏi gõ nhầm.`);
      } else if (cfg.targetRoas > 20) {
        warnings.push(`Target ROAS ${(cfg.targetRoas * 100).toFixed(0)}% là rất cao — Google sẽ chỉ đấu thầu ở những lượt gần như chắc thắng, và thường tiêu được rất ít ngân sách.`);
      }
      if (newCampaignNoHistory) {
        warnings.push("Đặt Target ROAS khi chưa có lịch sử chuyển đổi thường làm campaign gần như không chạy.");
      }
    }
  }

  if (cfg.strategy === "MAXIMIZE_CLICKS") {
    if (cfg.cpcCeilingVnd == null) {
      warnings.push("Chưa đặt trần CPC. Không có trần thì Google được tự do trả giá cao cho một lượt bấm — đặt trần là cách rẻ nhất để giữ giá.");
    } else if (cfg.cpcCeilingVnd <= 0) {
      errors.push("Trần CPC phải lớn hơn 0.");
    }
    warnings.push("Chiến lược này KHÔNG nhìn chuyển đổi — nó mua lượt bấm. Lượt bấm nhiều mà không ra đơn vẫn là tiêu đúng theo mục tiêu đã đặt.");
  }

  if (cfg.strategy === "MANUAL_CPC") {
    const bid = cfg.manualCpcVnd ?? DEFAULT_AD_GROUP_CPC_VND;
    if (bid <= 0) errors.push("Giá thầu CPC thủ công phải lớn hơn 0.");
    warnings.push("CPC thủ công không có tự động hoá nào chạy hộ — phải tự theo dõi và chỉnh giá thầu hằng ngày.");
  }

  if (cfg.strategy === "TARGET_IMPRESSION_SHARE") {
    const pct = cfg.impressionSharePercent;
    if (pct == null || pct <= 0 || pct > 100) {
      errors.push("Tỉ lệ hiển thị mục tiêu phải nằm trong khoảng 1–100%.");
    }
    if (cfg.cpcCeilingVnd == null) {
      warnings.push("Chưa đặt trần CPC. Chiến lược này đuổi theo ĐỘ HIỂN THỊ chứ không nhìn hiệu quả — không có trần thì nó sẵn sàng trả rất cao để được hiện.");
    } else if (cfg.cpcCeilingVnd <= 0) {
      errors.push("Trần CPC phải lớn hơn 0.");
    }
    if ((pct ?? 0) >= 90) {
      warnings.push(`Đặt ${pct}% là gần như luôn muốn xuất hiện — phần trăm càng cao thì giá mỗi lượt bấm càng đắt rất nhanh.`);
    }
  }

  return { errors, warnings };
}

/**
 * Dựng phần đấu thầu của resource campaign.
 *
 * Trả về CẢ `adGroupCpcMicros` vì Manual CPC không sống ở cấp campaign — giá
 * thầu thật nằm ở nhóm quảng cáo. Trả riêng một chỗ để người gọi không quên,
 * thay vì để họ tự nhớ rằng chọn Manual CPC thì còn phải đặt thêm gì.
 */
export function buildBiddingResource(
  cfg: BiddingConfig,
): { resource: Record<string, unknown>; adGroupCpcMicros: number | null; summary: string } {
  const vndToMicros = (v: number) => Math.round(v * 1_000_000);

  switch (cfg.strategy) {
    case "MAXIMIZE_CONVERSION_VALUE":
      return {
        resource: {
          maximize_conversion_value: cfg.targetRoas != null && cfg.targetRoas > 0
            ? { target_roas: cfg.targetRoas }
            : {},
        },
        adGroupCpcMicros: null,
        summary: cfg.targetRoas != null && cfg.targetRoas > 0
          ? `Tối đa giá trị chuyển đổi, Target ROAS ${(cfg.targetRoas * 100).toFixed(0)}%`
          : "Tối đa giá trị chuyển đổi (Google tự chạy)",
      };

    case "MAXIMIZE_CLICKS":
      return {
        resource: {
          target_spend: cfg.cpcCeilingVnd != null && cfg.cpcCeilingVnd > 0
            ? { cpc_bid_ceiling_micros: vndToMicros(cfg.cpcCeilingVnd) }
            : {},
        },
        adGroupCpcMicros: null,
        summary: cfg.cpcCeilingVnd != null && cfg.cpcCeilingVnd > 0
          ? `Tối đa lượt bấm, trần CPC ${cfg.cpcCeilingVnd.toLocaleString("vi-VN")}₫`
          : "Tối đa lượt bấm (không đặt trần CPC)",
      };

    case "MANUAL_CPC": {
      const bid = cfg.manualCpcVnd ?? DEFAULT_AD_GROUP_CPC_VND;
      return {
        // enhanced_cpc_enabled PHẢI là false — Google đã khai tử Enhanced CPC
        // và trả "operation is not allowed for the given context" nếu bật (đã đo).
        resource: { manual_cpc: { enhanced_cpc_enabled: false } },
        adGroupCpcMicros: vndToMicros(bid),
        summary: `CPC thủ công, giá thầu ${bid.toLocaleString("vi-VN")}₫`,
      };
    }

    case "TARGET_IMPRESSION_SHARE": {
      const loc = cfg.impressionShareLocation ?? "TOP_OF_PAGE";
      const pct = cfg.impressionSharePercent ?? 65;
      const locVi = loc === "ABSOLUTE_TOP_OF_PAGE" ? "vị trí đầu tiên"
        : loc === "TOP_OF_PAGE" ? "đầu trang" : "bất kỳ đâu trên trang";
      return {
        resource: {
          target_impression_share: {
            location: loc,
            // Google dùng phần triệu: 65% = 650.000
            location_fraction_micros: Math.round(pct * 10_000),
            ...(cfg.cpcCeilingVnd != null && cfg.cpcCeilingVnd > 0
              ? { cpc_bid_ceiling_micros: vndToMicros(cfg.cpcCeilingVnd) }
              : {}),
          },
        },
        adGroupCpcMicros: null,
        summary: `Hiện ở ${locVi} trong ${pct}% lượt tìm kiếm`
          + (cfg.cpcCeilingVnd ? `, trần CPC ${cfg.cpcCeilingVnd.toLocaleString("vi-VN")}₫` : ""),
      };
    }

    case "MAXIMIZE_CONVERSIONS":
    default:
      return {
        resource: {
          maximize_conversions: cfg.targetCpaVnd != null && cfg.targetCpaVnd > 0
            ? { target_cpa_micros: vndToMicros(cfg.targetCpaVnd) }
            : {},
        },
        adGroupCpcMicros: null,
        summary: cfg.targetCpaVnd != null && cfg.targetCpaVnd > 0
          ? `Tối đa chuyển đổi, Target CPA ${cfg.targetCpaVnd.toLocaleString("vi-VN")}₫`
          : "Tối đa chuyển đổi (Google tự chạy)",
      };
  }
}
