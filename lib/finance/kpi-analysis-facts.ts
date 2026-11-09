// ============================================================
// Số liệu nền cho nút "Phân tích AI" ở Dashboard → KPI Tổng Quan.
// ------------------------------------------------------------
// Nguyên tắc: MỌI CON SỐ ở đây do code tính, AI không được tính lại.
// AI chỉ đọc bảng số đã chốt rồi viết nhận định + đề xuất. Lý do:
//
//   1. Mô hình ngôn ngữ cộng trừ số tiền 9–10 chữ số sai rất êm — sai mà vẫn
//      trôi chảy, không có gì đỏ lên. Một câu "còn dư 120 triệu" bịa ra giữa
//      một đoạn văn đúng thì không ai soi lại.
//   2. Bảng KPI có ô "0đ" mang HAI nghĩa khác hẳn nhau: thật sự không tiêu
//      đồng nào, và CHƯA ĐO ĐƯỢC (Meta/Google/Odoo lỗi hoặc thiếu quyền —
//      xem các cờ *SourceError của /api/dashboard/kpi-actuals). Đưa số trần
//      cho AI mà không kèm cờ này thì nó sẽ khen "tháng 12 kiểm soát chi phí
//      tốt, chỉ dùng 0đ/320 triệu" — đúng kiểu bịa có vẻ hợp lý nhất.
//
// Nên ở đây mỗi đại lượng đều đi kèm `measured`, và tháng nào hụt nguồn thì
// nằm trong `dataGaps` để cả AI lẫn người đọc đều thấy.
// ============================================================

import { resolvePeriod } from "@/lib/finance/period";
import { kpiChannelLabel, type MonthKpi } from "@/lib/settings/kpi-store";
import { adChannels } from "@/lib/settings/ad-channels";
import type { MonthActual } from "@/app/api/dashboard/kpi-actuals/route";

// Kiểu + nhãn nằm ở .shared.ts để trình duyệt dùng được; re-export để nơi
// gọi cũ không phải đổi đường import.
export * from "@/lib/finance/kpi-analysis.shared";
import {
  type AnalysisChannel, type MonthStatus,
  type Metric, type ChannelFact, type CompanySpendFact, type MonthFact,
  type YtdFact, type KpiFacts,
} from "@/lib/finance/kpi-analysis.shared";

// Đợt 27: kênh theo sổ kênh (gốc + tự thêm). Kênh khai tay = mọi kênh không có API + "Kênh khác".
const channelName = (ch: string) => (ch === "other" ? "Kênh khác" : kpiChannelLabel(ch));
const isManual = (ch: string) => ch === "other" || adChannels().find((c) => c.key === ch)?.source === "manual";

// ── Helpers ───────────────────────────────────────────────────

const r0 = (n: number) => Math.round(n);
const pct = (a: number, b: number): number | null =>
  b > 0 ? Math.round((a / b) * 1000) / 10 : null;

function metric(target: number, actual: number | null, measured: boolean): Metric {
  const ok = measured && actual !== null;
  return {
    target: r0(target),
    actual: ok ? r0(actual) : null,
    measured: ok,
    pct: ok ? pct(actual, target) : null,
  };
}

const fmtMoney = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

// ── Tính số ───────────────────────────────────────────────────

function companySpendFact(
  company: string,
  target: number,
  budgetByChannel: Partial<Record<AnalysisChannel, number>> | undefined,
  side: MonthActual["mbc"] | MonthActual["mbi"] | null,
): CompanySpendFact {
  const googleErr = Boolean(side?.googleSpendError);
  const facebookErr = Boolean(side?.facebookSpendError);
  // Tổng chi chỉ coi là đo được khi CẢ HAI kênh API đều lấy được. Thiếu một
  // kênh thì tổng đang hụt đúng phần kênh đó — báo "đã dùng 60% trần" lúc ấy
  // là nói thay cho một con số mình không có.
  const measured = side !== null && !googleErr && !facebookErr;
  const spend = metric(target, side ? side.totalSpend : null, measured);

  const channels: ChannelFact[] = [...adChannels().map((c) => c.key), "other"].map(ch => {
    const budget = ch === "other" ? null : (budgetByChannel?.[ch] ?? 0);
    const actual = side ? (side.spendByChannel[ch] ?? 0) : 0;
    const chMeasured =
      side !== null &&
      !(ch === "google" && googleErr) &&
      !(ch === "facebook" && facebookErr);
    const overBy = chMeasured && budget !== null && budget > 0 && actual > budget
      ? r0(actual - budget)
      : 0;
    return {
      channel: ch,
      label: channelName(ch),
      budget: budget === null ? null : r0(budget),
      actual: r0(actual),
      measured: chMeasured,
      manualEntry: isManual(ch),
      overBy,
      usedPct: chMeasured && budget !== null && budget > 0 ? pct(actual, budget) : null,
    };
  });

  return {
    company,
    spend,
    remaining: measured && side ? r0(target - side.totalSpend) : null,
    manual: side ? r0(side.spendManual) : 0,
    channels,
  };
}

/**
 * Tháng đang chạy đã trôi qua bao nhiêu phần.
 *
 * Bắt buộc phải có, nếu không phần "còn lại bao nhiêu ngân sách" sẽ đọc sai
 * hoàn toàn: giữa tháng mà mới tiêu 47% trần là ĐÚNG NHỊP, nhưng đặt cạnh các
 * tháng trọn vẹn nó trông như đang tiêu ít bất thường. Dùng lại resolvePeriod
 * của lib/finance/period.ts — cùng cách đếm ngày mà P&L đang dùng, không tự
 * đếm một kiểu thứ hai.
 */
function monthProgress(year: number, month: number, now: Date): number | null {
  const p = resolvePeriod({ month: `${year}-${String(month).padStart(2, "0")}` }, now);
  if (p.daysInPeriod <= 0) return null;
  return Math.round((p.daysElapsed / p.daysInPeriod) * 1000) / 10;
}

export function buildKpiFacts(
  year: number,
  targets: MonthKpi[],
  actuals: (MonthActual | null)[],
  now = new Date(),
): KpiFacts {
  const isCurrentYear = year === now.getFullYear();
  const currentMonth = isCurrentYear ? now.getMonth() + 1 : null;
  const dataGaps: string[] = [];

  const months: MonthFact[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const t = targets[i];
    const a = actuals[i] ?? null;

    const revenueErr = Boolean(a?.mbc.revenueSourceError);
    const ordersErr = Boolean(a?.mbi.ordersSourceError);

    const revenueMbc = metric(t?.revenueMbc ?? 0, a ? a.mbc.revenue : null, a !== null && !revenueErr);
    const ordersMbi = metric(t?.ordersMbi ?? 0, a ? a.mbi.orders : null, a !== null && !ordersErr);
    const mbc = companySpendFact("MBC", t?.adSpendMbc ?? 0, t?.adSpendMbcByChannel, a?.mbc ?? null);
    const mbi = companySpendFact("MBI", t?.adSpendMbi ?? 0, t?.adSpendMbiByChannel, a?.mbi ?? null);

    const totalTarget = (t?.adSpendMbc ?? 0) + (t?.adSpendMbi ?? 0);
    const totalMeasured = mbc.spend.measured && mbi.spend.measured;
    const totalSpend = metric(
      totalTarget,
      totalMeasured ? (mbc.spend.actual ?? 0) + (mbi.spend.actual ?? 0) : null,
      totalMeasured,
    );

    // Tỉ lệ QC/DT — CHỈ MBC, đúng như dòng "Tỉ lệ QC/DT (MBC, auto)" trên bảng:
    // chi QC MBI không gắn với doanh thu MBC (hai công ty tách biệt). Lấy tổng
    // MBC+MBI ở đây sẽ cho ra một tỉ lệ khác hẳn con số người dùng đang nhìn
    // ngay phía trên — kiểm bằng số thật T8: 23,5% (sai) thay vì 19,1% (đúng).
    // Và chỉ tính khi CẢ hai vế đo được, thiếu một vế thì tỉ lệ trông vẫn bình
    // thường nhưng vô nghĩa.
    const ratioActual =
      mbc.spend.measured && revenueMbc.measured && (revenueMbc.actual ?? 0) > 0
        ? Math.round(((mbc.spend.actual ?? 0) / (revenueMbc.actual ?? 1)) * 1000) / 10
        : null;
    const ratioTarget =
      (t?.adSpendMbc ?? 0) > 0 && (t?.revenueMbc ?? 0) > 0
        ? Math.round(((t?.adSpendMbc ?? 0) / (t?.revenueMbc ?? 1)) * 1000) / 10
        : null;

    // ── Ghi nhận chỗ hụt nguồn ──
    if (a) {
      if (revenueErr) dataGaps.push(`T${m}: không lấy được doanh thu MBC (Odoo lỗi/timeout) — ô doanh thu đang là 0đ giả.`);
      if (ordersErr) dataGaps.push(`T${m}: không lấy được số đơn MBI — ô đơn hàng đang là 0 giả.`);
      if (a.mbc.googleSpendError) dataGaps.push(`T${m}: không lấy được chi phí Google của MBC.`);
      if (a.mbc.facebookSpendError) dataGaps.push(`T${m}: không lấy được chi phí Facebook của MBC.`);
      if (a.mbi.googleSpendError) dataGaps.push(`T${m}: không lấy được chi phí Google của MBI.`);
      if (a.mbi.facebookSpendError) dataGaps.push(`T${m}: không lấy được chi phí Facebook của MBI.`);
    }

    // ── Trạng thái tháng ──
    const progress = currentMonth === m ? monthProgress(year, m, now) : null;
    let status: MonthStatus;
    if (a === null) {
      status = "chua_toi";
    } else if (!revenueMbc.measured && !totalSpend.measured) {
      status = "chua_do_duoc";
    } else if (currentMonth === m) {
      status = "dang_chay";
    } else if (!revenueMbc.measured) {
      // Doanh thu là thứ quyết định đạt/không đạt. Không đo được doanh thu thì
      // phải nói đúng là "chưa đo được" — gộp chung với nhánh pct === null bên
      // dưới sẽ dán nhãn "Chưa đặt mục tiêu" cho một tháng ĐÃ đặt mục tiêu đầy
      // đủ, chỉ là Odoo lấy hụt. Kiểm bằng số thật: đúng cái nhãn sai đó.
      status = "chua_do_duoc";
    } else if (revenueMbc.pct === null) {
      status = "thieu_muc_tieu";
    } else if (revenueMbc.pct >= 100) {
      status = "dat";
    } else if (revenueMbc.pct >= 95) {
      status = "suyt_dat";
    } else {
      status = "khong_dat";
    }

    // ── Cờ bất thường, do code phát hiện ──
    const flags: string[] = [];
    for (const side of [mbc, mbi]) {
      if (side.remaining !== null && side.remaining < 0) {
        flags.push(`Chi QC ${side.company} vượt trần ${fmtMoney(Math.abs(side.remaining))} (${side.spend.pct}% kế hoạch).`);
      }
      for (const c of side.channels) {
        if (c.overBy > 0) {
          flags.push(`${side.company} · ${c.label} vượt trần ${fmtMoney(c.overBy)} (${c.usedPct}% trần kênh).`);
        }
      }
    }
    if (ratioActual !== null && ratioTarget !== null && ratioActual > ratioTarget) {
      flags.push(`Tỉ lệ QC/DT ${ratioActual}% cao hơn kế hoạch ${ratioTarget}%.`);
    }
    if (status === "dang_chay" && progress !== null && totalSpend.pct !== null && totalSpend.pct > progress + 10) {
      flags.push(`Tháng mới trôi ${progress}% số ngày nhưng đã tiêu ${totalSpend.pct}% ngân sách — đang tiêu nhanh hơn nhịp.`);
    }

    return { month: m, status, monthProgressPct: progress, revenueMbc, ordersMbi, mbc, mbi, totalSpend, ratioQcDt: { target: ratioTarget, actual: ratioActual }, flags };
  });

  // ── Cộng dồn từ đầu năm ──
  // Chỉ cộng tháng ĐO ĐƯỢC. Cộng cả tháng hụt nguồn vào tổng năm là cách chắc
  // chắn nhất để ra một con số "tổng đã tiêu" thấp hơn thực tế mà không ai biết.
  const countable = months.filter(f => f.status !== "chua_toi" && f.status !== "chua_do_duoc");
  const sum = (pick: (f: MonthFact) => Metric, wantMeasured = true) => {
    const rows = countable.filter(f => (wantMeasured ? pick(f).measured : true));
    return {
      months: rows.map(f => f.month),
      target: rows.reduce((s, f) => s + pick(f).target, 0),
      actual: rows.reduce((s, f) => s + (pick(f).actual ?? 0), 0),
    };
  };

  const rev = sum(f => f.revenueMbc);
  const ord = sum(f => f.ordersMbi);
  const sMbc = sum(f => f.mbc.spend);
  const sMbi = sum(f => f.mbi.spend);
  const sTot = sum(f => f.totalSpend);

  const yearBudgetTotal = r0(targets.reduce((s, t) => s + (t?.adSpendMbc ?? 0) + (t?.adSpendMbi ?? 0), 0));
  // MBC-only, cùng lý do như tỉ lệ theo tháng ở trên. VÀ chỉ cộng những tháng
  // đo được CẢ HAI vế: lấy tử số của 2 tháng chia cho mẫu số của 3 tháng thì ra
  // một tỉ lệ thấp giả — đã gặp đúng vậy khi thử với tháng mất chi phí Facebook
  // (ra 15,7% trong khi hai tháng đủ số liệu là 19,9% và 19,1%).
  const ratioMonths = months.filter(f => f.mbc.spend.measured && f.revenueMbc.measured);
  const ratioSpendActual = ratioMonths.reduce((s2, f) => s2 + (f.mbc.spend.actual ?? 0), 0);
  const ratioRevActual = ratioMonths.reduce((s2, f) => s2 + (f.revenueMbc.actual ?? 0), 0);
  const ratioSpendTarget = ratioMonths.reduce((s2, f) => s2 + f.mbc.spend.target, 0);
  const ratioRevTarget = ratioMonths.reduce((s2, f) => s2 + f.revenueMbc.target, 0);
  const ytdRatioActual = ratioRevActual > 0 && ratioSpendActual > 0
    ? Math.round((ratioSpendActual / ratioRevActual) * 1000) / 10
    : null;
  const ytdRatioTarget = ratioRevTarget > 0 && ratioSpendTarget > 0
    ? Math.round((ratioSpendTarget / ratioRevTarget) * 1000) / 10
    : null;

  const ytd: YtdFact = {
    coverage: {
      revenue: rev.months, orders: ord.months,
      spendMbc: sMbc.months, spendMbi: sMbi.months, totalSpend: sTot.months,
      ratio: ratioMonths.map(f => f.month),
    },
    monthsCounted: rev.months,
    revenueMbc: { target: r0(rev.target), actual: r0(rev.actual), measured: rev.months.length > 0, pct: pct(rev.actual, rev.target) },
    ordersMbi: { target: r0(ord.target), actual: r0(ord.actual), measured: ord.months.length > 0, pct: pct(ord.actual, ord.target) },
    spendMbc: { target: r0(sMbc.target), actual: r0(sMbc.actual), measured: sMbc.months.length > 0, pct: pct(sMbc.actual, sMbc.target) },
    spendMbi: { target: r0(sMbi.target), actual: r0(sMbi.actual), measured: sMbi.months.length > 0, pct: pct(sMbi.actual, sMbi.target) },
    totalSpend: { target: r0(sTot.target), actual: r0(sTot.actual), measured: sTot.months.length > 0, pct: pct(sTot.actual, sTot.target) },
    yearBudgetTotal,
    yearSpentSoFar: r0(sTot.actual),
    yearBudgetRemaining: r0(yearBudgetTotal - sTot.actual),
    ratioQcDt: { target: ytdRatioTarget, actual: ytdRatioActual },
  };

  return {
    year,
    asOf: now.toISOString(),
    currentMonth,
    currentMonthProgressPct: currentMonth ? monthProgress(year, currentMonth, now) : null,
    months,
    ytd,
    dataGaps,
  };
}
