// ============================================================
// GET /api/odoo/revenue-by-product?month=YYYY-MM&company=MBC|MBI
// Revenue + order count per product group for one month.
//
// Source: mb.sale.report (Odoo custom report model)
//   - Uses invoice_date (Revenue Date), NOT sale order date
//   - revenue = price_total - refund_total (net, matches Odoo UI exactly)
//   - Filter by so_id.type_id.name to match Odoo "Tổng Hợp Doanh Thu" filter
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { readGroup } from "@/lib/odoo-client";
import {
  getGroupsForCompany,
  buildCategIdIndex,
  type ProductGroup,
} from "@/lib/odoo-product-categories";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { isCompany } from "@/lib/companies/registry";

// MBC order type names (confirmed via Odoo search: ID 6=MBN, ID 9=MBN Overdue)
const MBC_TYPE_NAMES = ["MBN Overdue", "MBN"];

// ── Cache ────────────────────────────────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { data: unknown; expiresAt: number }>();

function fromCache(key: string) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}
function setCache(key: string, data: unknown) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function monthBounds(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const now = new Date();
  const y  = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) : now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(mo)}-01`;
  const end   = `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`;
  return { start, end };
}

// mb.sale.report gộp theo (category_id, so_id).
//
// VÌ SAO GỘP HAI TẦNG: bản cũ chỉ gộp theo `category_id` rồi lấy `id:count`
// làm "số đơn". Nhưng mb.sale.report là báo cáo theo DÒNG — một đơn mua 5
// tên miền là 5 dòng. Đo trên MBC tháng 9/2026 ngày 21/09: 9.077 dòng nhưng
// chỉ 2.339 ĐƠN thật; riêng Tên miền in ra 8.765 "đơn" trong khi thật sự là
// 2.103 đơn — thổi lên 4,2 lần.
//
// Gộp thêm tầng `so_id` cho mỗi cặp (nhóm, đơn) một dòng, rồi đếm số đơn
// RIÊNG BIỆT. Trên cùng tháng đó: 3.353 cặp, 1,7 giây — rẻ hơn cả việc đọc
// 9.077 dòng thô, và tổng doanh thu vẫn khớp từng đồng với cách gộp cũ.
interface MbSaleRow {
  category_id: [number, string] | false;
  so_id: [number, string] | false;
  revenue: number;
  __count: number; // số dòng trong cặp này
}

// ── Public response shape ─────────────────────────────────────

export interface ProductCategoryRevenue {
  key: string;
  label: string;
  icon: string;
  revenue: number;
  /** Số ĐƠN riêng biệt. Một đơn mua nhiều sản phẩm chỉ tính MỘT lần. */
  orders: number;
  /** Số DÒNG báo cáo — luôn ≥ `orders`. Giữ lại để đối chiếu với Odoo. */
  lines: number;
  categoryIds: number[];
}

export interface RevenueByProductResponse {
  month: string;
  company: string;
  categories: ProductCategoryRevenue[];
  /** `orders` ở đây là số đơn riêng biệt TOÀN THÁNG — KHÔNG phải tổng cột
   *  `orders` của các nhóm. Một đơn mua cả tên miền lẫn hosting nằm ở hai
   *  nhóm, cộng cột lên sẽ đếm nó hai lần. */
  total: { revenue: number; orders: number; lines: number };
  error?: string;
}

// ── Main handler ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month   = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  const company = (searchParams.get("company") ?? "MBC") as string;

  if (!isCompany(company)) {
    return NextResponse.json({ error: "Công ty không có ở bản cài này" }, { status: 400 });
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  // v4: reverted v3's type_id-based "Matbao-Sign" group — confirmed 2026-07-25
  // that so_id.type_id=11 "matbaoSign" is an order CHANNEL tag, not a product:
  // its 5 real revenue rows this month were categorized under category_id
  // 54/55 ("Chữ ký số / RSS", "Chữ ký số / Addon RSS") — i.e. the money is
  // genuinely Chữ ký số revenue, just placed via a different app/channel.
  // Excluding it from the main query (as v3 did) UNDER-counted Chữ ký số by
  // that amount instead of correctly attributing it. Back to category_id-only.
  const cacheKey = `rev-by-product-v5:${company}:${month}`;
  const cached = fromCache(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const { start, end } = monthBounds(month);
    const groups     = getGroupsForCompany(company);
    const categIndex = buildCategIdIndex(company);

    // Query mb.sale.report — uses invoice_date and net revenue (price - refund)
    // This is the same source as Odoo's "Tổng Hợp Doanh Thu MBN Overdue & Ocean" report
    const domain: unknown[][] = [
      ["invoice_date", ">=", start],
      ["invoice_date", "<=", end],
    ];

    if (company === "MBC") {
      // Filter by sale order type — navigates so_id.type_id.name
      domain.push(["so_id.type_id.name", "in", MBC_TYPE_NAMES]);
    }

    // Gộp theo (nhóm sản phẩm, đơn) để đếm được ĐƠN chứ không phải DÒNG.
    const rows = await readGroup(
      "mb.sale.report",
      domain,
      ["revenue:sum"],
      ["category_id", "so_id"],
      { lazy: false }
    ) as MbSaleRow[];

    // Accumulate per product group
    const accumulator = new Map<string, { revenue: number; orders: Set<number>; lines: number; group: ProductGroup }>();
    for (const g of groups) {
      accumulator.set(g.key, { revenue: 0, orders: new Set(), lines: 0, group: g });
    }

    let otherRevenue = 0;
    let otherLines   = 0;
    const otherOrderIds = new Set<number>();
    /** Đơn riêng biệt toàn tháng — đếm ở đây, KHÔNG cộng cột của các nhóm. */
    const allOrderIds = new Set<number>();

    for (const row of rows) {
      const soId  = Array.isArray(row.so_id) ? row.so_id[0] : null;
      const lines = row.__count ?? 0;
      if (soId !== null) allOrderIds.add(soId);

      if (!Array.isArray(row.category_id)) continue;
      const categId = row.category_id[0];
      const group   = categIndex.get(categId);

      if (!group) {
        otherRevenue += row.revenue ?? 0;
        otherLines   += lines;
        if (soId !== null) otherOrderIds.add(soId);
        continue;
      }

      const acc = accumulator.get(group.key);
      if (!acc) continue;
      acc.revenue += row.revenue ?? 0;
      acc.lines   += lines;
      if (soId !== null) acc.orders.add(soId);
    }

    const categories: ProductCategoryRevenue[] = groups
      .map(g => {
        const acc = accumulator.get(g.key)!;
        return {
          key:         g.key,
          label:       g.label,
          icon:        g.icon,
          revenue:     Math.round(acc.revenue),
          orders:      acc.orders.size,
          lines:       acc.lines,
          categoryIds: g.categoryIds,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Doanh thu thì CỘNG được (mỗi dòng thuộc đúng một nhóm), nhưng số đơn
    // thì KHÔNG: một đơn nằm ở hai nhóm sẽ bị đếm hai lần. Lấy thẳng cỡ tập
    // đơn riêng biệt. Đo MBC 9/2026: cộng cột ra 2.383 còn số thật là 2.339.
    const total = {
      revenue: categories.reduce((n, c) => n + c.revenue, Math.round(otherRevenue)),
      orders:  allOrderIds.size,
      lines:   categories.reduce((n, c) => n + c.lines, otherLines),
    };

    const result: RevenueByProductResponse = { month, company, categories, total };
    setCache(cacheKey, result);
    return NextResponse.json(result);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[revenue-by-product] Odoo fetch failed:", msg);
    const result: RevenueByProductResponse = {
      month, company,
      categories: [],
      total: { revenue: 0, orders: 0, lines: 0 },
      error: `Không kết nối được Odoo ERP: ${msg}`,
    };
    return NextResponse.json(result, { status: 503 });
  }
}
