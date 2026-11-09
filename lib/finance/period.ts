// ─────────────────────────────────────────────
// Khoảng thời gian cho P&L: tháng hoặc tuần.
//
// Report API (count-revenue, count-sale-order-paid) nhận dateFrom/dateTo tuỳ ý —
// đã kiểm bằng dữ liệu thật: tháng 8/2026 trả 10.886 đơn, tuần 04–10/08 trả 3.213
// đơn. Ranh giới tháng là do phía mình tự tính, không phải giới hạn của API. Nên
// thêm chế độ tuần chỉ là chuyện dựng khoảng khác, không phải nguồn dữ liệu khác.
// ─────────────────────────────────────────────
import {
  getEffectiveMonthKpi, emptyChannelBudget,
  type MonthKpi, type ChannelBudget,
} from "@/lib/settings/kpi-store";
import { kpiChannelKeys } from "@/lib/settings/ad-channels";

export type PeriodMode = "month" | "week" | "rolling28";

export interface PeriodBounds {
  mode: PeriodMode;
  /** Khoá cache + hiển thị: "2026-08" hoặc "2026-08-18" (thứ Hai của tuần). */
  key: string;
  /** Nhãn tiếng Việt cho UI. */
  label: string;
  /** Số ngày của kỳ (28–31, hoặc 7). */
  daysInPeriod: number;
  /** Số ngày đã trôi qua — kỳ hiện tại thì tính tới hôm nay. */
  daysElapsed: number;
  /** YYYY-MM-DD cho API quảng cáo. */
  adFrom: string;
  adTo: string;
  /** ISO nửa mở [từ, đến) cho Report API. */
  isoFrom: string;
  isoTo: string;
  /** Tháng mà kỳ này thuộc về — chế độ tuần dùng để tra chi phí nhập tay. */
  monthKey: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Nửa đêm giờ địa phương → ISO, để khớp cách Report API cắt ngày. */
const isoAt = (d: Date) => `${ymd(d)}T00:00:00Z`;

/** Thứ Hai của tuần chứa `d`. Tuần Việt Nam/ISO: T2 → CN. */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay(); // 0=CN
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1));
  return out;
}

function monthBounds(month: string, now: Date): PeriodBounds {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) : now.getMonth() + 1;

  const daysInMonth = new Date(y, mo, 0).getDate();
  const isCurrent = y === now.getFullYear() && mo === now.getMonth() + 1;
  const daysElapsed = isCurrent ? now.getDate() : daysInMonth;

  const nextY = mo === 12 ? y + 1 : y;
  const nextMo = mo === 12 ? 1 : mo + 1;

  return {
    mode: "month",
    key: `${y}-${pad(mo)}`,
    label: `Tháng ${mo}/${y}`,
    daysInPeriod: daysInMonth,
    daysElapsed,
    adFrom: `${y}-${pad(mo)}-01`,
    adTo: isCurrent ? ymd(now) : `${y}-${pad(mo)}-${pad(daysInMonth)}`,
    isoFrom: `${y}-${pad(mo)}-01T00:00:00Z`,
    isoTo: `${nextY}-${pad(nextMo)}-01T00:00:00Z`,
    monthKey: `${y}-${pad(mo)}`,
  };
}

function weekBounds(anyDayInWeek: string, now: Date): PeriodBounds {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anyDayInWeek);
  const seed = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : now;
  const start = mondayOf(seed);
  const endExcl = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const lastDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isCurrent = today >= start && today < endExcl;
  const daysElapsed = isCurrent
    ? Math.floor((today.getTime() - start.getTime()) / 86400000) + 1
    : 7;

  return {
    mode: "week",
    key: ymd(start),
    label: `Tuần ${pad(start.getDate())}/${pad(start.getMonth() + 1)} – ${pad(lastDay.getDate())}/${pad(lastDay.getMonth() + 1)}/${lastDay.getFullYear()}`,
    daysInPeriod: 7,
    daysElapsed,
    adFrom: ymd(start),
    adTo: isCurrent ? ymd(today) : ymd(lastDay),
    isoFrom: isoAt(start),
    isoTo: isoAt(endExcl),
    // Chi phí nhập tay khoá theo tháng — lấy tháng của ngày đầu tuần để tra,
    // nhưng chế độ tuần KHÔNG cộng nó vào (xem company-pnl.ts).
    monthKey: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
  };
}

/**
 * 28 ngày trọn gần nhất, KẾT THÚC HÔM QUA.
 *
 * Vì sao 28 chứ không phải 30: 28 = đúng 4 tuần chẵn, nên cửa sổ này và cửa sổ liền
 * trước đều có ĐÚNG 4 lần mỗi thứ. So tháng thì không được vậy — đã đo: T8 ngày 1–24
 * có 4 thứ Bảy + 4 Chủ nhật nhưng chỉ 3 thứ Tư/Năm/Sáu, T7 ngày 1–24 thì ngược lại.
 * Mà cuối tuần chỉ bán bằng 80% ngày thường (đo trên 2 tuần trọn gần nhất), nên riêng
 * lệch lịch đã ăn mất ~40,7 triệu trong khoảng chênh −167,6 triệu giữa hai tháng —
 * khoảng một phần tư con số đó là hiệu ứng lịch, không phải hiệu quả kém đi.
 *
 * Vì sao kết thúc hôm qua: hôm nay còn đang chạy. Nhét một ngày dở vào cửa sổ 28 ngày
 * rồi đem so với 28 ngày trọn là lặp lại đúng cái bẫy mà PNL-COMPARE-1 vừa xử, chỉ
 * nhỏ hơn. Đổi lại việc mất số hôm nay là một con số so sánh sạch.
 */
const ROLLING_DAYS = 28;

function rollingBounds(now: Date): PeriodBounds {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endExcl = today;                                              // hôm nay: loại
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ROLLING_DAYS);
  const lastDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return {
    mode: "rolling28",
    key: ymd(start),
    label: `28 ngày: ${pad(start.getDate())}/${pad(start.getMonth() + 1)} – ${pad(lastDay.getDate())}/${pad(lastDay.getMonth() + 1)}/${lastDay.getFullYear()}`,
    daysInPeriod: ROLLING_DAYS,
    daysElapsed: ROLLING_DAYS,
    adFrom: ymd(start),
    adTo: ymd(lastDay),
    isoFrom: isoAt(start),
    isoTo: isoAt(endExcl),
    monthKey: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
  };
}

/** `month` dạng YYYY-MM, `week` dạng YYYY-MM-DD (ngày bất kỳ trong tuần), `rolling` = 28 ngày trượt. */
export function resolvePeriod(
  params: { month?: string; week?: string; rolling?: boolean },
  now = new Date(),
): PeriodBounds {
  if (params.rolling) return rollingBounds(now);
  if (params.week) return weekBounds(params.week, now);
  return monthBounds(params.month ?? "", now);
}

export interface PeriodTargets extends MonthKpi {
  /** true khi con số là SUY RA từ KPI tháng chứ không phải ai đó đặt cho kỳ này. */
  derived: boolean;
  /** Câu giải thích cho UI, chỉ có khi derived. */
  derivedNote: string | null;
}

/**
 * Mục tiêu cho một kỳ.
 *
 * Chế độ tháng: trả thẳng KPI tháng, `derived: false`.
 *
 * Chế độ tuần: KPI chỉ tồn tại ở mức tháng, nên chia đều theo ngày. Quan trọng —
 * cộng theo TỪNG NGÀY của đúng tháng ngày đó thuộc về. Tuần 31/08–06/09 có 1 ngày
 * thuộc tháng 8 và 6 ngày thuộc tháng 9; lấy tháng của ngày thứ Hai rồi nhân 7 sẽ
 * sai 6/7 số ngày. Tuần 29/12–04/01 còn vắt qua hai NĂM.
 */
export function targetsForPeriod(b: PeriodBounds): PeriodTargets {
  if (b.mode === "month") {
    const [y, mo] = b.key.split("-").map(Number);
    // 12/10: trần THỰC TẾ = ngân sách cố định + khoản chi bổ sung của tháng (đối tác hỗ trợ / sản phẩm mới).
    return { ...getEffectiveMonthKpi(y, mo), derived: false, derivedNote: null };
  }

  const start = new Date(Number(b.key.slice(0, 4)), Number(b.key.slice(5, 7)) - 1, Number(b.key.slice(8, 10)));
  const acc = { revenueMbc: 0, adSpendMbc: 0, adSpendMbi: 0, ordersMbi: 0 };
  // Trần theo kênh cũng chỉ tồn tại ở mức tháng → chia đều theo ngày y hệt tổng,
  // nếu không thì thanh "kênh" và thanh "tổng" của cùng một tuần sẽ đo bằng hai
  // thước khác nhau.
  const accMbc: ChannelBudget = emptyChannelBudget(); // Đợt 27: gồm cả kênh tự thêm
  const accMbi: ChannelBudget = emptyChannelBudget();

  // Chạy theo daysInPeriod (7 cho tuần, 28 cho cửa sổ trượt) — cả hai đều có thể
  // vắt qua nhiều tháng nên phải cộng theo từng ngày của đúng tháng ngày đó thuộc về.
  for (let i = 0; i < b.daysInPeriod; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    const daysInThatMonth = new Date(y, mo, 0).getDate();
    const k = getEffectiveMonthKpi(y, mo); // gồm khoản chi bổ sung, chia đều theo ngày như phần cố định
    acc.revenueMbc += k.revenueMbc / daysInThatMonth;
    acc.adSpendMbc += k.adSpendMbc / daysInThatMonth;
    acc.adSpendMbi += k.adSpendMbi / daysInThatMonth;
    acc.ordersMbi  += k.ordersMbi  / daysInThatMonth;
    for (const ch of kpiChannelKeys()) {
      accMbc[ch] += (k.adSpendMbcByChannel[ch] ?? 0) / daysInThatMonth;
      accMbi[ch] += (k.adSpendMbiByChannel[ch] ?? 0) / daysInThatMonth;
    }
  }

  const roundChannels = (c: ChannelBudget): ChannelBudget => {
    const out: ChannelBudget = {};
    for (const ch of kpiChannelKeys()) out[ch] = Math.round(c[ch] ?? 0);
    return out;
  };

  return {
    revenueMbc: Math.round(acc.revenueMbc),
    adSpendMbc: Math.round(acc.adSpendMbc),
    adSpendMbi: Math.round(acc.adSpendMbi),
    // Đơn hàng là số nguyên; làm tròn lên để mục tiêu không bị nới lỏng do chia lẻ.
    ordersMbi: Math.ceil(acc.ordersMbi),
    adSpendMbcByChannel: roundChannels(accMbc),
    adSpendMbiByChannel: roundChannels(accMbi),
    extraSpend: [], // khoản bổ sung đã chia ngày vào adSpend* ở trên; danh sách gốc chỉ có ở mức tháng
    derived: true,
    derivedNote: "Suy từ KPI tháng, chia đều theo ngày — không phải mục tiêu ai đó đặt riêng cho tuần này",
  };
}

// ─────────────────────────────────────────────
// So sánh với kỳ trước
// ─────────────────────────────────────────────

export interface ComparePeriod extends PeriodBounds {
  /** Số ngày thực sự đem ra so — có thể ít hơn kỳ này nếu tháng trước ngắn hơn. */
  comparedDays: number;
  /** true khi phải cắt bớt vì tháng trước ngắn hơn (vd 31/03 so với tháng 2). */
  truncated: boolean;
}

/**
 * Kỳ liền trước, cắt đúng SỐ NGÀY ĐÃ TRÔI của kỳ này.
 *
 * Đây là phần quan trọng nhất của tính năng so sánh. Kỳ hiện tại luôn dở dang: sáng
 * thứ Hai thì tuần này mới có 1 ngày. Đem 1 ngày so với trọn 7 ngày của tuần trước
 * ra −98% — số đó xuất hiện mỗi sáng thứ Hai và mỗi ngày mùng 1, nên người dùng học
 * được đúng một điều là bỏ qua nó. Đo bằng số thật (con số tuyệt đối đã bỏ khỏi
 * chú thích vì repo ở trạng thái công khai): so 1 ngày đầu tuần này với TRỌN tuần
 * trước ra −98%, nhưng so 1 ngày với 1 ngày cùng vị trí trong tuần trước
 * (−84%) — mới là con số đáng đi xem.
 */
export function previousPeriod(b: PeriodBounds): ComparePeriod {
  const n = Math.max(1, b.daysElapsed);

  if (b.mode === "rolling28") {
    // Dịch lùi đúng 28 ngày. Giữ nguyên tính chất "4 lần mỗi thứ" nên hai cửa sổ
    // có thành phần thứ giống hệt nhau — đó là toàn bộ lý do tồn tại của chế độ này.
    const start = new Date(Number(b.key.slice(0, 4)), Number(b.key.slice(5, 7)) - 1, Number(b.key.slice(8, 10)));
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - ROLLING_DAYS);
    const prevEndExcl = start;
    const lastDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    return {
      mode: "rolling28",
      key: ymd(prevStart),
      label: `28 ngày trước đó: ${pad(prevStart.getDate())}/${pad(prevStart.getMonth() + 1)} – ${pad(lastDay.getDate())}/${pad(lastDay.getMonth() + 1)}`,
      daysInPeriod: ROLLING_DAYS,
      daysElapsed: ROLLING_DAYS,
      adFrom: ymd(prevStart),
      adTo: ymd(lastDay),
      isoFrom: isoAt(prevStart),
      isoTo: isoAt(prevEndExcl),
      monthKey: `${prevStart.getFullYear()}-${pad(prevStart.getMonth() + 1)}`,
      comparedDays: ROLLING_DAYS,
      truncated: false,
    };
  }

  if (b.mode === "week") {
    const start = new Date(Number(b.key.slice(0, 4)), Number(b.key.slice(5, 7)) - 1, Number(b.key.slice(8, 10)));
    const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
    const prevEndExcl = new Date(prevStart.getFullYear(), prevStart.getMonth(), prevStart.getDate() + n);
    const lastDay = new Date(prevStart.getFullYear(), prevStart.getMonth(), prevStart.getDate() + n - 1);
    return {
      mode: "week",
      key: ymd(prevStart),
      label: n === 7
        ? `Tuần ${pad(prevStart.getDate())}/${pad(prevStart.getMonth() + 1)} – ${pad(lastDay.getDate())}/${pad(lastDay.getMonth() + 1)}`
        : `${n} ngày đầu tuần trước (${pad(prevStart.getDate())}/${pad(prevStart.getMonth() + 1)} – ${pad(lastDay.getDate())}/${pad(lastDay.getMonth() + 1)})`,
      daysInPeriod: 7,
      daysElapsed: n,
      adFrom: ymd(prevStart),
      adTo: ymd(lastDay),
      isoFrom: isoAt(prevStart),
      isoTo: isoAt(prevEndExcl),
      monthKey: `${prevStart.getFullYear()}-${pad(prevStart.getMonth() + 1)}`,
      comparedDays: n,
      truncated: false,
    };
  }

  const [y, mo] = b.key.split("-").map(Number);
  const prevY = mo === 1 ? y - 1 : y;
  const prevMo = mo === 1 ? 12 : mo - 1;
  const daysInPrev = new Date(prevY, prevMo, 0).getDate();
  // Tháng trước ngắn hơn thì cắt và GẮN CỜ — xem 31/03 rồi so với tháng 2 (28 ngày)
  // mà không nói gì là lặng lẽ so 31 ngày với 28 ngày.
  const cmp = Math.min(n, daysInPrev);
  const truncated = cmp < n;

  const lastDay = new Date(prevY, prevMo - 1, cmp);
  const endExcl = new Date(prevY, prevMo - 1, cmp + 1);

  return {
    mode: "month",
    key: `${prevY}-${pad(prevMo)}`,
    // Nhãn phải lộ ra khi hai kỳ KHÔNG cùng số ngày. Ghi trống "Tháng 2/2026" thì
    // đúng về khoảng đã lấy nhưng giấu mất việc đang so 31 ngày với 28 ngày.
    label: truncated
      ? `Tháng ${prevMo}/${prevY} (${cmp} ngày — kỳ này ${n} ngày)`
      : cmp === daysInPrev
      ? `Tháng ${prevMo}/${prevY}`
      : `${cmp} ngày đầu tháng ${prevMo}/${prevY}`,
    daysInPeriod: daysInPrev,
    daysElapsed: cmp,
    adFrom: `${prevY}-${pad(prevMo)}-01`,
    adTo: ymd(lastDay),
    isoFrom: `${prevY}-${pad(prevMo)}-01T00:00:00Z`,
    isoTo: isoAt(endExcl),
    monthKey: `${prevY}-${pad(prevMo)}`,
    comparedDays: cmp,
    truncated,
  };
}

export interface MetricDelta {
  current: number;
  previous: number;
  diff: number;
  /** null khi không tính được nghĩa — xem noBaseline/lowBaseline. */
  pct: number | null;
  /** Kỳ trước bằng 0: mọi tỉ lệ đều vô nghĩa. */
  noBaseline: boolean;
  /** Kỳ trước quá nhỏ so với kỳ này: tỉ lệ ra số khổng lồ, không đọc được. */
  lowBaseline: boolean;
  /** Đã kẹp về ±300%. */
  clamped: boolean;
}

/** Ngưỡng lấy từ lib/pmax-insights/scoring.ts — không dựng thang thứ hai. */
const PCT_CLAMP = 300;
const LOW_BASELINE_RATIO = 0.05;

/** Hàm thuần: so hai con số, từ chối trả phần trăm khi nó không có nghĩa. */
export function compareMetric(current: number, previous: number): MetricDelta {
  const diff = current - previous;
  if (previous === 0) {
    return { current, previous, diff, pct: null, noBaseline: true, lowBaseline: false, clamped: false };
  }
  // Mốc quá nhỏ so với kỳ này thì tỉ lệ ra hàng nghìn phần trăm — đúng cái bẫy
  // trendLowBaseline của PMax đã chặn.
  if (previous > 0 && current > 0 && previous < current * LOW_BASELINE_RATIO) {
    return { current, previous, diff, pct: null, noBaseline: false, lowBaseline: true, clamped: false };
  }
  const raw = (diff / Math.abs(previous)) * 100;
  const clamped = Math.abs(raw) > PCT_CLAMP;
  return {
    current, previous, diff,
    pct: Math.round(Math.max(-PCT_CLAMP, Math.min(PCT_CLAMP, raw)) * 10) / 10,
    noBaseline: false, lowBaseline: false, clamped,
  };
}
