// ============================================================
// Company P&L — gộp chi phí quảng cáo (Meta+Google) với doanh thu/đơn
// (Odoo Report API) theo THÁNG, tách MBC / MBI.
//
// MBC: đo bằng doanh thu (count-revenue typeId[6,9] → totalRevenue + totalCount=số đơn).
// MBI: đo bằng đơn hàng (count-sale-order-paid, filter MBI).
// Chi phí gán theo prefix tên campaign (đã thống nhất).
// ============================================================

import { gatherCampaignsWithStatus } from "@/lib/nba/gather";
import { detectCompany, platformOf } from "@/lib/nba/collectors/helpers";
import { getManualSpendForMonth, type MonthManualSpend, type ManualCompany } from "./manual-spend";
import { kpiChannelKeys } from "@/lib/settings/ad-channels";
import { getMonthKpi, extraSpendSummary } from "@/lib/settings/kpi-store";
import {
  resolvePeriod, targetsForPeriod, previousPeriod, compareMetric,
  type PeriodMode, type PeriodTargets, type PeriodBounds, type MetricDelta,
} from "./period";

// KHÔNG còn host mặc định trong mã (đổi 17/09/2026, chuẩn bị đưa repo lên công
// khai). Đây là API nội bộ KHÔNG YÊU CẦU XÁC THỰC và trả về doanh thu thật —
// để tên host trong một repo công khai là chỉ đường cho người ngoài đọc doanh
// thu Mắt Bão mà không cần bất kỳ khoá nào. Thiếu biến MATBAO_REPORT_API →
// báo lỗi rõ, KHÔNG rơi về host thật.
const REPORT_API = (process.env.MATBAO_REPORT_API ?? "").trim().replace(/\/+$/, "");

// Filter doanh thu MBC
const MBC_REVENUE_FILTER = { typeId: [6, 9] };
// Filter đơn MBI (theo spec đã đưa)
const MBI_ORDER_FILTER = {
  typeId:         [11, 4, 5, 2, 3, 1, 9, 6, 10],
  teamId:         [60, 59, 39, 35, 53, 42, 54, 50],
  customerSource: [17, 29, 16, 27, 243, 30],
};

/** Kênh chi phí thực tế: Google/Facebook đo qua API, TikTok/Zalo/Kênh khác do
 *  người nhập tay. Trần ngân sách (KPI_CHANNELS) chỉ có 4 kênh đầu — "other"
 *  luôn là chi phí không có trần, UI phải nói rõ thay vì gán đại vào kênh nào. */
export const SPEND_CHANNELS = ["google", "facebook", "tiktok", "zalo", "other"] as const;
/** Đợt 27: + kênh tự thêm (sổ kênh lib/settings/ad-channels.ts) — mã kênh là chuỗi. */
export type SpendChannel = string;
export type ChannelSpend = Record<string, number>;

/** Mọi kênh của sổ kênh + "other" = 0 (bản Mắt Bão chưa thêm kênh → đúng 5 khoá như trước). */
const emptyChannelSpend = (): ChannelSpend => Object.fromEntries([...kpiChannelKeys(), "other"].map((k) => [k, 0]));

/** Gộp chi phí đo được (Google/Facebook) với chi phí nhập tay thành một bảng
 *  theo kênh. Tổng bảng này luôn bằng totalSpend — không có kênh nào rơi rụng. */
function byChannel(google: number, facebook: number, manual: MonthManualSpend): ChannelSpend {
  const out: ChannelSpend = { ...emptyChannelSpend(), google: r0(google), facebook: r0(facebook) };
  for (const b of manual.breakdown) out[b.channel] = (out[b.channel] ?? 0) + r0(b.amount);
  return out;
}

export interface MbcPnl {
  company: "MBC";
  spendGoogle: number;
  spendFacebook: number;
  /** Chi phí kênh không có API (TikTok/Zalo…) do người nhập tay. Tách riêng để
   *  mọi nơi hiển thị nói được "trong tổng này có bao nhiêu là số nhập". */
  spendManual: number;
  manualBreakdown: MonthManualSpend["breakdown"];
  /** = google + facebook + manual — chi tiêu GỘP, so với trần (trần đã cộng tiền đối tác hỗ trợ). */
  totalSpend: number;
  /** 12/10: tiền đối tác hỗ trợ của tháng (Cài đặt → KPI → khoản chi bổ sung). 0 ở chế độ tuần / 28 ngày. */
  partnerSupport: number;
  /** Chi phí THẬT của công ty = totalSpend − partnerSupport (không âm). Chi phí/đơn và tỉ lệ QC/DT tính theo số này. */
  netSpend: number;
  /** Cùng số tiền như trên, tách theo từng kênh — để đối chiếu với trần ngân
   *  sách theo kênh đặt ở Settings → KPI. */
  spendByChannel: ChannelSpend;
  /** Có giá trị khi KHÔNG lấy được chi phí Facebook (vd Meta chặn vì vượt hạn
   *  mức gọi API). Lúc đó spendFacebook = 0 là "không đo được", không phải
   *  "không tiêu đồng nào" — UI phải nói khác nhau. */
  spendFacebookError: string | null;
  /** Chi phí Facebook là số CŨ đọc lúc này (Meta chặn hạn mức). Số đúng, không mới. */
  spendFacebookStaleAt: string | null;
  spendGoogleError: string | null;
  revenue: number;
  orders: number;          // = count-revenue.totalCount
  aov: number;             // doanh thu / đơn
  costPerOrder: number;    // tổng chi phí / đơn
  adCostRatioPct: number;  // tổng chi phí / doanh thu × 100
  projectedRevenue: number;
  // true khi count-revenue (Report API) fetch lỗi/timeout — revenue/orders/aov/...
  // ở trên đã bị coerce về 0, KHÔNG phải doanh thu thật bằng 0.
  revenueSourceError: boolean;
}

export interface MbiPnl {
  company: "MBI";
  spendGoogle: number;
  spendFacebook: number;
  spendManual: number;
  manualBreakdown: MonthManualSpend["breakdown"];
  /** = google + facebook + manual — chi tiêu GỘP, so với trần (trần đã cộng tiền đối tác hỗ trợ). */
  totalSpend: number;
  /** 12/10: tiền đối tác hỗ trợ của tháng (Cài đặt → KPI → khoản chi bổ sung). 0 ở chế độ tuần / 28 ngày. */
  partnerSupport: number;
  /** Chi phí THẬT của công ty = totalSpend − partnerSupport (không âm). Chi phí/đơn và tỉ lệ QC/DT tính theo số này. */
  netSpend: number;
  /** Cùng số tiền như trên, tách theo từng kênh — để đối chiếu với trần ngân
   *  sách theo kênh đặt ở Settings → KPI. */
  spendByChannel: ChannelSpend;
  /** Có giá trị khi KHÔNG lấy được chi phí Facebook (vd Meta chặn vì vượt hạn
   *  mức gọi API). Lúc đó spendFacebook = 0 là "không đo được", không phải
   *  "không tiêu đồng nào" — UI phải nói khác nhau. */
  spendFacebookError: string | null;
  /** Chi phí Facebook là số CŨ đọc lúc này (Meta chặn hạn mức). Số đúng, không mới. */
  spendFacebookStaleAt: string | null;
  spendGoogleError: string | null;
  orders: number;          // = count-sale-order-paid
  costPerOrder: number;
  projectedOrders: number;
  // true khi count-sale-order-paid (Report API) fetch lỗi/timeout — orders ở
  // trên đã bị coerce về 0, KHÔNG phải đơn hàng thật bằng 0.
  ordersSourceError: boolean;
}

export interface PnlComparison {
  /** Khoảng đem ra so, đã cắt đúng số ngày đã trôi của kỳ này. */
  label: string;
  comparedDays: number;
  /** true khi tháng trước ngắn hơn nên phải cắt — hai kỳ KHÔNG cùng số ngày. */
  truncated: boolean;
  MBC: { totalSpend: MetricDelta; revenue: MetricDelta; orders: MetricDelta };
  MBI: { totalSpend: MetricDelta; orders: MetricDelta };
}

export interface CompanyPnlResult {
  /** Giữ nguyên tên cũ cho đường tháng đang chạy: là monthKey của kỳ. */
  month: string;
  /** Giữ nguyên tên cũ: chế độ tuần thì bằng 7. */
  daysInMonth: number;
  daysElapsed: number;
  mode: PeriodMode;
  /** "2026-08" hoặc "2026-08-18" (thứ Hai của tuần). */
  periodKey: string;
  periodLabel: string;
  /** Mục tiêu của kỳ. Chế độ tuần: suy từ KPI tháng, `derived: true`. */
  targets: PeriodTargets;
  /** true khi chi phí nhập tay (TikTok/Zalo) KHÔNG được cộng vào — chỉ lưu được
   *  theo tháng nên chế độ tuần bỏ ra thay vì chia đều (chia đều là bịa). */
  manualExcluded: boolean;
  /** Chỉ có khi gọi với compare — mỗi lần so là thêm một lượt Meta + Google. */
  comparison?: PnlComparison;
  MBC: MbcPnl;
  MBI: MbiPnl;
  generatedAt: string;
  source: string;
}

// ─────────────────────────────────────────────
// Report API
// ─────────────────────────────────────────────

// Kết quả fetch phân biệt rõ "gọi API thất bại" (ok:false, kèm lý do) với
// "gọi API thành công và trả về giá trị thật" (ok:true) — kể cả khi giá trị
// thật đó là 0. Caller không được coerce lỗi thành số 0 một cách âm thầm.
type FetchResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function postJson<T>(path: string, body: unknown): Promise<FetchResult<T>> {
  // Báo rõ nguyên nhân: thiếu biến thì fetch("/count-revenue") chỉ quăng
  // "Failed to parse URL", không ai đoán được là do thiếu cấu hình.
  if (!REPORT_API) return { ok: false, error: "MATBAO_REPORT_API chưa cấu hình (mã không còn host mặc định) — không gọi được Report API." };
  try {
    const res = await fetch(`${REPORT_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "*/*" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() };
    return { ok: true, value: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/** Xuất riêng: /api/dashboard/unified dùng hàm này để lấy doanh thu MBC THẬT
 *  (Odoo) cho đúng khoảng ngày người dùng đang xem — Report API nhận
 *  dateFrom/dateTo tuỳ ý, không bị khoá theo ranh giới tháng (xem period.ts). */
export async function fetchMbcRevenue(
  isoFrom: string,
  isoTo: string
): Promise<{ revenue: number; orders: number; error?: string }> {
  const r = await postJson<{ data: { totalCount: number; totalRevenue: number } }>(
    "/api/Report/count-revenue",
    { ...MBC_REVENUE_FILTER, dateFrom: isoFrom, dateTo: isoTo }
  );
  if (!r.ok) return { revenue: 0, orders: 0, error: r.error };
  return { revenue: r.value?.data?.totalRevenue ?? 0, orders: r.value?.data?.totalCount ?? 0 };
}

/** Xuất riêng cùng lý do như fetchMbcRevenue ở trên — /api/dashboard/unified
 *  gọi lại đúng hàm này cho đơn hàng MBI THẬT thay vì tự tính. */
export async function fetchMbiOrders(
  isoFrom: string,
  isoTo: string
): Promise<{ orders: number; error?: string }> {
  const r = await postJson<{ data: number }>(
    "/api/Report/count-sale-order-paid",
    { ...MBI_ORDER_FILTER, dateOrderFrom: isoFrom, dateOrderTo: isoTo }
  );
  if (!r.ok) return { orders: 0, error: r.error };
  return { orders: r.value?.data ?? 0 };
}

// ─────────────────────────────────────────────
// Spend split (company × platform)
// ─────────────────────────────────────────────

interface SpendSplit {
  MBC: { google: number; facebook: number };
  MBI: { google: number; facebook: number };
  /** Nền tảng lấy hụt số. Có giá trị = con số 0 phía trên KHÔNG phải chi 0đ thật. */
  metaError: string | null;
  googleError: string | null;
  /** Số Meta là số CŨ đọc lúc này (bị chặn hạn mức nên dùng đệm). Số đúng,
   *  chỉ không mới. */
  metaStaleAt: string | null;
}

async function spendSplit(adFrom: string, adTo: string): Promise<SpendSplit> {
  const acc: SpendSplit = {
    MBC: { google: 0, facebook: 0 },
    MBI: { google: 0, facebook: 0 },
    metaError: null,
    googleError: null,
    metaStaleAt: null,
  };
  const { campaigns, metaError, googleError, metaStaleAt } = await gatherCampaignsWithStatus({ from: adFrom, to: adTo });
  acc.metaError = metaError;
  acc.googleError = googleError;
  acc.metaStaleAt = metaStaleAt;
  for (const c of campaigns) {
    const co = detectCompany(c);
    // P&L chỉ có cho MBC/MBI (gói Mắt Bão) — công ty khác bỏ qua thay vì đổ vỡ.
    const bucket = co ? (acc as unknown as Record<string, { google: number; facebook: number } | undefined>)[co] : undefined
    if (!bucket) continue;
    bucket[platformOf(c)] += c.metrics.spend ?? 0;
  }
  return acc;
}

const r0 = (n: number) => Math.round(n);

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

/** Chuỗi = tháng (giữ tương thích với cron KPI và kpi-actuals đang gọi kiểu cũ). */
export type PnlPeriodInput = string | { month?: string; week?: string; rolling?: boolean; compare?: boolean };

/** Số thô của MỘT kỳ. Tách riêng để kỳ trước đi đúng đường đo như kỳ này —
 *  hai đường khác nhau là hai chỗ để lệch. */
async function measurePeriod(b: PeriodBounds, manualExcluded: boolean) {
  const emptyManual: Record<ManualCompany, MonthManualSpend> = {
    MBC: { total: 0, breakdown: [] },
    MBI: { total: 0, breakdown: [] },
  };
  const [spend, mbcRev, mbiOrdersRes, manual] = await Promise.all([
    spendSplit(b.adFrom, b.adTo),
    fetchMbcRevenue(b.isoFrom, b.isoTo),
    fetchMbiOrders(b.isoFrom, b.isoTo),
    manualExcluded
      ? Promise.resolve(emptyManual)
      : getManualSpendForMonth(b.monthKey).catch((err) => {
          console.error(`[company-pnl] đọc chi phí nhập tay thất bại cho ${b.monthKey}:`, err);
          return emptyManual;
        }),
  ]);
  return { spend, mbcRev, mbiOrdersRes, manual };
}

export async function getCompanyPnl(period: PnlPeriodInput = ""): Promise<CompanyPnlResult> {
  const input = typeof period === "string" ? { month: period } : period;
  const b = resolvePeriod(input);

  // Chi phí nhập tay (TikTok/Zalo) chỉ lưu được theo THÁNG — một ô cho cả tháng.
  // Chế độ tuần không cộng nó vào: chia đều ra tuần là bịa, vì tháng đó có thể
  // chỉ chạy TikTok đúng một tuần. UI hiện ghi chú thay vì âm thầm thiếu số.
  // Cửa sổ trượt cũng vắt qua nhiều tháng nên càng không chia được — loại như tuần.
  const manualExcluded = b.mode !== "month";

  const prev = input.compare ? previousPeriod(b) : null;
  const [now_, before] = await Promise.all([
    measurePeriod(b, manualExcluded),
    prev ? measurePeriod(prev, manualExcluded) : Promise.resolve(null),
  ]);
  const { spend, mbcRev, mbiOrdersRes, manual } = now_;
  const mbiOrders = mbiOrdersRes.orders;

  if (mbcRev.error) {
    console.error(`[company-pnl] MBC count-revenue fetch failed for ${b.key}:`, mbcRev.error);
  }
  if (mbiOrdersRes.error) {
    console.error(`[company-pnl] MBI count-sale-order-paid fetch failed for ${b.key}:`, mbiOrdersRes.error);
  }

  const mbcTotal = spend.MBC.google + spend.MBC.facebook + manual.MBC.total;
  const mbiTotal = spend.MBI.google + spend.MBI.facebook + manual.MBI.total;
  // 12/10: tiền đối tác hỗ trợ lưu theo THÁNG (như chi phí nhập tay) → chỉ trừ ở chế độ tháng; tuần / 28 ngày không chia đều.
  const support = (() => {
    if (b.mode !== "month") return { MBC: 0, MBI: 0 };
    const [y, mo] = b.monthKey.split("-").map(Number);
    const ex = extraSpendSummary(getMonthKpi(y, mo));
    return { MBC: ex.MBC.partnerSupport, MBI: ex.MBI.partnerSupport };
  })();
  const mbcNet = Math.max(0, mbcTotal - support.MBC);
  const mbiNet = Math.max(0, mbiTotal - support.MBI);
  const proj = (v: number) => (b.daysElapsed > 0 ? r0((v / b.daysElapsed) * b.daysInPeriod) : r0(v));

  const MBC: MbcPnl = {
    company: "MBC",
    spendGoogle: r0(spend.MBC.google),
    spendFacebook: r0(spend.MBC.facebook),
    spendManual: r0(manual.MBC.total),
    manualBreakdown: manual.MBC.breakdown,
    totalSpend: r0(mbcTotal),
    partnerSupport: r0(support.MBC),
    netSpend: r0(mbcNet),
    spendByChannel: byChannel(spend.MBC.google, spend.MBC.facebook, manual.MBC),
    spendFacebookError: spend.metaError,
    spendFacebookStaleAt: spend.metaStaleAt,
    spendGoogleError: spend.googleError,
    revenue: r0(mbcRev.revenue),
    orders: mbcRev.orders,
    aov: mbcRev.orders > 0 ? r0(mbcRev.revenue / mbcRev.orders) : 0,
    // 12/10: chi phí thật (đã trừ đối tác hỗ trợ) — user chốt "P&L tính chi phí công ty = chi tiêu − hỗ trợ".
    costPerOrder: mbcRev.orders > 0 ? r0(mbcNet / mbcRev.orders) : 0,
    adCostRatioPct: mbcRev.revenue > 0 ? Math.round((mbcNet / mbcRev.revenue) * 1000) / 10 : 0,
    projectedRevenue: proj(mbcRev.revenue),
    revenueSourceError: Boolean(mbcRev.error),
  };

  const MBI: MbiPnl = {
    company: "MBI",
    spendGoogle: r0(spend.MBI.google),
    spendFacebook: r0(spend.MBI.facebook),
    spendManual: r0(manual.MBI.total),
    manualBreakdown: manual.MBI.breakdown,
    totalSpend: r0(mbiTotal),
    partnerSupport: r0(support.MBI),
    netSpend: r0(mbiNet),
    spendByChannel: byChannel(spend.MBI.google, spend.MBI.facebook, manual.MBI),
    spendFacebookError: spend.metaError,
    spendFacebookStaleAt: spend.metaStaleAt,
    spendGoogleError: spend.googleError,
    orders: mbiOrders,
    costPerOrder: mbiOrders > 0 ? r0(mbiNet / mbiOrders) : 0, // chi phí thật (đã trừ đối tác hỗ trợ)
    projectedOrders: proj(mbiOrders),
    ordersSourceError: Boolean(mbiOrdersRes.error),
  };

  return {
    month: b.monthKey,
    daysInMonth: b.daysInPeriod,
    daysElapsed: b.daysElapsed,
    mode: b.mode,
    periodKey: b.key,
    periodLabel: b.label,
    targets: targetsForPeriod(b),
    manualExcluded,
    ...(prev && before
      ? {
          comparison: {
            label: prev.label,
            comparedDays: prev.comparedDays,
            truncated: prev.truncated,
            MBC: {
              totalSpend: compareMetric(
                mbcTotal,
                before.spend.MBC.google + before.spend.MBC.facebook + before.manual.MBC.total,
              ),
              revenue: compareMetric(mbcRev.revenue, before.mbcRev.revenue),
              orders: compareMetric(mbcRev.orders, before.mbcRev.orders),
            },
            MBI: {
              totalSpend: compareMetric(
                mbiTotal,
                before.spend.MBI.google + before.spend.MBI.facebook + before.manual.MBI.total,
              ),
              orders: compareMetric(mbiOrders, before.mbiOrdersRes.orders),
            },
          },
        }
      : {}),
    MBC,
    MBI,
    generatedAt: new Date().toISOString(),
    source: "Meta+Google Ads + Odoo Report API"
      + (manual.MBC.total + manual.MBI.total > 0 ? " + chi phí kênh khác nhập tay" : ""),
  };
}
