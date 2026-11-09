// ============================================================
// Daily KPI report — định dạng tin nhắn Telegram từ Company P&L.
// Phản chiếu dashboard "Hiệu quả chi phí theo công ty" (MBC + MBI):
//   chi phí QC (Google/FB/Tổng), thanh KPI (% so mục tiêu), chỉ số hiệu quả.
// Pure function (không I/O) → dễ test + tái dùng.
// ============================================================

import type { CompanyPnlResult } from "@/lib/finance/company-pnl";
import type { MonthKpi } from "@/lib/settings/kpi-store";

const nf = new Intl.NumberFormat("vi-VN");
const vnd = (v: number): string => `${nf.format(Math.round(v || 0))}đ`;
const num = (v: number): string => nf.format(Math.round(v || 0));

/**
 * Một dòng KPI có % so với mục tiêu, mirror logic <KpiBar> trên dashboard.
 *  - higherIsBetter (doanh thu/đơn): đạt cao = 🟢, thiếu = 🔴.
 *  - !higherIsBetter (chi QC):       vượt ngân sách = 🔴.
 * Không có mục tiêu (target ≤ 0) → báo "chưa đặt KPI" thay vì chia cho 0.
 */
function kpiLine(
  label: string,
  actual: number,
  target: number | undefined,
  money: boolean,
  higherIsBetter: boolean
): string {
  const f = money ? vnd : num;
  if (!target || target <= 0) {
    return `🎯 <b>${label}</b>: <i>chưa đặt KPI</i> · hiện ${f(actual)}`;
  }
  const pct = Math.round((actual / target) * 100);
  const diff = actual - target;
  const emoji = higherIsBetter
    ? pct >= 100 ? "🟢" : pct >= 80 ? "🟡" : "🔴"
    : pct > 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
  const note = higherIsBetter
    ? diff >= 0 ? `vượt ${f(diff)}` : `còn thiếu ${f(-diff)}`
    : diff >= 0 ? `vượt ${f(diff)}` : `còn ${f(-diff)}`;
  return `🎯 <b>${label}</b>: ${emoji} <b>${pct}%</b>\n    ${f(actual)} / ${f(target)} · ${note}`;
}

function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return `Tháng ${Number(m[2])}/${m[1]}`;
}

function nowIct(now: Date): string {
  return now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit", minute: "2-digit",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

const DIV = "━━━━━━━━━━━━━━━━";

/**
 * Build tin nhắn báo cáo KPI cuối ngày (HTML parse mode).
 * @param pnl  kết quả getCompanyPnl() — tháng hiện tại, tích lũy tới hôm nay.
 * @param kpi  mục tiêu KPI tháng (getMonthKpi) — cho các thanh %.
 * @param now  thời điểm gửi (để in timestamp giờ VN).
 */
export function buildKpiReportMessage(
  pnl: CompanyPnlResult,
  kpi: MonthKpi,
  now: Date
): string {
  const { MBC, MBI } = pnl;
  const lines: string[] = [];

  lines.push("📊 <b>BÁO CÁO KPI MARKETING — CUỐI NGÀY</b>");
  lines.push(`🗓 ${monthLabel(pnl.month)} · ${pnl.daysElapsed}/${pnl.daysInMonth} ngày`);
  if (MBC.revenueSourceError || MBI.ordersSourceError) {
    lines.push(
      "⚠️ <b>CẢNH BÁO: một phần dữ liệu bên dưới KHÔNG lấy được từ Report API</b> " +
      "(lỗi/timeout) — xem ghi chú ⚠️ trong từng mục, KHÔNG phải doanh thu/đơn thật bằng 0."
    );
  }
  lines.push(DIV);

  // ── MBC — đo theo doanh thu ──────────────────────────────
  lines.push("");
  lines.push("🏢 <b>MBC — đo theo doanh thu</b>");
  lines.push(`💰 Google: ${vnd(MBC.spendGoogle)}  |  Facebook: ${vnd(MBC.spendFacebook)}`);
  // Số nhập tay phải hiện riêng: người đọc báo cáo cần biết phần nào hệ thống đo
  // được, phần nào do người khai.
  if (MBC.spendManual > 0) {
    lines.push(`✍️ Nhập tay: ${vnd(MBC.spendManual)} (${MBC.manualBreakdown.map((b) => b.label).join(", ")})`);
  }
  lines.push(`💵 <b>Tổng chi phí: ${vnd(MBC.totalSpend)}</b>`);
  lines.push("");
  if (MBC.revenueSourceError) {
    lines.push(
      "🎯 <b>KPI Doanh thu</b>: ⚠️ <i>không lấy được dữ liệu (Report API lỗi/timeout)</i>"
    );
  } else {
    lines.push(kpiLine("KPI Doanh thu", MBC.revenue, kpi.revenueMbc, true, true));
  }
  lines.push(kpiLine("Ngân sách QC", MBC.totalSpend, kpi.adSpendMbc, true, false));
  lines.push("");
  if (MBC.revenueSourceError) {
    lines.push("⚠️ <i>Không lấy được doanh thu/số đơn thật của MBC (Report API lỗi/timeout) — bỏ qua, KHÔNG phải doanh thu 0.</i>");
  } else {
    lines.push(`📈 Doanh thu: <b>${vnd(MBC.revenue)}</b>`);
    lines.push(`🛒 Số đơn: <b>${num(MBC.orders)}</b>`);
    lines.push(`• Giá trị TB/đơn: ${vnd(MBC.aov)}`);
    lines.push(`• Chi phí TB/đơn: ${vnd(MBC.costPerOrder)}`);
    lines.push(`• Tỉ lệ QC/Doanh thu: ${MBC.adCostRatioPct}%`);
    lines.push(`• DT dự kiến tháng: ${vnd(MBC.projectedRevenue)}`);
  }
  lines.push(DIV);

  // ── MBI — đo theo đơn hàng ───────────────────────────────
  lines.push("");
  lines.push("🏢 <b>MBI — đo theo đơn hàng</b>");
  lines.push(`💰 Google: ${vnd(MBI.spendGoogle)}  |  Facebook: ${vnd(MBI.spendFacebook)}`);
  if (MBI.spendManual > 0) {
    lines.push(`✍️ Nhập tay: ${vnd(MBI.spendManual)} (${MBI.manualBreakdown.map((b) => b.label).join(", ")})`);
  }
  lines.push(`💵 <b>Tổng chi phí: ${vnd(MBI.totalSpend)}</b>`);
  lines.push("");
  if (MBI.ordersSourceError) {
    lines.push(
      "🎯 <b>KPI Đơn hàng</b>: ⚠️ <i>không lấy được dữ liệu (Report API lỗi/timeout)</i>"
    );
  } else {
    lines.push(kpiLine("KPI Đơn hàng", MBI.orders, kpi.ordersMbi, false, true));
  }
  lines.push(kpiLine("Ngân sách QC", MBI.totalSpend, kpi.adSpendMbi, true, false));
  lines.push("");
  if (MBI.ordersSourceError) {
    lines.push("⚠️ <i>Không lấy được số đơn thật của MBI (Report API lỗi/timeout) — bỏ qua, KHÔNG phải đơn hàng 0.</i>");
  } else {
    lines.push(`🛒 Số đơn: <b>${num(MBI.orders)}</b>`);
    lines.push(`• Chi phí TB/đơn: ${vnd(MBI.costPerOrder)}`);
    lines.push(`• Đơn dự kiến tháng: ${num(MBI.projectedOrders)}`);
  }
  lines.push("<i>MBI KPI = đơn hàng (không có doanh thu để tính AOV/%QC)</i>");
  lines.push(DIV);

  lines.push(`🤖 AdsCommand · ${nowIct(now)}`);

  return lines.join("\n");
}
