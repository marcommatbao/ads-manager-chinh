import fs from "fs";
import path from "path";
import { getEffectiveMonthKpi } from "@/lib/settings/kpi-store";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CPLLevel {
  level: "good" | "warning" | "critical" | "no_data";
  emoji: string;
  label: string;
}

export interface CPLResult {
  cpl: number | null;
  level: CPLLevel["level"];
  label: string;
  pixelConversions: number;
  offlineOrders: number;
  totalConversions: number;
  onlineContribution?: number;
  offlineContribution?: number;
}

export interface CPLThresholds {
  good: number;
  warning: number;
  critical: number;
  labels: {
    good: string;
    warning: string;
    critical: string;
  };
  /** Ngưỡng này tính từ KPI tháng hiện tại, hay đang chạy trên số dự phòng?
   *
   *  `"kpi"`      — tính từ KPI tháng đã nhập. Đúng thứ ta muốn.
   *  `"fallback"` — KPI tháng CHƯA NHẬP, đang dùng số tĩnh đóng băng từ
   *                 tháng 7/2026. Mọi gợi ý CPL khi đó đang so với ngưỡng
   *                 của một tháng đã qua, và trước bản này KHÔNG có gì báo.
   *
   *  Phải trả ra ngoài chứ không giữ trong này: một ngưỡng sai thời điểm
   *  trông y hệt một ngưỡng đúng. */
  source: "kpi" | "fallback";
  /** Câu nói được cho người dùng khi đang chạy trên số dự phòng. */
  staleWarning?: string;
}

/** Đợt 21a: theo mã công ty của bản cài (bản Mắt Bão: MBC, MBI). */
export type CPLConfig = Record<string, CPLThresholds>;

export interface OfflineOrder {
  id: string;
  company: string | null;
  campaign_name: string;
  campaign_id?: string;
  product: string;
  orders_count: number;
  revenue?: number;
  period: string; // YYYY-MM
  source: "sale_team" | "erp";
  created_at: string;
}

// ─────────────────────────────────────────────
// Data Persistence paths
// ─────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), "data", "cpl-thresholds.json");
const ORDERS_FILE = path.join(process.cwd(), "data", "cpl-offline-orders.json");

// ─────────────────────────────────────────────
// Thresholds — auto-computed from Settings → KPI every month (by request,
// 2026-07-18). good/warning/critical are NOT stored — only what genuinely
// can't be derived is persisted: MBC's reference AOV (needed to convert a
// revenue target into an order count comparable to ad spend — MBI needs no
// such conversion, it's already order-denominated on both sides) and the
// display labels.
//
// Formula, recomputed on every read against the CURRENT month's KPI:
//   MBC breakeven = Chi QC KPI MBC ÷ (Doanh thu KPI MBC ÷ referenceAov)
//   MBI breakeven = Chi QC KPI MBI ÷ Đơn hàng KPI MBI
//   good    ≈ 80%  of breakeven (buffer to comfortably hit KPI)
//   warning ≈ 108% of breakeven (still plausibly recoverable)
//
// Accepted tradeoff (explicitly confirmed by the user, not an oversight):
// thresholds now shift whenever the month's KPI target changes — a flat CPL
// can flip from "good" to "warning" across a month boundary purely because
// the target moved, not because performance changed. Old defaults here
// (60K/150K, picked arbitrarily) were 2-7x off from what the real KPI
// targets implied — MBI's in particular meant almost every real campaign
// scored "critical" regardless of actual performance.
// ─────────────────────────────────────────────

export interface CPLSettings {
  MBC: { referenceAov: number; labels: CPLThresholds["labels"] };
  MBI: { labels: CPLThresholds["labels"] };
}

const DEFAULT_SETTINGS: CPLSettings = {
  MBC: {
    // AOV thật gần nhất quan sát được (Dashboard, 2026-07-18) — cập nhật ở
    // Settings → Doanh thu khi có số mới, đây chỉ là giá trị khởi tạo.
    referenceAov: 128792,
    labels: { good: "Tốt", warning: "Cần cải thiện", critical: "Nguy hiểm" },
  },
  MBI: {
    labels: { good: "Tốt", warning: "Cần cải thiện", critical: "Nguy hiểm" },
  },
};

const GOOD_RATIO = 0.8;
const WARNING_RATIO = 1.08;

// Static fallback for the rare case a breakeven can't be computed (KPI not
// set for the current month yet) — last known real numbers (tháng 7/2026),
// frozen rather than live, just so the app never shows a 0 or crashes.
const FALLBACK_GOOD: Record<string, number> = { MBC: 20000, MBI: 900000 };
const FALLBACK_WARNING: Record<string, number> = { MBC: 28000, MBI: 1200000 };

function readSettings(): CPLSettings {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      return {
        MBC: {
          referenceAov: Number(raw?.MBC?.referenceAov) > 0 ? Number(raw.MBC.referenceAov) : DEFAULT_SETTINGS.MBC.referenceAov,
          labels: raw?.MBC?.labels ?? DEFAULT_SETTINGS.MBC.labels,
        },
        MBI: { labels: raw?.MBI?.labels ?? DEFAULT_SETTINGS.MBI.labels },
      };
    }
  } catch (err) {
    console.warn("[CPL] Failed to read threshold settings, using default", err);
  }
  return DEFAULT_SETTINGS;
}

function writeSettings(settings: CPLSettings): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(CONFIG_FILE, JSON.stringify(settings, null, 2));
}

/** CPL cần đạt để chạm KPI tháng hiện tại — null nếu KPI tháng này chưa đặt. */
function computeBreakeven(company: string, settings: CPLSettings): number | null {
  const now = new Date();
  // 12/10 (user chốt): CPL mục tiêu tính trên trần THỰC TẾ = cố định + khoản chi bổ sung của tháng.
  const m = getEffectiveMonthKpi(now.getFullYear(), now.getMonth() + 1);

  if (company === "MBC") {
    const aov = settings.MBC.referenceAov;
    if (!aov || aov <= 0 || !m.revenueMbc || !m.adSpendMbc) return null;
    const ordersNeeded = m.revenueMbc / aov;
    return ordersNeeded > 0 ? m.adSpendMbc / ordersNeeded : null;
  }
  return m.ordersMbi > 0 && m.adSpendMbi > 0 ? m.adSpendMbi / m.ordersMbi : null;
}

function buildThresholds(company: string, settings: CPLSettings): CPLThresholds {
  const breakeven = computeBreakeven(company, settings);
  const good = breakeven ? Math.round(breakeven * GOOD_RATIO) : FALLBACK_GOOD[company];
  const warning = breakeven ? Math.round(breakeven * WARNING_RATIO) : FALLBACK_WARNING[company];
  const labels = company === "MBC" ? settings.MBC.labels : settings.MBI.labels;
  const now = new Date();
  return {
    good,
    warning,
    critical: warning + 1000,
    labels,
    source: breakeven ? "kpi" : "fallback",
    staleWarning: breakeven
      ? undefined
      : `Chưa nhập KPI tháng ${now.getMonth() + 1}/${now.getFullYear()} cho ${company}, `
        + `nên ngưỡng CPL đang dùng SỐ DỰ PHÒNG đóng băng từ tháng 7/2026 `
        + `(tốt ${FALLBACK_GOOD[company].toLocaleString("vi-VN")}₫ · cảnh báo ${FALLBACK_WARNING[company].toLocaleString("vi-VN")}₫). `
        + `Mọi gợi ý "CPL vượt ngưỡng" đang so với mục tiêu của một tháng đã qua. `
        + `Vào Cài đặt → Doanh thu & KPI nhập KPI tháng này để ngưỡng đúng lại.`,
  };
}

/** MBC's reference AOV — the one input the Settings UI still lets an admin edit. */
export function getCplReferenceAov(): number {
  return readSettings().MBC.referenceAov;
}

export function getCplThresholds(): CPLConfig {
  const settings = readSettings();
  return { MBC: buildThresholds("MBC", settings), MBI: buildThresholds("MBI", settings) };
}

/** Cập nhật referenceAov (MBC) và/hoặc nhãn hiển thị — good/warning/critical không lưu, luôn tính lại từ KPI. */
export function saveCplThresholds(patch: {
  MBC?: { referenceAov?: number; labels?: Partial<CPLThresholds["labels"]> };
  MBI?: { labels?: Partial<CPLThresholds["labels"]> };
}): CPLConfig {
  const current = readSettings();
  const next: CPLSettings = {
    MBC: {
      referenceAov: patch.MBC?.referenceAov ?? current.MBC.referenceAov,
      labels: { ...current.MBC.labels, ...patch.MBC?.labels },
    },
    MBI: {
      labels: { ...current.MBI.labels, ...patch.MBI?.labels },
    },
  };
  writeSettings(next);
  return getCplThresholds();
}

// ─────────────────────────────────────────────
// Logic Classification
// ─────────────────────────────────────────────

export function classifyCPL(
  cpl: number | null,
  company: string | null
): CPLLevel {
  if (cpl === null) {
    return { level: "no_data", emoji: "⚪", label: "Chưa có data" };
  }
  
  const thresholds = getCplThresholds();
  // If company is undetermined, fallback to MBC thresholds
  const t = thresholds[company ?? "MBC"];
  // Đợt 23: công ty chưa có ngưỡng CPL (bản cài khách — ngưỡng chỉ dựng cho MBC/MBI) → "chưa đặt ngưỡng", KHÔNG ném lỗi.
  // Trước đây `t` undefined → TypeError → bộ thu NBA bỏ CẢ tín hiệu CPL lẫn "chi tiền 0 chuyển đổi" của công ty đó, im lặng.
  if (!t) return { level: "no_data", emoji: "⚪", label: "Chưa đặt ngưỡng CPL" };

  if (cpl <= t.good) {
    return { level: "good", emoji: "🟢", label: t.labels.good };
  }
  if (cpl <= t.warning) {
    return { level: "warning", emoji: "🟡", label: t.labels.warning };
  }
  return { level: "critical", emoji: "🔴", label: t.labels.critical };
}

export function calcCPL(
  spend: number,
  pixelConversions: number,
  offlineOrders: number = 0
): CPLResult {
  const totalConversions = pixelConversions + offlineOrders;
  if (totalConversions <= 0) {
    return {
      cpl: null,
      level: "no_data",
      label: "Chưa có conversion",
      pixelConversions,
      offlineOrders,
      totalConversions: 0,
    };
  }

  const cpl = spend / totalConversions;
  return {
    cpl,
    level: "no_data", // gets populated downstream if needed or let UI call classify
    label: "",
    pixelConversions,
    offlineOrders,
    totalConversions,
    onlineContribution: (pixelConversions / totalConversions) * 100,
    offlineContribution: (offlineOrders / totalConversions) * 100,
  };
}

// ─────────────────────────────────────────────
// Offline Orders CRUD
// ─────────────────────────────────────────────

interface OrdersDB {
  orders: OfflineOrder[];
}

export function getOfflineOrders(): OfflineOrder[] {
  try {
    if (!fs.existsSync(ORDERS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(ORDERS_FILE, "utf-8");
    return (JSON.parse(raw) as OrdersDB).orders;
  } catch (err) {
    console.warn("[CPL] Failed to read offline orders", err);
    return [];
  }
}

export function getOfflineOrdersByMonth(month: string): OfflineOrder[] {
  return getOfflineOrders().filter((o) => o.period === month);
}

export function saveOfflineOrder(input: Omit<OfflineOrder, "id" | "created_at">): OfflineOrder {
  const allOrders = getOfflineOrders();
  const newOrder: OfflineOrder = {
    ...input,
    id: `ord_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    created_at: new Date().toISOString(),
  };

  allOrders.push(newOrder);

  const dir = path.dirname(ORDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(ORDERS_FILE, JSON.stringify({ orders: allOrders }, null, 2));

  return newOrder;
}
