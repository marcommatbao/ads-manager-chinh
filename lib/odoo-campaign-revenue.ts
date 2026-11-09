// ============================================================
// P2 — Doanh thu THẬT từ Odoo, nối về chiến dịch quảng cáo
// ============================================================
// KHOÁ NỐI KHÔNG PHẢI TÊN CHIẾN DỊCH.
//
// Odoo lưu `campaign_id` là giá trị UTM (`domain_brand`, `vibe-hosting`), còn
// tên chiến dịch Google là `GS_Digital_Domain_Brand_HCM_01_11`. Hai thứ không
// nối thẳng được. Khoá thật là `utm_campaign` nằm trong final URL của quảng
// cáo — đo ngày 24/09: 59 giá trị utm_campaign thật trong URL quảng cáo
// Google, 25 campaign_id trong Odoo, KHỚP 9.
//
// 9 cái khớp đó gánh gần hết doanh thu gắn thẻ:
//   domain_brand   2.545 đơn · 1.352.900.084đ
//   vibe-hosting     259 đơn ·   101.429.338đ
//   domain           104 đơn ·    66.195.580đ
//   cloud_hosting     20 đơn ·    11.816.100đ
//
// NHIỀU-VỀ-MỘT, VÀ ĐÓ LÀ GIỚI HẠN KHÔNG VƯỢT ĐƯỢC.
// `domain_brand` được BẢY chiến dịch quảng cáo dùng chung. Nên doanh thu của
// thẻ đó KHÔNG chia được cho từng chiến dịch — không có dữ liệu nào nói đơn
// hàng đến từ chiến dịch nào trong bảy cái. Module này trả về con số của CẢ
// NHÓM kèm danh sách chiến dịch dùng chung, và nói thẳng là không chia được.
// Chia đều theo chi tiêu là bịa ra một con số trông như đo được.
//
// ĐỘ PHỦ PHẢI LUÔN ĐI KÈM. Đo 24/09: toàn hệ thống chỉ 6,5% số đơn và 2,1%
// doanh thu có gắn campaign_id. Một con ROAS Odoo đặt cạnh ROAS nền tảng mà
// không nói độ phủ sẽ khiến người đọc tưởng quảng cáo đang lỗ nặng, trong khi
// thật ra là 98% doanh thu không được gắn thẻ.
// ============================================================

import { readGroup } from "./odoo-client";

/** Tối thiểu số đơn gắn thẻ trước khi một con ROAS có nghĩa. */
export const MIN_ORDERS_FOR_REVENUE = 10;

export interface CampaignRevenue {
  /** Giá trị utm_campaign đã khớp được. */
  utmCampaign: string;
  orders: number;
  revenueVnd: number;
  /** Số chiến dịch quảng cáo CÙNG dùng thẻ này (kể cả chiến dịch đang xem). */
  sharedWithCampaigns: number;
  /** Con số này có chia riêng cho chiến dịch đang xem được không. */
  splittable: boolean;
}

export interface CampaignRevenueResult {
  /** Các thẻ khớp được. Rỗng = không nối được về Odoo. */
  matched: CampaignRevenue[];
  totalOrders: number;
  totalRevenueVnd: number;
  /** Đủ mẫu để hiện một con ROAS chưa. */
  reliable: boolean;
  /** Câu giải thích, LUÔN có — kể cả khi nối được. */
  note: string;
}

/** Bóc utm_campaign từ một final URL. Bỏ giá trị còn placeholder chưa thay. */
export function extractUtmCampaign(url: string): string | null {
  const m = String(url).match(/[?&]utm_campaign=([^&#]+)/i);
  if (!m) return null;
  let v: string;
  try { v = decodeURIComponent(m[1]); } catch { v = m[1]; }
  // `{_utmcampaign}`, `{campaignid}`… là ValueTrack của Google, chưa thay lúc
  // đọc qua API. Giữ lại là nối vào một thẻ không tồn tại.
  if (v.includes("{") || v.includes("}")) return null;
  return v.trim() || null;
}

/**
 * Doanh thu Odoo cho các thẻ utm_campaign của một chiến dịch.
 *
 * @param utmCampaigns các giá trị utm_campaign lấy từ final URL của chiến dịch
 * @param sharedCount  map thẻ → số chiến dịch quảng cáo cùng dùng thẻ đó
 * @param sinceDays    khoảng thời gian, mặc định 90 ngày (tính tới HÔM NAY)
 * @param window       khoảng ngày cố định "YYYY-MM-DD" (giờ VN) — có thì thắng sinceDays. Cần cho khoảng
 *                     trong QUÁ KHỨ: sinceDays chỉ chặn đầu, cộng dồn cả đơn tới hôm nay (sửa 28/09).
 */
export async function fetchCampaignRevenue(
  utmCampaigns: string[],
  sharedCount: Map<string, number> = new Map(),
  sinceDays = 90,
  window?: { from: string; to: string },
): Promise<CampaignRevenueResult> {
  const tags = Array.from(new Set(utmCampaigns.filter(Boolean)));
  if (tags.length === 0) {
    return {
      matched: [], totalOrders: 0, totalRevenueVnd: 0, reliable: false,
      note: "Chiến dịch này không gắn utm_campaign trong URL đích, nên không nối được về đơn hàng Odoo. "
          + "Thêm utm_campaign vào URL đích là điều kiện để đo doanh thu thật.",
    };
  }

  const since = window ? `${window.from} 00:00:00` : new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const until = window ? `${new Date(Date.parse(`${window.to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)} 00:00:00` : null;
  const rows = (await readGroup(
    "sale.order",
    [
      ["date_order", ">=", since],
      ...(until ? [["date_order", "<", until]] : []),
      ["state", "in", ["sale", "done"]],
      ["campaign_id", "!=", false],
    ],
    ["amount_total:sum"],
    ["campaign_id"],
  )) as Array<Record<string, unknown>>;

  const matched: CampaignRevenue[] = [];
  for (const r of rows) {
    const c = r.campaign_id;
    const name = Array.isArray(c) ? String(c[1] ?? "") : String(c ?? "");
    if (!tags.includes(name)) continue;
    const shared = sharedCount.get(name) ?? 1;
    matched.push({
      utmCampaign: name,
      orders: Number(r.__count ?? 0),
      revenueVnd: Number(r.amount_total ?? 0),
      sharedWithCampaigns: shared,
      splittable: shared <= 1,
    });
  }

  const totalOrders = matched.reduce((s, m) => s + m.orders, 0);
  const totalRevenueVnd = matched.reduce((s, m) => s + m.revenueVnd, 0);
  const reliable = totalOrders >= MIN_ORDERS_FOR_REVENUE;

  let note: string;
  if (matched.length === 0) {
    note = `Có gắn utm_campaign (${tags.slice(0, 3).join(", ")}) nhưng không đơn hàng Odoo nào trong `
         + `${sinceDays} ngày mang thẻ đó. Có thể chưa phát sinh đơn, hoặc thẻ trong Odoo ghi khác.`;
  } else if (!reliable) {
    note = `Chỉ ${totalOrders} đơn gắn thẻ trong ${sinceDays} ngày — dưới mức tối thiểu `
         + `${MIN_ORDERS_FOR_REVENUE} đơn để một con ROAS có nghĩa. Số hiện ra để tham khảo, chưa nên dùng ra quyết định.`;
  } else {
    const shared = matched.filter(m => !m.splittable);
    note = shared.length
      ? `Doanh thu này thuộc về thẻ ${shared.map(m => `"${m.utmCampaign}" (${m.sharedWithCampaigns} chiến dịch dùng chung)`).join(", ")} `
        + `— KHÔNG chia riêng được cho chiến dịch đang xem. Không có dữ liệu nào nói đơn hàng đến từ chiến dịch nào trong nhóm.`
      : `Thẻ chỉ dùng riêng cho chiến dịch này nên con số quy được trực tiếp.`;
  }

  return { matched, totalOrders, totalRevenueVnd, reliable, note };
}
