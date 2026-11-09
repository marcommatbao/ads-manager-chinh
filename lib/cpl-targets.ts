// ============================================================
// Mục tiêu CPL theo nhóm sản phẩm — nguồn duy nhất
// ============================================================
// Bảng này TỪNG được gõ tay ở hai nơi (app/api/improvements/route.ts và
// app/api/improvements/keywords/route.ts). Hai bản hiện còn giống hệt nhau,
// nhưng chúng là mốc để suy ra giá thầu và ngưỡng cảnh báo — lệch một con số
// là hai màn hình khuyên hai mức giá khác nhau cho cùng một từ khoá, mà
// không có gì báo. Gom về đây trước khi có người dùng thứ ba.
//
// Đây là mốc THAM CHIẾU nội bộ (B2B Việt Nam), dùng khi chiến dịch không tự
// khai target CPA. Chiến dịch nào có target_cpa thật của Google thì luôn ưu
// tiên số thật đó.

import { productGroupOf } from "@/lib/case/product";

/**
 * Ngưỡng CPL tham chiếu — ĐỌC TỪ BIẾN MÔI TRƯỜNG (đổi 17/09/2026).
 *
 * Vì sao chuyển ra env: repo này sẽ ở trạng thái công khai để nền tảng build
 * được. Các con số này không phải khoá bí mật, nhưng là thông tin kinh doanh —
 * chúng nói cho đối thủ biết Mắt Bão coi bao nhiêu tiền một khách hàng tiềm
 * năng là chấp nhận được, theo từng sản phẩm.
 *
 * Định dạng biến `CPL_TARGETS_JSON`, ví dụ:
 *   {"HOSTING":800000,"DOMAIN":500000,"DEFAULT":1000000}
 *
 * Thiếu biến hoặc JSON vỡ → mọi ngưỡng về 0 và ghi log. CỐ Ý không để số thật
 * làm giá trị dự phòng (để vậy thì số vẫn nằm trong repo), và cũng không đoán
 * một con số bừa — ngưỡng CPL sai sẽ khiến hệ thống báo động nhầm hoặc im lặng
 * khi đáng báo.
 */
function loadCplTargets(): Record<string, number> {
  const raw = process.env.CPL_TARGETS_JSON;
  if (!raw || !raw.trim()) {
    console.warn("[cpl-targets] Thiếu CPL_TARGETS_JSON — mọi ngưỡng CPL = 0, phần so ngưỡng sẽ không có nghĩa.");
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k.toUpperCase()] = n;
    }
    return out;
  } catch (err) {
    console.error("[cpl-targets] CPL_TARGETS_JSON không phải JSON hợp lệ:", err instanceof Error ? err.message : err);
    return {};
  }
}

export const CPL_TARGETS: Record<string, number> = loadCplTargets();

// So khớp bỏ dấu (lib/case/product.ts) — bản cũ so có dấu nên "Chứ Ký Số" gõ
// nhầm và "Hợp Đồng Điện Tử" rơi DEFAULT. Nhóm mới ECONTRACT chưa có key trong
// CPL_TARGETS_JSON thì getCPLTarget vẫn rơi về DEFAULT như trước.
export function detectProductGroup(campaignName: string): string {
  return productGroupOf(campaignName)
}

export function getCPLTarget(campaignName: string): number {
  // ?? 0 thay vì đoán: thiếu cấu hình thì trả 0 để chỗ gọi thấy rõ là "chưa có
  // ngưỡng", chứ không im lặng dùng một con số không ai đặt.
  return CPL_TARGETS[detectProductGroup(campaignName)] ?? CPL_TARGETS.DEFAULT ?? 0;
}
