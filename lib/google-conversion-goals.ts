// ============================================================
// Chốt mục tiêu chuyển đổi cho một chiến dịch
// ============================================================
// Bản cũ đặt `campaign.selective_optimization.conversion_actions` cho cả
// Search lẫn PMax. Google trả về:
//
//   The error code is not in this version.
//   (trường: ...campaign_operation.create.selective_optimization.conversion_actions)
//
// `selective_optimization` CHỈ dùng được cho chiến dịch Ứng dụng
// (advertising_channel_type MULTI_CHANNEL + subtype APP_CAMPAIGN). Với
// Search và Performance Max, cơ chế đúng là `campaign_conversion_goal`:
// mỗi chiến dịch có sẵn một bộ mục tiêu theo cặp (nhóm hành động, nguồn),
// và ta bật/tắt `biddable` trên từng cặp.
//
// Khác biệt quan trọng về NGHIỆP VỤ, không chỉ về kỹ thuật: Google chốt
// theo NHÓM hành động (PURCHASE, SUBMIT_LEAD_FORM…) chứ không theo từng
// hành động lẻ. Chọn "Purchase" nghĩa là bật cả nhóm mua hàng cùng nguồn
// đó — không thể tách riêng một hành động mua hàng này mà bỏ hành động mua
// hàng kia. Phải nói ra, đừng để người dùng tưởng mình chốt được chi tiết
// hơn thực tế.

import type { Customer } from "google-ads-api";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GaqlRow = Record<string, any>;

export interface ConversionGoalReport {
  applied: boolean;
  /** Cặp (nhóm, nguồn) lệnh này ĐỔI sang bật. */
  enabled: string[];
  /** Cặp lệnh này ĐỔI sang tắt. */
  disabled: string[];
  /** TRẠNG THÁI CUỐI: những cặp đang bật sau khi xong, kể cả cặp vốn đã bật
   *  sẵn nên không cần đổi.
   *
   *  VÌ SAO PHẢI CÓ RIÊNG: `enabled` chỉ đếm số nhóm BỊ ĐỔI. Nhóm vốn đã bật
   *  đúng từ trước thì vòng lặp bỏ qua (`if (cg.biddable === shouldBid) continue`),
   *  nên không vào `enabled`. Màn hình in "Bật 0 nhóm · tắt 11 nhóm" trong khi
   *  campaign thật sự đang bật PURCHASE — người đọc hiểu thành "không có mục
   *  tiêu nào", rồi đi sửa một thứ vốn đã đúng.
   *  Gặp thật ngày 19/09/2026 trên campaign "MBC - TÊN MIỀN TEST 777". */
  finalEnabled: string[];
  /** Nói rõ vì sao không làm được, thay vì im lặng bỏ qua. */
  error: string | null;
  /** Cảnh báo về giới hạn của cơ chế này. */
  notes: string[];
}

/**
 * Bật đúng những mục tiêu ứng với các hành động chuyển đổi đã chọn, tắt phần
 * còn lại. Gọi SAU khi chiến dịch đã được tạo — mục tiêu chỉ tồn tại khi đã
 * có chiến dịch.
 *
 * KHÔNG ném lỗi: chiến dịch đã tạo xong rồi, hỏng ở bước này thì báo ra để
 * người dùng tự chỉnh trong Google Ads, chứ không phải huỷ cả lần tạo.
 */
export async function applyCampaignConversionGoals(
  customer: Customer,
  opts: { campaignId: string; conversionActionResourceNames: string[] }
): Promise<ConversionGoalReport> {
  const report: ConversionGoalReport = { applied: false, enabled: [], disabled: [], finalEnabled: [], error: null, notes: [] };
  const wanted = opts.conversionActionResourceNames.filter(Boolean);
  if (wanted.length === 0) return report;

  // 1. Nhóm + nguồn của các hành động đã chọn.
  let pairs: Set<string>;
  try {
    const rows = (await customer.query(`
      SELECT conversion_action.resource_name, conversion_action.category, conversion_action.origin
      FROM conversion_action
      WHERE conversion_action.resource_name IN (${wanted.map((r) => `'${r.replace(/'/g, "")}'`).join(",")})
    `)) as unknown as GaqlRow[];
    pairs = new Set(
      rows.map((r) => `${r.conversion_action?.category}~${r.conversion_action?.origin}`)
    );
    if (pairs.size === 0) {
      report.error = "Không đọc được nhóm/nguồn của hành động chuyển đổi đã chọn.";
      return report;
    }
  } catch (e) {
    // google-ads-api ném GoogleAdsFailure (object), không phải Error — dùng
    // describeGoogleAdsError để bóc lỗi thật thay vì rơi về "lỗi không rõ".
    report.error = `Không đọc được hành động chuyển đổi: ${googleAdsErrorMessage(e)}`;
    return report;
  }

  // 2. Bộ mục tiêu sẵn có của chiến dịch.
  //    ĐỌC resource_name chứ không tự dựng: định dạng
  //    `{campaign_id}~{category}~{source}` phụ thuộc cách Google mã hoá enum,
  //    và tự đoán sai thì lệnh update đi vào một bản ghi không tồn tại.
  let goals: GaqlRow[];
  try {
    goals = (await customer.query(`
      SELECT campaign_conversion_goal.resource_name,
             campaign_conversion_goal.category,
             campaign_conversion_goal.origin,
             campaign_conversion_goal.biddable
      FROM campaign_conversion_goal
      WHERE campaign.id = ${Number(opts.campaignId)}
    `)) as unknown as GaqlRow[];
  } catch (e) {
    report.error = `Không đọc được mục tiêu chuyển đổi của chiến dịch: ${googleAdsErrorMessage(e)}`;
    return report;
  }

  if (goals.length === 0) {
    report.error = "Chiến dịch chưa có bộ mục tiêu chuyển đổi nào để chỉnh. Vào Google Ads đặt tay ở mục Goals của chiến dịch.";
    return report;
  }

  // Google TRẢ VỀ cả những goal có category/origin là UNKNOWN (vd
  // `{id}~UNKNOWN~GOOGLE_HOSTED`) nhưng lại TỪ CHỐI mọi lệnh update lên chúng:
  //   request_error 17 — "'UNKNOWN' part of the resource name is invalid."
  // Và vì cả lô update đi trong MỘT lệnh, đúng một dòng hỏng này làm Google
  // gạt CẢ LÔ — 11 goal hợp lệ còn lại cũng không được đặt, người dùng chỉ
  // thấy "KHÔNG đặt được mục tiêu chuyển đổi".
  //
  // Đo thật bằng validate_only trên tài khoản MBC ngày 18/09/2026, có đối
  // chứng: bỏ dòng UNKNOWN ra thì Google chấp nhận cả 11 lệnh còn lại; để
  // nguyên thì bị từ chối đúng câu trên.
  const SKIP_GOAL_RN = /~(UNKNOWN|UNSPECIFIED)(~|$)/;
  let skippedUnknown = 0;

  const ops: { resource_name: string; biddable: boolean }[] = [];
  for (const g of goals) {
    const cg = g.campaign_conversion_goal;
    const rn = cg?.resource_name as string | undefined;
    if (!rn) continue;
    if (SKIP_GOAL_RN.test(rn)) { skippedUnknown++; continue; }
    const key = `${cg.category}~${cg.origin}`;
    const shouldBid = pairs.has(key);
    // Trạng thái CUỐI — ghi trước, không phụ thuộc việc có đổi hay không.
    if (shouldBid) report.finalEnabled.push(key);
    if (cg.biddable === shouldBid) continue; // đã đúng, không cần đụng
    ops.push({ resource_name: rn, biddable: shouldBid });
    (shouldBid ? report.enabled : report.disabled).push(key);
  }

  if (skippedUnknown > 0) {
    report.notes.push(
      `Bỏ qua ${skippedUnknown} mục tiêu Google đánh dấu UNKNOWN — Google không cho sửa những dòng này, và nếu gửi kèm thì cả lô bị từ chối.`
    );
  }

  if (ops.length === 0) {
    report.applied = true;
    report.notes.push("Bộ mục tiêu của chiến dịch đã khớp sẵn với lựa chọn — không cần đổi gì.");
    return report;
  }

  try {
    await customer.campaignConversionGoals.update(ops);
    report.applied = true;
    report.notes.push(
      "Google chốt mục tiêu theo NHÓM hành động (mua hàng, gửi biểu mẫu…) chứ không theo từng hành động lẻ — chọn một hành động là bật cả nhóm cùng nguồn với nó."
    );
  } catch (e) {
    report.error = `Không đặt được mục tiêu chuyển đổi: ${googleAdsErrorMessage(e)}`;
  }
  return report;
}
