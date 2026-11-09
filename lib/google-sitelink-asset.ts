// ============================================================
// Tiện ích liên kết trang (Sitelink) cho campaign Search
// ------------------------------------------------------------
// Sitelink là 4–6 đường dẫn phụ hiện ngay dưới quảng cáo ("Bảng giá",
// "Đăng ký tên miền"…). Đây là tiện ích rẻ nhất mà tác dụng rõ nhất của quảng
// cáo Tìm kiếm: nó không tốn thêm tiền, chỉ làm mẩu quảng cáo cao hơn và cho
// người đọc nhảy thẳng vào đúng trang họ cần thay vì rơi vào trang chủ.
//
// Google KHÔNG tự gắn sitelink cho campaign mới. Campaign tạo bằng tool trước
// nay ra đời không có cái nào — không phải lỗi, chỉ là chưa ai làm bước đó,
// nên người dùng phải vào Google Ads gắn tay sau mỗi lần tạo.
//
// Tài khoản MBC và MBI đều đã có sẵn 40 sitelink do đội quảng cáo dựng, kèm
// mô tả và URL đầy đủ. Dùng lại là đúng: dựng sitelink mới cho mỗi campaign
// chỉ sinh ra bản trùng trong thư viện.
//
// Đo thật bằng validate_only trên tài khoản MBC ngày 18/09/2026:
//   ✅ gắn 1 · 4 · 8 · 10 · 12 · 15 · 20 sitelink — chấp nhận
//   ❌ gắn 25                                     — "The request would cause a
//        limit on the number of allowed resources of this type to be exceeded."
//   ❌ gắn cùng một sitelink hai lần trong một lô  — "Cannot mutate the same
//        resource twice in one request."
// Cả hai lỗi đều làm rớt CẢ LÔ, nên phải chặn TRƯỚC khi gửi.
// ============================================================

/** Trần đo được: 20 sitelink mỗi campaign. */
export const MAX_SITELINKS_PER_CAMPAIGN = 20;

/**
 * Google khuyến nghị tối thiểu 4 sitelink thì tiện ích mới đủ điều kiện hiển
 * thị — dưới mức đó Google thường không hiện cái nào. Đây là NGƯỠNG HIỂN THỊ,
 * không phải ngưỡng kỹ thuật: gắn 2 cái vẫn tạo được, chỉ là gần như không
 * bao giờ thấy chúng ngoài trang kết quả.
 */
export const SITELINK_MIN_TO_SERVE = 4;

export interface SitelinkPlan {
  links: Array<{ resourceName: string; fieldType: "SITELINK" }>;
  skipped: Array<{ label: string; reason: string }>;
  /** Cảnh báo gắn được nhưng nhiều khả năng không hiển thị. */
  warning: string | null;
}

/**
 * Chọn ra sitelink gắn được, khử trùng và cắt phần vượt trần.
 *
 * Trả về phần bỏ kèm lý do — người dùng đã tick chọn thì phải biết cái nào
 * không lên, chứ không phải mở Google Ads ra mới thấy thiếu.
 */
export function planSitelinkLinks(
  assets: Array<{ resourceName: string; linkText?: string }>,
  opts: { alreadyLinked?: number } = {},
): SitelinkPlan {
  const plan: SitelinkPlan = { links: [], skipped: [], warning: null };
  const budget = MAX_SITELINKS_PER_CAMPAIGN - (opts.alreadyLinked ?? 0);
  const seen = new Set<string>();

  for (const a of assets) {
    if (!a.resourceName) continue;
    if (seen.has(a.resourceName)) continue; // trùng → Google gạt cả lô
    seen.add(a.resourceName);

    const label = a.linkText || a.resourceName.split("/").pop() || "sitelink";
    if (plan.links.length >= budget) {
      plan.skipped.push({ label, reason: `Vượt trần ${MAX_SITELINKS_PER_CAMPAIGN} sitelink mỗi campaign của Google.` });
      continue;
    }
    plan.links.push({ resourceName: a.resourceName, fieldType: "SITELINK" });
  }

  const total = plan.links.length + (opts.alreadyLinked ?? 0);
  if (total > 0 && total < SITELINK_MIN_TO_SERVE) {
    plan.warning = `Mới có ${total} sitelink. Google thường chỉ hiển thị tiện ích này khi campaign có từ ${SITELINK_MIN_TO_SERVE} cái trở lên — gắn thêm ${SITELINK_MIN_TO_SERVE - total} cái nữa.`;
  }

  return plan;
}
