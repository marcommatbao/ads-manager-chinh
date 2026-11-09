// ============================================================
// Kiểu dữ liệu + nhãn dùng CHUNG cho tính năng "Phân tích AI" của tab KPI.
// ------------------------------------------------------------
// Tách riêng vì khối này chạy ở CẢ HAI phía. kpi-analysis-facts.ts phải nằm
// lại phía máy chủ (nó dùng resolvePeriod → kpi-store → fs); trình duyệt mà
// import vào đó thì gói client kéo theo `fs` và build gãy — đúng lỗi đã gặp:
// tsc và eslint đều xanh, chỉ `next build` mới báo. Theo quy ước *.shared.ts
// sẵn có của repo (lib/budget-redistributor.shared.ts).
//
// Ở đây CHỈ được để kiểu và hằng số thuần. Không import gì ngoài kiểu
// (ngoại lệ: từ điển i18n — thuần, không kéo fs).
// ============================================================
import { makeT, type TFunction } from "@/lib/i18n/translate";

/** Kênh hiển thị = 4 kênh đặt được trần + "Kênh khác" (có chi nhưng không đặt trần). */
export const ANALYSIS_CHANNELS = ["google", "facebook", "tiktok", "zalo", "other"] as const;
/** Đợt 27: thêm kênh tự đặt (ChatGPT, Microsoft…) → mã kênh là chuỗi bất kỳ trong sổ kênh. */
export type AnalysisChannel = string;

/** Kênh không có API — số thực tế là do người khai tay ở Settings. */
export type MonthStatus =
  | "chua_toi"        // tháng tương lai, chưa có gì để nói
  | "chua_do_duoc"    // có tháng nhưng nguồn số liệu lỗi hết
  | "dang_chay"       // tháng hiện tại, số mới tới hôm nay
  | "thieu_muc_tieu"  // chưa đặt KPI nên không có gì để đối chiếu
  | "dat"
  | "suyt_dat"
  | "khong_dat";

export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  chua_toi: "Chưa tới",
  chua_do_duoc: "Chưa đo được",
  dang_chay: "Đang chạy",
  thieu_muc_tieu: "Chưa đặt mục tiêu",
  dat: "Đạt",
  suyt_dat: "Suýt đạt",
  khong_dat: "Không đạt",
};

/** Nhãn trạng thái tháng theo ngôn ngữ (MONTH_STATUS_LABEL giữ tiếng Việt). */
export const monthStatusLabel = (s: MonthStatus, t: TFunction = makeT("vi")): string => t(`libcase.r.ms.${s}` as never);

/** Một đại lượng đối chiếu kế hoạch ↔ thực tế. */
export interface Metric {
  target: number;
  actual: number | null;
  /** false = nguồn lỗi/chưa tới; `actual` khi đó KHÔNG phải số thật. */
  measured: boolean;
  /** % đạt so với kế hoạch; null khi chưa đo được hoặc chưa đặt mục tiêu. */
  pct: number | null;
}

export interface ChannelFact {
  channel: AnalysisChannel;
  label: string;
  /** Trần đặt ở Settings → KPI. null = kênh này không đặt trần được (Kênh khác). */
  budget: number | null;
  actual: number;
  measured: boolean;
  /** Số do người nhập tay chứ không phải hệ thống đo. */
  manualEntry: boolean;
  /** Vượt trần bao nhiêu đồng (>0 mới là vượt). Chỉ tính khi đo được và có trần. */
  overBy: number;
  usedPct: number | null;
}

export interface CompanySpendFact {
  company: string;
  spend: Metric;
  /** Trần − thực tế. Âm = đã vượt trần. null khi chưa đo được. */
  remaining: number | null;
  /** Phần chi phí do người khai tay trong tổng trên. */
  manual: number;
  channels: ChannelFact[];
}

export interface MonthFact {
  month: number;
  status: MonthStatus;
  /** Chỉ có ở tháng đang chạy: đã trôi qua bao nhiêu % số ngày. */
  monthProgressPct: number | null;
  revenueMbc: Metric;
  ordersMbi: Metric;
  mbc: CompanySpendFact;
  mbi: CompanySpendFact;
  /** Tổng chi QC (MBC+MBI) — dòng "Tổng Chi QC (auto)" trên bảng. */
  totalSpend: Metric;
  /** Chi QC / Doanh thu MBC, đơn vị %. */
  ratioQcDt: { target: number | null; actual: number | null };
  /** Điều bất thường do CODE phát hiện (không phải AI nghĩ ra). */
  flags: string[];
}

export interface YtdFact {
  /**
   * Cộng dồn chỉ lấy tháng ĐO ĐƯỢC, mà mỗi đại lượng hụt nguồn một kiểu khác
   * nhau: Odoo chết thì mất doanh thu nhưng chi phí quảng cáo vẫn đủ. Nên mỗi
   * tổng phải tự khai nó gồm những tháng nào — dùng chung một danh sách sẽ ra
   * cảnh tiêu đề ghi "gồm T1, T8, T9" trong khi ô tổng chi đã âm thầm cộng
   * thêm một tháng thứ tư (kiểm bằng số thật: đúng như vậy).
   */
  coverage: { revenue: number[]; orders: number[]; spendMbc: number[]; spendMbi: number[]; totalSpend: number[]; ratio: number[] };
  /** Danh sách tháng vào tổng doanh thu — mốc chính để biết có gì mà phân tích. */
  monthsCounted: number[];
  revenueMbc: Metric;
  ordersMbi: Metric;
  spendMbc: Metric;
  spendMbi: Metric;
  totalSpend: Metric;
  /** Ngân sách QC cả năm còn lại = tổng trần cả năm − đã tiêu (tháng đo được). */
  yearBudgetTotal: number;
  yearSpentSoFar: number;
  yearBudgetRemaining: number;
  ratioQcDt: { target: number | null; actual: number | null };
}

export interface KpiFacts {
  year: number;
  asOf: string;
  /** Tháng đang chạy (1–12) nếu `year` là năm hiện tại, ngược lại null. */
  currentMonth: number | null;
  currentMonthProgressPct: number | null;
  months: MonthFact[];
  ytd: YtdFact;
  /** Chỗ hụt nguồn — "0đ" ở những chỗ này KHÔNG có nghĩa là không tiêu. */
  dataGaps: string[];
}

// ── Kết quả AI trả về (dùng chung máy chủ ↔ trình duyệt) ──

export interface KpiAiRecommendation {
  priority: "cao" | "trung bình" | "thấp";
  title: string;
  detail: string;
  expectedImpact: string;
}

export interface KpiAiNarrative {
  headline: string;
  status: "on_track" | "at_risk" | "off_track";
  kpiAssessment: string;
  budgetAssessment: string;
  monthNotes: Array<{ month: number; note: string }>;
  recommendations: KpiAiRecommendation[];
  watchOuts: string[];
}
