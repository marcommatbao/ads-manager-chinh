// ============================================================
// GET /api/odoo/mkt-revenue?month=2026-09&company=MBI
//
// Doanh thu + số đơn do MARKETING mang về, theo đúng cách ghi nhận của phòng
// MKT (xem lib/odoo-mkt-orders.ts cho bốn điều kiện và sáu nguồn).
// ------------------------------------------------------------
// THAY CHO ĐÂU: hai ô "TỔNG DOANH THU" / "TỔNG ĐƠN HÀNG" ở tab Chi Phí SP lấy
// từ /api/odoo/revenue-by-product, vốn chỉ lọc theo ngày hoá đơn — không lọc
// công ty, không lọc nguồn. Nó trả về TOÀN BỘ doanh thu công ty (13,37 tỷ cho
// MBI tháng 9) rồi chia cho chi phí quảng cáo ra ROAS 267,7x.
//
// Số thật: 41.268.450đ / 49 đơn → ROAS 0,83x. Quảng cáo đang LỖ.
//
// CHỈ ĐỌC. Không ghi gì vào Odoo.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { readGroup, searchRead } from "@/lib/odoo-client";
import { getGroupsForCompany, buildCategIdIndex } from "@/lib/odoo-product-categories";
import { mktOrderDomain, mktOrderLineDomain, MKT_SOURCES } from "@/lib/odoo-mkt-orders";

export const dynamic = "force-dynamic";

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const company = sp.get("company") === "MBC" ? "MBC" : "MBI";
  const month = sp.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  try {
    const { start, end } = monthBounds(month);

    // 1. Tổng theo ĐƠN — con số dùng cho ô lớn và cho ROAS.
    const orderAgg = (await readGroup(
      "sale.order",
      mktOrderDomain(start, end) as unknown[][],
      ["amount_untaxed:sum", "amount_total:sum"],
      [],
      { lazy: false },
    )) as unknown as Array<{ amount_untaxed?: number; amount_total?: number; __count?: number }>;
    const revenue = Math.round(orderAgg[0]?.amount_untaxed ?? 0);
    const orders = orderAgg[0]?.__count ?? 0;

    // 2. Theo NGUỒN — để thấy nguồn nào đang ra đơn.
    const bySourceRaw = (await readGroup(
      "sale.order",
      mktOrderDomain(start, end) as unknown[][],
      ["amount_untaxed:sum"],
      ["customer_source"],
      { lazy: false },
    )) as unknown as Array<{ customer_source?: [number, string] | false; amount_untaxed?: number; __count?: number }>;
    const bySource = bySourceRaw
      .map((r) => ({
        source: Array.isArray(r.customer_source) ? r.customer_source[1] : "(không rõ)",
        revenue: Math.round(r.amount_untaxed ?? 0),
        orders: r.__count ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // 3. Theo SẢN PHẨM — gom qua DÒNG đơn hàng. Đã đối chiếu: tổng theo dòng
    //    khớp chính xác tổng theo đơn.
    const lineRows = (await readGroup(
      "sale.order.line",
      mktOrderLineDomain(start, end) as unknown[][],
      ["price_subtotal:sum"],
      ["product_id"],
      { lazy: false },
    )) as unknown as Array<{ product_id?: [number, string] | false; price_subtotal?: number; __count?: number }>;

    // Odoo không cho read_group thẳng theo product_id.categ_id
    // ("Property name 'categ_id' has to be used on a property field"), nên đọc
    // danh mục của từng sản phẩm rồi tự gom.
    const productIds = lineRows
      .map((r) => (Array.isArray(r.product_id) ? r.product_id[0] : null))
      .filter((x): x is number => typeof x === "number");
    const products = productIds.length
      ? ((await searchRead("product.product", [["id", "in", productIds]], ["id", "categ_id"])) as unknown as
          Array<{ id: number; categ_id?: [number, string] | false }>)
      : [];
    const categOf = new Map<number, number>();
    for (const p of products) if (Array.isArray(p.categ_id)) categOf.set(p.id, p.categ_id[0]);

    const groups = getGroupsForCompany(company);
    const categIndex = buildCategIdIndex(company);
    const acc = new Map<string, { revenue: number; orders: number }>();
    for (const g of groups) acc.set(g.key, { revenue: 0, orders: 0 });
    let otherRevenue = 0;
    let otherOrders = 0;

    for (const r of lineRows) {
      const pid = Array.isArray(r.product_id) ? r.product_id[0] : null;
      const categId = pid != null ? categOf.get(pid) : undefined;
      const group = categId != null ? categIndex.get(categId) : undefined;
      const value = Math.round(r.price_subtotal ?? 0);
      const count = r.__count ?? 0;
      if (!group) {
        // KHÔNG nuốt vào tổng như route cũ. Trả riêng để màn hình nói được
        // "còn N đồng chưa phân loại", thay vì âm thầm cộng vào một nhóm nào đó.
        otherRevenue += value;
        otherOrders += count;
        continue;
      }
      const a = acc.get(group.key);
      if (!a) continue;
      a.revenue += value;
      a.orders += count;
    }

    const categories = groups
      .map((g) => ({
        key: g.key,
        label: g.label,
        icon: g.icon,
        revenue: acc.get(g.key)?.revenue ?? 0,
        orders: acc.get(g.key)?.orders ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      success: true,
      month,
      company,
      /** Tổng theo ĐƠN — dùng cho ô lớn và ROAS. KHÔNG cộng từ `categories`:
       *  một đơn có nhiều dòng sản phẩm, cộng dòng rồi gọi là "số đơn" là sai. */
      total: { revenue, orders },
      categories,
      unclassified: { revenue: otherRevenue, lines: otherOrders },
      bySource,
      /** Nói rõ con số này là gì, để không ai đọc nhầm thành doanh thu công ty. */
      basis: {
        sources: MKT_SOURCES,
        note: "Chỉ đơn do marketing mang về: đội M-*, đã thu tiền, không tính đơn đồng bộ, "
            + "và nguồn nằm trong 6 nguồn của phòng MKT. Tính theo NGÀY ĐẶT HÀNG, giá trị CHƯA THUẾ.",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Không đọc được doanh thu MKT: ${err instanceof Error ? err.message : "lỗi không rõ"}` },
      { status: 502 },
    );
  }
}
