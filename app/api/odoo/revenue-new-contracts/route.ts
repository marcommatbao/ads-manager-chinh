// ============================================================
// GET /api/odoo/revenue-new-contracts?month=YYYY-MM
// "MBN - SP Mua Mới" metric: new domain contract revenue.
// Source: mb.sale.report (invoice_date, net revenue)
// Filter: so_id.type_id.name in [...] + category_id in [Tên miền categ]
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { readGroup } from "@/lib/odoo-client";
import { getCurrentUser } from "@/lib/auth";

// Tên miền category IDs
const TEN_MIEN_CATEG_IDS = [28, 45, 46, 47];

// MBN - SP Mua Mới subscription type codes (from Odoo filter)
const SP_MUA_MOI_TYPES = [
  "1A_3", "2B_1", "2B_2", "1B_1",
  "2B_3", "2B_4", "3B_1", "3B_2", "4A_1",
];

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
  return {
    start: `${y}-${pad(mo)}-01`,
    end:   `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`,
  };
}

// Gộp theo `so_id`: mỗi đơn một dòng, `__count` là số dòng báo cáo của đơn đó.
// mb.sale.report là báo cáo theo DÒNG — bản cũ lấy `id:count` làm "số đơn".
// Đo tháng 9/2026 ngày 21/09: 7.258 dòng nhưng chỉ 1.840 ĐƠN thật, thổi lên
// gần 4 lần. Doanh thu thì KHÔNG đổi (690.093.000đ cả hai cách) — chỉ số đơn
// sai, nên lỗi này lọt lâu mà không ai thấy tổng tiền lệch.
interface AggRow { revenue: number; so_id: [number, string] | false; __count: number }

export interface NewContractRevenueResponse {
  month: string;
  revenue: number;
  /** Số ĐƠN riêng biệt, không phải số dòng báo cáo. */
  orders: number;
  /** Số dòng báo cáo — luôn ≥ `orders`. Giữ để đối chiếu với Odoo. */
  lines?: number;
  error?: string;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

  const cacheKey = `rev-new-contracts-v3:${month}`;
  const cached = fromCache(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const { start, end } = monthBounds(month);

    const domain: unknown[][] = [
      ["invoice_date",     ">=", start],
      ["invoice_date",     "<=", end],
      ["type",             "in", SP_MUA_MOI_TYPES],        // subscription type codes
      ["category_id",      "in", TEN_MIEN_CATEG_IDS],      // domain categories
      ["team_id.name",     "in", ["Ocean"]],               // Ocean sale team
      // source_subscription_type = "new" → First Contract (TODO: verify selection value)
    ];

    const rows = await readGroup(
      "mb.sale.report",
      domain,
      ["revenue:sum"],
      ["so_id"],
      { lazy: false }
    ) as AggRow[];

    const orderIds = new Set<number>();
    let revenue = 0;
    let lines   = 0;
    for (const row of rows) {
      if (Array.isArray(row.so_id)) orderIds.add(row.so_id[0]);
      revenue += row.revenue ?? 0;
      lines   += row.__count ?? 0;
    }

    const result: NewContractRevenueResponse = {
      month,
      revenue: Math.round(revenue),
      orders:  orderIds.size,
      lines,
    };

    setCache(cacheKey, result);
    return NextResponse.json(result);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[revenue-new-contracts] Odoo fetch failed:", msg);
    return NextResponse.json(
      { month, revenue: 0, orders: 0, error: `Không kết nối được Odoo ERP: ${msg}` },
      { status: 503 }
    );
  }
}
