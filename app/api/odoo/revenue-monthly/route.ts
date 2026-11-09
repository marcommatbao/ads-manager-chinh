// ============================================================
// Odoo Monthly Revenue Report API
// GET /api/odoo/revenue-monthly?months=6
//
// Pulls real monthly figures from the Mắt Bão Report API
// (Odoo-backed, host đọc từ biến MATBAO_REPORT_API), no auth required:
//   • count-sale-order-paid → số đơn MBI đã thanh toán / tháng
//   • count-revenue         → doanh số + số hoá đơn / tháng
//
// Returns a month-by-month series for the dashboard revenue chart.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// ─────────────────────────────────────────────
// Config — base URL + filter sets (from business spec)
// ─────────────────────────────────────────────

// KHÔNG còn host mặc định trong mã (đổi 17/09/2026, chuẩn bị đưa repo lên công
// khai). Đây là API nội bộ KHÔNG YÊU CẦU XÁC THỰC và trả về doanh thu thật —
// để tên host trong một repo công khai là chỉ đường cho người ngoài đọc doanh
// thu Mắt Bão mà không cần bất kỳ khoá nào. Thiếu biến MATBAO_REPORT_API →
// báo lỗi rõ, KHÔNG rơi về host thật.
const REPORT_API = (process.env.MATBAO_REPORT_API ?? "").trim().replace(/\/+$/, "");

// "Số đơn hàng MBI theo tháng" filters
const ORDER_FILTER = {
  typeId:         [11, 4, 5, 2, 3, 1, 9, 6, 10],
  teamId:         [60, 59, 39, 35, 53, 42, 54, 50],
  customerSource: [17, 29, 16, 27, 243, 30],
};

// "Doanh số theo tháng" filters
const REVENUE_FILTER = {
  typeId: [6, 9],
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MonthRevenue {
  month:        string; // "2026-05"
  monthLabel:   string; // "T5/2026"
  orders:       number; // paid sale orders (MBI)
  invoiceCount: number; // totalCount from revenue endpoint
  revenue:      number; // totalRevenue (VND)
}

interface MonthlyReport {
  months:       MonthRevenue[];
  totalRevenue: number;
  totalOrders:  number;
  avgRevenue:   number;
  source:       string;
  generatedAt:  string;
}

// ─────────────────────────────────────────────
// 10-minute in-memory cache
// ─────────────────────────────────────────────

const cache = new Map<string, { data: MonthlyReport; expires: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

interface MonthMeta {
  key:   string; // "2026-05"
  label: string; // "T5/2026"
  from:  string; // ISO start (UTC)
  to:    string; // ISO start of next month (UTC)
}

/** UTC month boundary [from, to) for a given calendar year + 0-based month index. */
function monthMeta(year: number, monthIndex0: number): MonthMeta {
  const start = new Date(Date.UTC(year, monthIndex0, 1));
  const end   = new Date(Date.UTC(year, monthIndex0 + 1, 1));
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  return {
    key:   `${y}-${String(m).padStart(2, "0")}`,
    label: `T${m}/${y}`,
    from:  start.toISOString().replace(".000Z", "Z"),
    to:    end.toISOString().replace(".000Z", "Z"),
  };
}

/** Parse "YYYY-MM" → {year, monthIndex0}, or null if malformed. */
function parseMonth(s: string | null): { year: number; m0: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const m0   = Number(match[2]) - 1;
  if (m0 < 0 || m0 > 11) return null;
  return { year, m0 };
}

/** Build the inclusive list of months to fetch from query params. */
function resolveMonths(
  from: string | null,
  to: string | null,
  monthCount: number
): MonthMeta[] {
  const a = parseMonth(from);
  const b = parseMonth(to);

  // Explicit range Từ→Đến (inclusive). Order auto-corrected; capped at 24.
  if (a && b) {
    let startIdx = a.year * 12 + a.m0;
    let endIdx   = b.year * 12 + b.m0;
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
    endIdx = Math.min(endIdx, startIdx + 23);
    const out: MonthMeta[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      out.push(monthMeta(Math.floor(i / 12), i % 12));
    }
    return out;
  }

  // Preset: last N months back from the current month (oldest → newest).
  const now = new Date();
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return Array.from({ length: monthCount }, (_, i) => {
    const idx = cur - (monthCount - 1 - i);
    return monthMeta(Math.floor(idx / 12), idx % 12);
  });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  // Báo rõ nguyên nhân thay vì để fetch quăng "Failed to parse URL".
  if (!REPORT_API) throw new Error("MATBAO_REPORT_API chưa cấu hình (mã không còn host mặc định) — không gọi được Report API.");
  const res = await fetch(`${REPORT_API}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", accept: "*/*" },
    body:    JSON.stringify(body),
    // Report API can be slow (~2-3s); give it room
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Report API ${path} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function fetchMonth(meta: MonthMeta): Promise<MonthRevenue> {
  const { key, label, from, to } = meta;

  const [orderRes, revRes] = await Promise.all([
    postJson<{ data: number }>("/api/Report/count-sale-order-paid", {
      ...ORDER_FILTER,
      dateOrderFrom: from,
      dateOrderTo:   to,
    }),
    postJson<{ data: { totalCount: number; totalRevenue: number } }>(
      "/api/Report/count-revenue",
      { ...REVENUE_FILTER, dateFrom: from, dateTo: to }
    ),
  ]);

  return {
    month:        key,
    monthLabel:   label,
    orders:       orderRes?.data ?? 0,
    invoiceCount: revRes?.data?.totalCount ?? 0,
    revenue:      revRes?.data?.totalRevenue ?? 0,
  };
}

// ─────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp          = request.nextUrl.searchParams;
  const from        = sp.get("from"); // "YYYY-MM" (optional explicit range)
  const to          = sp.get("to");
  const monthsParam = Number(sp.get("months") ?? "6");
  const monthCount  = Math.min(Math.max(Number.isFinite(monthsParam) ? monthsParam : 6, 1), 24);

  const metas = resolveMonths(from, to, monthCount);

  const cacheKey = `monthly|${metas[0]?.key ?? "?"}|${metas[metas.length - 1]?.key ?? "?"}|${metas.length}`;
  const cached   = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return NextResponse.json({ success: true, data: cached.data, cached: true });
  }

  try {
    const months = await Promise.all(metas.map(fetchMonth));

    const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
    const totalOrders  = months.reduce((s, m) => s + m.orders, 0);

    const data: MonthlyReport = {
      months,
      totalRevenue,
      totalOrders,
      avgRevenue:  months.length ? Math.round(totalRevenue / months.length) : 0,
      source:      "Odoo ERP (Mắt Bão Report API)",
      generatedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/odoo/revenue-monthly]", message);
    return NextResponse.json(
      { success: false, error: `Không lấy được dữ liệu doanh thu: ${message}` },
      { status: 502 }
    );
  }
}
