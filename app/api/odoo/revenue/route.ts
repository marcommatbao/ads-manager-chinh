// ============================================================
// Odoo Revenue API Route
// GET /api/odoo/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&company=MBC|MBI|ALL
//
// Returns sales order + invoice aggregates from Odoo ERP.
// Returns an honest error when Odoo is unavailable — no fabricated data.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { searchRead, readGroup, clearSession } from "@/lib/odoo-client";
import { getCurrentUser } from "@/lib/auth";
import { MBI_TEAM_IDS, MBI_CUSTOMER_SOURCE_IDS } from "@/lib/mbi-order-sources";
import { getCompaniesForRole } from "@/lib/permissions";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface DayRevenue {
  date: string;
  revenue: number;
  orders: number;
}

interface ProductRevenue {
  name: string;
  revenue: number;
  orders: number;
}

interface RevenueData {
  totalRevenue: number;
  totalOrders: number;
  byDay: DayRevenue[];
  byProduct: ProductRevenue[];
  /** Đủ mọi trạng thái + tổng thật, để UI không phải tự bịa mẫu số. Odoo này
   *  còn có `draft` (đơn nháp) và `sent` (đã gửi báo giá) — trước đây bị bỏ ra
   *  khỏi cả bảng lẫn mẫu số, nên "13.324 đơn = 100% tổng đơn" là sai: 100% đó
   *  chỉ là 100% của ba trạng thái được chọn để hiện. */
  byStatus: {
    confirmed: number;
    done: number;
    cancelled: number;
    draft: number;
    sent: number;
    total: number;
  };
  period: string;
}

// Odoo read_group response shapes
interface OrderGroupRow {
  date_order: string;
  amount_untaxed: number;
  __count: number;
}

interface ProductGroupRow {
  product_id: [number, string] | false;
  price_subtotal: number;
  /** Odoo trả số dòng của nhóm ở `__count`; bản lazy-group đặt tên
   *  `<groupby>_count`. Nhận cả hai để không phụ thuộc cách gọi. */
  __count?: number;
  product_id_count?: number;
}

interface StatusGroupRow {
  state: string;
  __count: number;
}

// ─────────────────────────────────────────────
// 5-minute in-memory cache
// ─────────────────────────────────────────────

const cache = new Map<string, { data: RevenueData; expires: number }>();

// ─────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;

  const from    = searchParams.get("from")    ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const to      = searchParams.get("to")      ?? new Date().toISOString().split("T")[0];
  const requestedCompany = searchParams.get("company") ?? "ALL";

  // Clamp to what this role is actually allowed to see — "ALL" used to mean
  // "no company filter at all" regardless of role, leaking the other
  // company's revenue to a single-company viewer/admin by default.
  const allowedCompanies = getCompaniesForRole(user);
  if (requestedCompany !== "ALL" && !allowedCompanies.includes(requestedCompany as string)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }
  const company = requestedCompany === "ALL" && allowedCompanies.length === 1
    ? allowedCompanies[0]
    : requestedCompany;

  // Basic date validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { success: false, error: "Invalid date format. Use YYYY-MM-DD." },
      { status: 400 }
    );
  }

  const cacheKey = `${from}|${to}|${company}`;
  const cached   = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return NextResponse.json({ success: true, data: cached.data, cached: true });
  }

  // ── Lọc theo công ty ────────────────────────────────────────
  // Odoo này KHÔNG có công ty tên "MBC"/"MBI": `res.company` chỉ có
  // "Công ty Cổ phần Mắt Bão" và "Chi nhánh Công ty Cổ phần Mắt Bão"
  // (kiểm trực tiếp trên Odoo thật 2026-08-24). Nên `company_id.name ilike
  // "MBC"` mà bản cũ dùng khớp ĐÚNG 0 đơn — bấm nút MBC hay MBI đều ra bảng
  // rỗng, và rỗng đó trông y hệt "tháng này không có đơn nào".
  //
  // Dùng lại đúng định nghĩa đã có sẵn trong repo, không tự chế:
  //  - MBC = đơn thuộc loại MBN / MBN Overdue — cùng định nghĩa
  //    app/api/odoo/revenue-by-product dùng cho doanh thu MBC
  //    (`so_id.type_id.name`), ở đây là `type_id.name` vì query thẳng sale.order.
  //  - MBI = "Rule B" trong lib/mbi-order-sources.ts: team_id VÀ
  //    customer_source, đúng bộ mà orders-notify + Audience Builder đang dùng.
  const MBC_TYPE_NAMES = ["MBN Overdue", "MBN"];
  function companyClauses(prefix: "" | "order_id."): unknown[][] {
    if (company === "MBC") return [[`${prefix}type_id.name`, "in", MBC_TYPE_NAMES]];
    if (company === "MBI") {
      return [
        [`${prefix}team_id`, "in", MBI_TEAM_IDS],
        [`${prefix}customer_source`, "in", MBI_CUSTOMER_SOURCE_IDS],
      ];
    }
    return [];
  }

  try {
    // ── Build order domain ──────────────────────────────────────
    const orderDomain: unknown[][] = [
      ["date_order", ">=", `${from} 00:00:00`],
      ["date_order", "<=", `${to} 23:59:59`],
      ["state", "in", ["sale", "done"]],
    ];
    orderDomain.push(...companyClauses(""));

    // ── Build order-line domain ─────────────────────────────────
    const lineDomain: unknown[][] = [
      ["order_id.date_order", ">=", `${from} 00:00:00`],
      ["order_id.date_order", "<=", `${to} 23:59:59`],
      ["order_id.state", "in", ["sale", "done"]],
    ];
    lineDomain.push(...companyClauses("order_id."));

    // ── Status domain (all states, no filter on state) ──────────
    const statusDomain: unknown[][] = [
      ["date_order", ">=", `${from} 00:00:00`],
      ["date_order", "<=", `${to} 23:59:59`],
    ];
    statusDomain.push(...companyClauses(""));

    // ── Parallel Odoo queries ───────────────────────────────────
    const [orderGroups, productGroups, statusGroups] = await Promise.all([
      // Revenue + count grouped by calendar day
      readGroup(
        "sale.order",
        orderDomain,
        ["amount_untaxed:sum", "id:count"],
        ["date_order:day"],
        { orderby: "date_order asc" }
      ) as Promise<OrderGroupRow[]>,

      // Top products by revenue.
      // KHÔNG được thêm "product_id:count_distinct" vào đây: cú pháp field của
      // read_group là `alias:agg`, alias mặc định = tên field — nên nó GHI ĐÈ
      // `product_id` (vốn là [id, "tên"]) bằng chính con số đếm. Đã kiểm trên
      // Odoo thật 2026-08-24: mọi dòng trả về `product_id: 1`, và đó là lý do
      // biểu đồ "Top sản phẩm" hiện toàn nhãn "1" thay vì tên sản phẩm. Số
      // dòng của nhóm Odoo đã trả sẵn ở `__count`/`product_id_count`.
      readGroup(
        "sale.order.line",
        lineDomain,
        ["price_subtotal:sum"],
        ["product_id"],
        { orderby: "price_subtotal desc", limit: 10 }
      ) as Promise<ProductGroupRow[]>,

      // All order states for status breakdown
      readGroup(
        "sale.order",
        statusDomain,
        ["id:count"],
        ["state"]
      ) as Promise<StatusGroupRow[]>,
    ]);

    // ── Transform order groups → byDay ──────────────────────────
    const byDay: DayRevenue[] = orderGroups.map((g) => ({
      date:    (g.date_order ?? "").split(" ")[0],
      revenue: Math.round(g.amount_untaxed ?? 0),
      orders:  g.__count ?? 0,
    }));

    // ── Transform product groups → byProduct ────────────────────
    const byProduct: ProductRevenue[] = productGroups
      .filter((g) => g.product_id !== false)
      .map((g) => ({
        name:    Array.isArray(g.product_id) ? g.product_id[1] : String(g.product_id),
        revenue: Math.round(g.price_subtotal ?? 0),
        orders:  g.__count ?? g.product_id_count ?? 0,
      }));

    // ── Status breakdown ────────────────────────────────────────
    const statusMap: Record<string, number> = {};
    statusGroups.forEach((g) => {
      statusMap[g.state] = g.__count ?? 0;
    });

    const data: RevenueData = {
      totalRevenue: byDay.reduce((s, d) => s + d.revenue, 0),
      totalOrders:  byDay.reduce((s, d) => s + d.orders,  0),
      byDay,
      byProduct,
      byStatus: {
        confirmed: statusMap["sale"]   ?? 0,
        done:      statusMap["done"]   ?? 0,
        cancelled: statusMap["cancel"] ?? 0,
        draft:     statusMap["draft"]  ?? 0,
        sent:      statusMap["sent"]   ?? 0,
        total:     Object.values(statusMap).reduce((a, b) => a + b, 0),
      },
      period: `${from} → ${to}`,
    };

    cache.set(cacheKey, { data, expires: Date.now() + 5 * 60 * 1000 });
    return NextResponse.json({ success: true, data });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/odoo/revenue] Odoo fetch failed:", message);

    // On auth errors, clear the session so next request retries authentication
    if (message.includes("authentication failed") || message.includes("Access Denied")) {
      clearSession();
    }

    return NextResponse.json(
      { success: false, error: `Không kết nối được Odoo ERP: ${message}` },
      { status: 503 }
    );
  }
}
