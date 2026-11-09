// ============================================================
// KPI targets store — chỉ tiêu 12 tháng/năm (JSON + file-lock, không DB)
// Mỗi tháng: DT MBC, Chi QC MBC, Chi QC MBI, Đơn MBI.
// Tự tính: Tổng Chi QC = MBC+MBI; DT Quý = tổng 3 tháng.
//
// Chi QC mỗi công ty còn PHÂN BỔ được theo kênh (Google/Facebook/TikTok/Zalo).
// Phân bổ là TUỲ CHỌN và chỉ được ≤ tổng chi QC tháng đó: kênh để 0 nghĩa là
// "chưa đặt trần", không phải "trần bằng 0". Phần chênh giữa tổng và các kênh
// là tiền chưa phân bổ — hiện ra để không ai hiểu nhầm là đã chia hết.
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { adChannels, kpiChannelKeys } from "@/lib/settings/ad-channels";

const FILE = path.join(process.cwd(), "data", "kpi-targets.json");
const LOCK_KEY = "kpi-targets";

/** Kênh GỐC đặt được trần ngân sách. Đợt 27: thêm kênh (ChatGPT, Microsoft…) ở trang KPI — sổ kênh dùng chung
 *  lib/settings/ad-channels.ts; mã kênh sinh một lần từ tên nên không sinh biến thể "Tiktok / TikTok / tik tok". */
export const KPI_CHANNELS = ["google", "facebook", "tiktok", "zalo"] as const;
export type KpiChannel = string;

export const KPI_CHANNEL_LABEL: Record<string, string> = {
  google: "Google",
  facebook: "Facebook",
  tiktok: "TikTok",
  zalo: "Zalo",
};
/** Tên kênh (cả kênh tự thêm). */
export const kpiChannelLabel = (key: string): string => adChannels().find((c) => c.key === key)?.label ?? KPI_CHANNEL_LABEL[key] ?? key;

/** Trần ngân sách theo kênh (₫). 0 = chưa đặt trần cho kênh đó. */
export type ChannelBudget = Record<string, number>;

/** 4 kênh gốc = 0. Có kênh tự thêm → dùng emptyChannelBudget(). */
export const EMPTY_CHANNEL_BUDGET: ChannelBudget = { google: 0, facebook: 0, tiktok: 0, zalo: 0 };
export const emptyChannelBudget = (): ChannelBudget => Object.fromEntries(kpiChannelKeys().map((k) => [k, 0]));

// ── Khoản chi bổ sung (12/10/2026, task #6285) ─────────────────────────────
// Ngoài ngân sách cố định cả năm, từng tháng có thể có tiền THÊM:
//  • partner_support — đối tác hỗ trợ tiền chạy QC (không phải tiền công ty): NÂNG trần chi QC, và P&L trừ khoản này
//    khỏi chi phí thật của công ty (lib/finance/company-pnl.ts).
//  • new_product     — công ty bỏ thêm tiền cho sản phẩm mới: NÂNG trần; nếu có `campaignContains` thì trang KPI
//    đo riêng khoản này đã tiêu bao nhiêu (lọc chiến dịch theo chữ trong tên).
// Cả hai CỘNG vào CPL mục tiêu (user chốt 12/10) — qua effectiveMonth().
// Lưu ngay trong tháng của kpi-targets.json ⇒ nhật ký + khôi phục bản trước của KPI tự áp dụng.
export type ExtraSpendKind = "partner_support" | "new_product";
export const EXTRA_SPEND_KINDS: ExtraSpendKind[] = ["partner_support", "new_product"];
export const EXTRA_SPEND_KIND_LABEL: Record<ExtraSpendKind, string> = {
  partner_support: "Đối tác hỗ trợ",
  new_product: "Sản phẩm mới",
};
export type ExtraSpendCompany = "MBC" | "MBI";
export interface ExtraSpendEntry {
  id: string;
  company: ExtraSpendCompany;
  channel: string;          // mã kênh trong sổ kênh (google, facebook, …)
  kind: ExtraSpendKind;
  amount: number;           // ₫, > 0
  note: string;             // tên đối tác / sản phẩm
  campaignContains?: string; // chỉ new_product: chữ có trong tên chiến dịch để đo phần đã tiêu
}

export interface MonthKpi {
  revenueMbc: number;  // doanh thu MBC mục tiêu (₫)
  adSpendMbc: number;  // chi QC MBC mục tiêu (₫)
  adSpendMbi: number;  // chi QC MBI mục tiêu (₫)
  ordersMbi: number;   // đơn MBI mục tiêu
  /** Phân bổ adSpendMbc theo kênh. Tổng các kênh ≤ adSpendMbc. */
  adSpendMbcByChannel: ChannelBudget;
  /** Phân bổ adSpendMbi theo kênh. Tổng các kênh ≤ adSpendMbi. */
  adSpendMbiByChannel: ChannelBudget;
  /** Khoản chi bổ sung của tháng (KHÔNG nằm trong adSpend* — adSpend* là ngân sách cố định). */
  extraSpend: ExtraSpendEntry[];
}

export const EMPTY_MONTH: MonthKpi = {
  revenueMbc: 0, adSpendMbc: 0, adSpendMbi: 0, ordersMbi: 0,
  adSpendMbcByChannel: { ...EMPTY_CHANNEL_BUDGET },
  adSpendMbiByChannel: { ...EMPTY_CHANNEL_BUDGET },
  extraSpend: [],
};

/** Tổng tiền đã phân bổ cho các kênh. */
export function sumChannelBudget(b: Partial<ChannelBudget> | undefined): number {
  return kpiChannelKeys().reduce((s, ch) => s + (Number(b?.[ch]) || 0), 0);
}

interface YearKpi { months: Record<string, MonthKpi>; updatedAt?: string; updatedBy?: string }
interface KpiDB { [year: string]: YearKpi }

export interface QuarterKpi { quarter: number; revenueMbc: number }

export interface KpiYearView {
  year: number;
  months: MonthKpi[];        // index 0..11 = tháng 1..12
  quarters: QuarterKpi[];    // tổng DT MBC 3 tháng
  updatedAt?: string;
  updatedBy?: string;
}

function readDB(): KpiDB {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, "utf8")) as KpiDB;
  } catch {
    return {};
  }
}

function normChannels(b: Partial<ChannelBudget> | undefined): ChannelBudget {
  // Đợt 27: mọi kênh trong sổ (kể cả kênh tự thêm / đã ẩn) — trước đây chỉ giữ 4 kênh gốc nên số kênh mới sẽ bị xoá khi lưu.
  const out: ChannelBudget = {};
  for (const ch of kpiChannelKeys()) out[ch] = Math.max(0, Math.round(Number(b?.[ch]) || 0));
  // Soát 07/10: tệp sổ kênh hỏng/không đọc được → sổ chỉ còn 4 kênh gốc; GIỮ số của kênh đã lưu (mã hợp lệ) thay vì lặng lẽ
  // bỏ — bộ kiểm khi lưu sẽ báo "kênh không có trong danh sách" (lỗi to), không mất số.
  for (const [k, v] of Object.entries(b ?? {})) if (!(k in out) && /^[a-z][a-z0-9_]{1,23}$/.test(k) && Number(v) > 0) out[k] = Math.round(Number(v));
  return out;
}

function normMonth(m: Partial<MonthKpi> | undefined): MonthKpi {
  return {
    revenueMbc: Math.max(0, Math.round(Number(m?.revenueMbc) || 0)),
    adSpendMbc: Math.max(0, Math.round(Number(m?.adSpendMbc) || 0)),
    adSpendMbi: Math.max(0, Math.round(Number(m?.adSpendMbi) || 0)),
    ordersMbi:  Math.max(0, Math.round(Number(m?.ordersMbi)  || 0)),
    // Tháng lưu từ trước khi có phân bổ kênh không có hai trường này — đọc ra
    // là toàn 0, tức "chưa phân bổ", đúng như trước khi có tính năng.
    adSpendMbcByChannel: normChannels(m?.adSpendMbcByChannel),
    adSpendMbiByChannel: normChannels(m?.adSpendMbiByChannel),
    // Tháng lưu trước 12/10/2026 không có trường này → [] (y như trước khi có tính năng).
    extraSpend: normExtraSpend(m?.extraSpend),
  };
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** Chuẩn hoá danh sách khoản bổ sung khi đọc/ghi. Dòng hỏng (sai công ty / loại / tiền ≤ 0) bị bỏ — bộ kiểm khi lưu
 *  (validators/kpi.ts) đã chặn trước, nên ở đây chỉ còn là lưới an toàn cho tệp sửa tay. */
function normExtraSpend(v: unknown): ExtraSpendEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ExtraSpendEntry[] = [];
  for (const raw of v as Record<string, unknown>[]) {
    const company = raw?.company === "MBC" || raw?.company === "MBI" ? raw.company : null;
    const kind = EXTRA_SPEND_KINDS.includes(raw?.kind as ExtraSpendKind) ? (raw.kind as ExtraSpendKind) : null;
    const amount = Math.round(Number(raw?.amount) || 0);
    const channel = str(raw?.channel, 24);
    if (!company || !kind || amount <= 0 || !/^[a-z][a-z0-9_]{1,23}$/.test(channel)) continue;
    const contains = kind === "new_product" ? str(raw?.campaignContains, 60) : "";
    out.push({
      id: str(raw?.id, 64) || randomUUID(),
      company, channel, kind, amount,
      note: str(raw?.note, 120),
      ...(contains ? { campaignContains: contains } : {}),
    });
  }
  return out;
}

export interface ExtraSpendSide { total: number; partnerSupport: number; newProduct: number; byChannel: ChannelBudget }
/** Cộng khoản bổ sung theo công ty / loại / kênh. */
export function extraSpendSummary(m: Pick<MonthKpi, "extraSpend">): Record<ExtraSpendCompany, ExtraSpendSide> {
  const side = (): ExtraSpendSide => ({ total: 0, partnerSupport: 0, newProduct: 0, byChannel: {} });
  const out: Record<ExtraSpendCompany, ExtraSpendSide> = { MBC: side(), MBI: side() };
  for (const e of m.extraSpend ?? []) {
    const s = out[e.company];
    if (!s) continue;
    s.total += e.amount;
    if (e.kind === "partner_support") s.partnerSupport += e.amount; else s.newProduct += e.amount;
    s.byChannel[e.channel] = (s.byChannel[e.channel] ?? 0) + e.amount;
  }
  return out;
}

/** Trần THỰC TẾ của tháng = ngân sách cố định + khoản bổ sung (tổng công ty, và kênh đã có trần).
 *  Kênh trần cố định = 0 nghĩa là "chưa đặt trần" → GIỮ 0: cộng khoản bổ sung vào thì kênh bỗng có trần đúng bằng khoản
 *  đó và Dashboard báo vượt sai. Tiền bổ sung của kênh ấy vẫn nằm trong tổng của công ty. */
export function effectiveMonth(m: MonthKpi): MonthKpi {
  const ex = extraSpendSummary(m);
  const addCh = (fixed: ChannelBudget, extra: ChannelBudget): ChannelBudget => {
    const out: ChannelBudget = { ...fixed };
    for (const [ch, v] of Object.entries(extra)) if ((fixed[ch] ?? 0) > 0) out[ch] = (fixed[ch] ?? 0) + v;
    return out;
  };
  return {
    ...m,
    adSpendMbc: m.adSpendMbc + ex.MBC.total,
    adSpendMbi: m.adSpendMbi + ex.MBI.total,
    adSpendMbcByChannel: addCh(m.adSpendMbcByChannel, ex.MBC.byChannel),
    adSpendMbiByChannel: addCh(m.adSpendMbiByChannel, ex.MBI.byChannel),
  };
}

/** Đợt 27: kênh này có trần > 0 ở BẤT KỲ tháng nào đã lưu không (chặn ẩn kênh đang có số). */
export function channelHasKpiValues(key: string): boolean {
  const db = readDB();
  return Object.values(db).some((y) => Object.values(y?.months ?? {}).some((m) =>
    (Number(m?.adSpendMbcByChannel?.[key]) || 0) > 0 || (Number(m?.adSpendMbiByChannel?.[key]) || 0) > 0));
}

/** View đầy đủ 12 tháng + 4 quý (tự cộng) cho 1 năm. */
export function getKpiYear(year: number): KpiYearView {
  const db = readDB();
  const y = db[String(year)];
  const months: MonthKpi[] = Array.from({ length: 12 }, (_, i) =>
    normMonth(y?.months?.[String(i + 1)])
  );
  const quarters: QuarterKpi[] = [0, 1, 2, 3].map(q => ({
    quarter: q + 1,
    revenueMbc: months.slice(q * 3, q * 3 + 3).reduce((s, m) => s + m.revenueMbc, 0),
  }));
  return { year, months, quarters, updatedAt: y?.updatedAt, updatedBy: y?.updatedBy };
}

/** KPI 1 tháng (year, month 1-12) — cho Dashboard đối chiếu. */
export function getMonthKpi(year: number, month1to12: number): MonthKpi {
  const db = readDB();
  return normMonth(db[String(year)]?.months?.[String(month1to12)]);
}

/** KPI 1 tháng đã CỘNG khoản bổ sung — mọi chỗ so chi tiêu với trần / tính CPL mục tiêu dùng hàm này. */
export function getEffectiveMonthKpi(year: number, month1to12: number): MonthKpi {
  return effectiveMonth(getMonthKpi(year, month1to12));
}

/** Lưu 12 tháng cho 1 năm. */
export async function saveKpiYear(year: number, months: MonthKpi[], updatedBy?: string): Promise<KpiYearView> {
  await withFileLock(LOCK_KEY, async () => {
    const db = readDB();
    const monthMap: Record<string, MonthKpi> = {};
    for (let i = 0; i < 12; i++) monthMap[String(i + 1)] = normMonth(months[i]);
    db[String(year)] = { months: monthMap, updatedAt: new Date().toISOString(), updatedBy };
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    await writeFileAtomic(FILE, JSON.stringify(db, null, 2));
  });
  return getKpiYear(year);
}
