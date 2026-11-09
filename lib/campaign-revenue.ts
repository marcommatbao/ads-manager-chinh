// ============================================================
// Doanh thu THẬT theo nhãn campaign (Odoo)
// ------------------------------------------------------------
// Đây là lần đầu tool đo được KẾT QUẢ KINH DOANH gắn với quảng cáo, chứ không
// chỉ đo chi tiêu và conversion do nền tảng tự khai.
//
// Vì sao ở cấp NHÃN CAMPAIGN chứ không phải cấp phân khúc:
//  - Đo thật 25/08: `sale.order.campaign_id` là many2one tới `utm.campaign`, và
//    giá trị thực tế là nhãn DÒNG SẢN PHẨM do người đặt tay — `domain_brand`,
//    `cloud_hosting`, `wp_hosting`, `microsoft365`, `google_workspace`, `zalo`.
//  - Odoo KHÔNG có trường nào chứa được utm_content hay ad set id (đã liệt kê
//    toàn bộ trường của sale.order để kiểm). Muốn xuống cấp phân khúc thì phải
//    nhét id vào chính campaign_id — tức phá bộ nhãn mà báo cáo hiện tại đang
//    nhóm theo. Cái giá đó lớn hơn cái được.
//  - Nên dừng đúng ở cấp dữ liệu chịu được: nhãn campaign. Ở cấp này độ phủ rất
//    tốt — 97,9% đơn đến từ quảng cáo trả phí đều có campaign_id.
//
// ĐÍNH CHÍNH một niềm tin sai trong repo: chú thích ở lib/odoo-mbi-audience.ts
// nói MBC "không có bản ghi khách hàng, chỉ có Report API tổng hợp". Điều đó chỉ
// đúng với ĐƯỜNG Report API. Đo thật: đơn MBC tháng 8 nằm đầy đủ trong Odoo —
// Đo trên dữ liệu thật: tính trên TOÀN BỘ đơn thì chỉ khoảng 1/5 có campaign_id
// — không mâu thuẫn với 97,9% ở trên, vì 97,9% đó chỉ tính trong nhóm đơn đến từ
// quảng cáo trả phí. (Số tuyệt đối đã bỏ khỏi chú thích vì repo ở trạng thái công khai.)
//
// KHÔNG gọi Meta/Google. Chỉ đọc Odoo.
// ============================================================

import { readGroup } from "@/lib/odoo-client";
import { log } from "@/lib/logger";

/** Loại đơn thuộc MBC — cùng định nghĩa mà revenue-by-product dùng. */
const MBC_TYPE_NAMES = ["MBN Overdue", "MBN"];

export interface CampaignRevenueRow {
  campaign: string;
  orders: number;
  revenue: number;
  /** Doanh thu trung bình mỗi đơn. */
  aov: number;
}

export interface CampaignRevenueReport {
  from: string;
  to: string;
  company: string /* mã công ty hoặc "ALL" */;
  rows: CampaignRevenueRow[];
  /** Tổng đơn trong kỳ, KỂ CẢ đơn không mang nhãn campaign nào. */
  totalOrders: number;
  totalRevenue: number;
  /** Đơn KHÔNG có campaign_id. Phần lớn là gia hạn tự động, khách cũ, điện
   *  thoại — những đường chưa bao giờ đi qua quảng cáo nên không có UTM để mà
   *  mất. Nói ra để không ai đọc "chỉ 20% đơn có nhãn" thành "tracking hỏng". */
  ordersWithoutCampaign: number;
  revenueWithoutCampaign: number;
  error: string | null;
}

interface OdooGroupRow {
  campaign_id: [number, string] | false;
  amount_untaxed: number;
  __count?: number;
  campaign_id_count?: number;
}

export async function getCampaignRevenue(
  from: string,
  to: string,
  company: string /* mã công ty hoặc "ALL" */ = "ALL",
): Promise<CampaignRevenueReport> {
  const base: unknown[][] = [
    ["date_order", ">=", `${from} 00:00:00`],
    ["date_order", "<=", `${to} 23:59:59`],
    ["state", "in", ["sale", "done"]],
  ];
  if (company === "MBC") base.push(["type_id.name", "in", MBC_TYPE_NAMES]);

  const empty: CampaignRevenueReport = {
    from, to, company, rows: [], totalOrders: 0, totalRevenue: 0,
    ordersWithoutCampaign: 0, revenueWithoutCampaign: 0, error: null,
  };

  // MBI: quy tắc lọc của MBI là theo NGƯỜI BÁN (team + customer_source), không
  // theo dòng sản phẩm. Trước đây nhánh này chạy KHÔNG có bộ lọc nào — tức trả
  // về toàn bộ đơn của cả hai công ty nhưng dán nhãn "MBI". Thà báo không đo
  // được còn hơn đưa ra một con số sai mà trông vẫn hợp lý.
  if (company === "MBI") {
    return {
      ...empty,
      error:
        "Chưa đo được doanh thu theo nhãn campaign cho MBI: đơn MBI phân loại theo người bán " +
        "(team + customer_source) chứ không theo dòng sản phẩm, nên không tách được bằng cùng " +
        "một bộ lọc. Xem MBC hoặc ALL.",
    };
  }

  try {
    const [withCampaign, all] = await Promise.all([
      readGroup(
        "sale.order",
        [...base, ["campaign_id", "!=", false]],
        ["amount_untaxed:sum", "id:count"],
        ["campaign_id"],
        { lazy: false },
      ) as Promise<OdooGroupRow[]>,
      readGroup(
        "sale.order",
        base,
        ["amount_untaxed:sum", "id:count"],
        [],
        { lazy: false },
      ) as Promise<Array<{ amount_untaxed: number; __count?: number }>>,
    ]);

    const rows: CampaignRevenueRow[] = withCampaign
      .filter((r) => Array.isArray(r.campaign_id))
      .map((r) => {
        const orders = r.__count ?? r.campaign_id_count ?? 0;
        const revenue = Math.round(r.amount_untaxed ?? 0);
        return {
          campaign: (r.campaign_id as [number, string])[1],
          orders,
          revenue,
          aov: orders > 0 ? Math.round(revenue / orders) : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const totalOrders = all[0]?.__count ?? 0;
    const totalRevenue = Math.round(all[0]?.amount_untaxed ?? 0);
    const taggedOrders = rows.reduce((n, r) => n + r.orders, 0);
    const taggedRevenue = rows.reduce((n, r) => n + r.revenue, 0);

    log.info("campaign_revenue", `Đọc ${rows.length} nhãn campaign`, {
      company, from, to, totalOrders, taggedOrders,
    });

    return {
      ...empty,
      rows,
      totalOrders,
      totalRevenue,
      ordersWithoutCampaign: totalOrders - taggedOrders,
      revenueWithoutCampaign: totalRevenue - taggedRevenue,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("campaign_revenue", `Không đọc được Odoo: ${message}`, { company });
    // Trả lỗi RÕ, không trả bảng rỗng — rỗng đọc thành "quảng cáo không mang về
    // đồng nào", một câu hoàn toàn khác.
    return { ...empty, error: message };
  }
}
