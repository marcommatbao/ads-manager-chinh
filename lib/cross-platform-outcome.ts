// ============================================================
// P7 — So sánh hai nền tảng bằng MỘT thước đo, và biết khi nào KHÔNG so được
// ============================================================
// VÌ SAO PHASE NÀY KHÔNG PHẢI "KHUYÊN DỊCH NGÂN SÁCH" (đo 24/09/2026):
//
//              chi tiêu 90 ngày   đơn gắn thẻ   doanh thu gắn thẻ   ROAS
//   Google        994.529.449đ          2.687    1.431.569.854đ    1,44x
//   Facebook      332.133.079đ            120        60.042.400đ    0,18x
//
//   tỷ lệ chi tiêu:    Google 75,0%  ·  Facebook 25,0%
//   tỷ lệ đơn gắn thẻ: Google 95,7%  ·  Facebook  4,3%
//
// Đọc thô thì Google thắng 8 lần và nên dồn hết ngân sách sang đó. Nhưng cùng
// lúc đó Meta TỰ BÁO ROAS 7–8x trên chính các chiến dịch đang chạy. Lệch 40
// lần giữa hai nguồn không phải chênh lệch hiệu quả — đó là chênh lệch GẮN THẺ.
//
// Google tự gắn `gclid` và có mẫu UTM chuẩn; Meta thì phải đặt tay. Bằng chứng
// thêm: Odoo có BỐN cách viết cho cùng một nguồn Facebook (`facebook_ads`,
// `facebook-ads`, `facebook`, `facebookmatbao`) — dấu hiệu gắn thẻ thủ công,
// không nhất quán.
//
// Nên module này KHÔNG đưa khuyến nghị dịch ngân sách khi độ phủ gắn thẻ hai
// bên lệch nhau. Nó nói ra sự lệch đó, vì đấy mới là việc cần sửa trước. Một
// khuyến nghị ngân sách dựng trên dữ liệu lệch sẽ đúng về số học và sai về
// thực tế — loại sai đắt nhất, vì nó trông rất thuyết phục.
//
// Đây cũng là lý do `comparable = false` bị gõ cứng trong
// app/api/dashboard/unified/route.ts. Chốt đó ĐÚNG. Module này không gỡ nó,
// chỉ giải thích bằng số thay vì bằng một câu chung chung.
// ============================================================

/**
 * Nguồn đo kết quả — thang bậc tụt dần theo dữ liệu có được.
 *
 *  "odoo"     Doanh thu đơn hàng thật. Chuẩn nhất, nhưng cần Odoo VÀ cần gắn
 *             thẻ đều tay ở cả hai nền tảng.
 *  "ga4"      Bên thứ ba TRUNG LẬP: đo cả hai nền tảng bằng MỘT mô hình, độc
 *             lập với con số mỗi nền tảng tự khai. Đây là lựa chọn khi không
 *             có Odoo. `lib/ga4-client.ts` đã có `fetchGA4ByCampaign()`.
 *             Lưu ý: GA4 cũng dựa vào UTM nên phép kiểm lệch-gắn-thẻ bên dưới
 *             VẪN phải chạy.
 *  "platform" Số mỗi nền tảng tự báo. KHÔNG so trực tiếp được trừ khi hai bên
 *             đã được cấu hình đếm cùng một tập sự kiện — xem `comparable` gõ
 *             cứng false trong app/api/dashboard/unified/route.ts.
 *
 * Không có nguồn nào ở trên thì ĐỪNG so hai nền tảng. Dùng `assessSelfRelative`
 * — nó không cần thước chung.
 */
export type OutcomeSource = "odoo" | "ga4" | "platform";

export interface PlatformOutcome {
  platform: "google" | "facebook";
  /** Kết quả này đo bằng thước nào. */
  source: OutcomeSource;
  /** Chi tiêu thật trên nền tảng, VND. */
  spendVnd: number;
  /** Số đơn Odoo có gắn nguồn về nền tảng này. */
  taggedOrders: number;
  /** Doanh thu của những đơn đó, VND. */
  taggedRevenueVnd: number;
}

export interface CoverageVerdict {
  /** Có đủ điều kiện để so sánh hai nền tảng bằng doanh thu Odoo không. */
  comparable: boolean;
  /** Lý do, luôn có — kể cả khi comparable = true. */
  reason: string;
  /** Tỷ lệ chi tiêu của từng nền tảng. */
  spendShare: { google: number; facebook: number };
  /** Tỷ lệ đơn gắn thẻ của từng nền tảng. */
  tagShare: { google: number; facebook: number };
  /**
   * Độ lệch gắn thẻ: |tỷ lệ đơn gắn thẻ − tỷ lệ chi tiêu| của nền tảng yếu hơn.
   * Càng lớn nghĩa là nền tảng đó càng bị đo thiếu so với tiền đã tiêu.
   */
  skewPct: number;
  /** Nền tảng đang bị gắn thẻ thiếu nhất, nếu có. */
  underTagged: "google" | "facebook" | null;
  /** ROAS tính theo doanh thu gắn thẻ — CHỈ có nghĩa khi comparable. */
  roas: { google: number | null; facebook: number | null };
  /** Việc cần làm tiếp theo, viết để bấm được. */
  action: string;
  /** Thước đã dùng — phải hiện ra, vì cùng một con số nghĩa khác nhau tuỳ thước. */
  source: OutcomeSource;
}

/**
 * Ngưỡng lệch cho phép. Nền tảng tiêu 25% ngân sách mà chỉ chiếm 4% đơn gắn
 * thẻ thì lệch 21 điểm — quá lớn để so sánh.
 *
 * 15 điểm là mức bắt đầu đáng nghi: dưới đó, chênh lệch có thể do hành vi
 * người mua (tìm kiếm có ý định cao hơn hiển thị) chứ không riêng do gắn thẻ.
 */
export const TAG_SKEW_LIMIT_PCT = 15;

/** Tối thiểu số đơn gắn thẻ mỗi bên trước khi dám so. */
export const MIN_TAGGED_ORDERS = 30;

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`;
const p1 = (n: number) => `${n.toFixed(1)}%`;

export function assessCoverage(google: PlatformOutcome, facebook: PlatformOutcome): CoverageVerdict {
  const source: OutcomeSource = google.source;
  const totalSpend = google.spendVnd + facebook.spendVnd;
  const totalTagged = google.taggedOrders + facebook.taggedOrders;

  const spendShare = {
    google: pctOf(google.spendVnd, totalSpend),
    facebook: pctOf(facebook.spendVnd, totalSpend),
  };
  const tagShare = {
    google: pctOf(google.taggedOrders, totalTagged),
    facebook: pctOf(facebook.taggedOrders, totalTagged),
  };

  const roas = {
    google: google.spendVnd > 0 ? google.taggedRevenueVnd / google.spendVnd : null,
    facebook: facebook.spendVnd > 0 ? facebook.taggedRevenueVnd / facebook.spendVnd : null,
  };

  // Nền tảng nào bị đo thiếu: tỷ lệ đơn gắn thẻ THẤP HƠN tỷ lệ tiền đã tiêu.
  const gSkew = spendShare.google - tagShare.google;
  const fSkew = spendShare.facebook - tagShare.facebook;
  const skewPct = Math.max(gSkew, fSkew, 0);
  const underTagged: "google" | "facebook" | null =
    skewPct < TAG_SKEW_LIMIT_PCT ? null : gSkew > fSkew ? "google" : "facebook";

  if (totalTagged === 0) {
    return {
      comparable: false,
      reason: "Chưa có đơn hàng nào trong kỳ gắn được về nền tảng quảng cáo.",
      source,
      spendShare, tagShare, skewPct: 0, underTagged: null, roas,
      action: "Kiểm tra việc gắn UTM/nguồn cho đơn hàng trước khi so sánh hai nền tảng.",
    };
  }

  if (google.taggedOrders < MIN_TAGGED_ORDERS || facebook.taggedOrders < MIN_TAGGED_ORDERS) {
    const thin = google.taggedOrders < MIN_TAGGED_ORDERS ? "Google" : "Facebook";
    const n = Math.min(google.taggedOrders, facebook.taggedOrders);
    return {
      comparable: false,
      reason: `${thin} chỉ có ${n} đơn gắn thẻ trong kỳ — dưới mức tối thiểu ${MIN_TAGGED_ORDERS} đơn để một con ROAS có nghĩa.`,
      source,
      spendShare, tagShare, skewPct, underTagged, roas,
      action: `Chờ thêm dữ liệu, hoặc nới khoảng thời gian. Chưa nên dịch ngân sách dựa trên ${n} đơn.`,
    };
  }

  if (underTagged) {
    const name = underTagged === "google" ? "Google" : "Facebook";
    const sp = underTagged === "google" ? spendShare.google : spendShare.facebook;
    const tg = underTagged === "google" ? tagShare.google : tagShare.facebook;
    return {
      comparable: false,
      reason:
        `KHÔNG so sánh được: ${name} chiếm ${p1(sp)} ngân sách nhưng chỉ ${p1(tg)} số đơn gắn thẻ ` +
        `(lệch ${skewPct.toFixed(0)} điểm). Chênh lệch này gần như chắc chắn là do gắn thẻ, không phải do hiệu quả — ` +
        `so ROAS lúc này sẽ kết luận ngược hẳn sự thật.`,
      source,
      spendShare, tagShare, skewPct, underTagged, roas,
      action:
        `Chuẩn hoá gắn thẻ cho ${name} trước: mọi chiến dịch phải gắn UTM theo cùng một quy ước, ` +
        `và nguồn trong Odoo phải quy về MỘT tên duy nhất. Xong việc đó thì màn hình này mới so sánh được.`,
    };
  }

  // Tới đây mới được phép so.
  const gr = roas.google ?? 0, fr = roas.facebook ?? 0;
  const better = gr >= fr ? "Google" : "Facebook";
  const worse = better === "Google" ? "Facebook" : "Google";
  const hi = Math.max(gr, fr), lo = Math.min(gr, fr);
  const gapPct = lo > 0 ? ((hi - lo) / lo) * 100 : 0;

  if (gapPct < 15) {
    return {
      comparable: true,
      reason: `Hai nền tảng chênh nhau ${gapPct.toFixed(0)}% về ROAS thật (${gr.toFixed(2)}x so với ${fr.toFixed(2)}x) — chưa đáng kể.`,
      source,
      spendShare, tagShare, skewPct, underTagged: null, roas,
      action: "Giữ nguyên phân bổ ngân sách, theo dõi tiếp.",
    };
  }

  return {
    comparable: true,
    reason:
      `${better} đang hiệu quả hơn ${gapPct.toFixed(0)}% theo doanh thu thật từ Odoo ` +
      `(${hi.toFixed(2)}x so với ${lo.toFixed(2)}x). Độ phủ gắn thẻ hai bên tương đương nên con số này so sánh được.`,
    source,
    spendShare, tagShare, skewPct, underTagged: null, roas,
    action:
      `Cân nhắc dịch một phần ngân sách từ ${worse} sang ${better}. Kiểm tra khả năng mở rộng của ${better} ` +
      `trước khi tăng mạnh — ROAS cao ở quy mô nhỏ không tự giữ nguyên khi tăng gấp đôi. ` +
      `Đây là KHUYẾN NGHỊ, hệ thống không tự dịch ngân sách.`,
  };
}

/** Câu tóm tắt một dòng để hiện trên thẻ nhỏ. */
export function summarize(v: CoverageVerdict, g: PlatformOutcome, f: PlatformOutcome): string {
  if (!v.comparable) return v.reason;
  return `Google ${vnd(g.taggedRevenueVnd)} / ${vnd(g.spendVnd)} · Facebook ${vnd(f.taggedRevenueVnd)} / ${vnd(f.spendVnd)}`;
}

// ============================================================
// Bậc 4 — So mỗi nền tảng với CHÍNH NÓ, không so với nhau
// ============================================================
// Dùng khi KHÔNG có Odoo, KHÔNG có GA4, và hai nền tảng chưa thống nhất định
// nghĩa chuyển đổi — tức phần lớn trường hợp thực tế.
//
// Ý chính: câu hỏi "Google hay Facebook rẻ hơn" BẮT BUỘC phải có thước chung,
// nên khi không có thước chung thì đừng hỏi câu đó. Hỏi câu khác:
//
//   "Google đang tốt lên hay xấu đi so với CHÍNH NÓ kỳ trước?"
//   "Facebook đang tốt lên hay xấu đi so với CHÍNH NÓ kỳ trước?"
//
// Rồi dồn ngân sách về phía đang cải thiện. Không bao giờ so A với B trực
// tiếp, nên miễn nhiễm hoàn toàn với bẫy "mỗi bên đếm một tập sự kiện khác
// nhau" — vì Facebook kỳ này và Facebook kỳ trước dùng CÙNG một định nghĩa.
//
// Đánh đổi phải nói rõ: cách này KHÔNG trả lời được "nền tảng nào tốt hơn".
// Nó chỉ trả lời "nền tảng nào đang đi đúng hướng". Với việc phân bổ ngân
// sách hằng tuần thì câu sau thường hữu ích hơn, và quan trọng là nó ĐÚNG.

export interface PlatformTrend {
  platform: "google" | "facebook";
  /** Chi phí trên mỗi kết quả, kỳ TRƯỚC. Đơn vị tuỳ nền tảng, không so chéo. */
  costPerResultBefore: number | null;
  /** Cùng chỉ số đó, kỳ NÀY. */
  costPerResultAfter: number | null;
  /** Số kết quả kỳ này — để biết mẫu có đủ lớn không. */
  resultsAfter: number;
}

export interface SelfRelativeVerdict {
  /** Phần trăm thay đổi chi phí mỗi kết quả. Âm = rẻ đi = tốt lên. */
  changePct: { google: number | null; facebook: number | null };
  /** Nền tảng đang cải thiện rõ hơn, hoặc null khi không đủ căn cứ. */
  improving: "google" | "facebook" | null;
  reason: string;
  action: string;
}

/** Dưới ngưỡng này coi như đi ngang, không phải xu hướng. */
export const TREND_SIGNIFICANT_PCT = 15;
/** Tối thiểu số kết quả kỳ này để một xu hướng có nghĩa. */
export const MIN_RESULTS_FOR_TREND = 20;

function pctChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before <= 0) return null;
  return ((after - before) / before) * 100;
}

export function assessSelfRelative(google: PlatformTrend, facebook: PlatformTrend): SelfRelativeVerdict {
  const g = pctChange(google.costPerResultBefore, google.costPerResultAfter);
  const f = pctChange(facebook.costPerResultBefore, facebook.costPerResultAfter);
  const changePct = { google: g, facebook: f };

  const thin: string[] = [];
  if (google.resultsAfter < MIN_RESULTS_FOR_TREND) thin.push(`Google (${google.resultsAfter} kết quả)`);
  if (facebook.resultsAfter < MIN_RESULTS_FOR_TREND) thin.push(`Facebook (${facebook.resultsAfter} kết quả)`);
  if (thin.length) {
    return {
      changePct, improving: null,
      reason: `Chưa đủ dữ liệu để nói xu hướng: ${thin.join(", ")} — cần tối thiểu ${MIN_RESULTS_FOR_TREND} kết quả mỗi bên.`,
      action: "Chờ thêm dữ liệu hoặc nới khoảng thời gian. Giữ nguyên phân bổ ngân sách.",
    };
  }

  if (g === null || f === null) {
    return {
      changePct, improving: null,
      reason: "Một trong hai nền tảng không có chi phí mỗi kết quả ở kỳ trước để so.",
      action: "Kiểm tra việc đo chuyển đổi của nền tảng đó trước khi bàn tới ngân sách.",
    };
  }

  // Âm = chi phí mỗi kết quả GIẢM = tốt lên.
  const gBetter = g < f;
  const lead = Math.abs(g - f);
  const say = (n: number) => (n < 0 ? `rẻ đi ${Math.abs(n).toFixed(0)}%` : `đắt lên ${n.toFixed(0)}%`);

  if (lead < TREND_SIGNIFICANT_PCT) {
    return {
      changePct, improving: null,
      reason: `Hai nền tảng đang đi cùng hướng (Google ${say(g)}, Facebook ${say(f)}) — chênh nhau ${lead.toFixed(0)} điểm, chưa đáng kể.`,
      action: "Giữ nguyên phân bổ ngân sách.",
    };
  }

  const win = gBetter ? "Google" : "Facebook";
  const lose = gBetter ? "Facebook" : "Google";
  return {
    changePct,
    improving: gBetter ? "google" : "facebook",
    reason:
      `${win} đang cải thiện nhanh hơn: Google ${say(g)}, Facebook ${say(f)} so với kỳ trước của CHÍNH nó. ` +
      `Đây KHÔNG phải kết luận "${win} tốt hơn ${lose}" — hai bên đếm chuyển đổi theo định nghĩa khác nhau nên ` +
      `không so trực tiếp được. Chỉ là ${win} đang đi đúng hướng hơn.`,
    action:
      `Cân nhắc dịch một phần ngân sách sang ${win} và theo dõi kỳ tiếp. ` +
      `Nếu muốn so sánh TRỰC TIẾP hai nền tảng thì cần một thước chung — Odoo, GA4, ` +
      `hoặc cấu hình cho hai bên đếm cùng một tập sự kiện.`,
  };
}
