// ─────────────────────────────────────────────
// Chi phí quảng cáo các kênh KHÔNG có API (TikTok, Zalo…), nhập tay theo tháng.
//
// Vì sao cần: lib/finance/company-pnl.ts chỉ cộng chi phí từ campaign Meta và
// Google. Tháng nào chạy thêm kênh khác thì tổng chi phí trên KPI Tổng Quan và
// trong báo cáo Telegram bị thiếu — và người đọc không có cách nào biết là nó
// đang thiếu.
//
// Nguyên tắc bắt buộc: số nhập tay KHÔNG BAO GIỜ được trộn im lặng vào số đo
// được. Nó luôn đi kèm một trường riêng (`spendManual`) và một bảng chi tiết
// theo kênh, để mọi nơi hiển thị đều nói được "trong tổng này có bao nhiêu là
// người nhập".
// ─────────────────────────────────────────────
import { promises as fs } from "fs";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { companyIds } from "@/lib/companies"
import { isCompany } from "@/lib/companies/registry";
import { adChannels, manualChannelKeys } from "@/lib/settings/ad-channels";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "manual-channel-spend.json");

/** Kênh GỐC khai tay. Đợt 27: + kênh tự thêm ở trang KPI (sổ kênh lib/settings/ad-channels.ts) — mã sinh một lần từ tên
 *  nên vẫn không sinh biến thể "Tiktok / TikTok / tik tok". Danh sách đầy đủ: manualChannelKeys(). */
export const MANUAL_CHANNELS = ["tiktok", "zalo", "other"] as const;
export type ManualChannel = string;

export const MANUAL_CHANNEL_LABEL: Record<string, string> = {
  tiktok: "TikTok Ads",
  zalo: "Zalo Ads",
  other: "Kênh khác",
};
export const manualChannelLabel = (key: string): string => key === "other" ? "Kênh khác" : adChannels().find((c) => c.key === key)?.manualLabel ?? MANUAL_CHANNEL_LABEL[key] ?? key;

export type ManualCompany = string;

export interface ManualSpendEntry {
  /** "YYYY-MM" */
  month: string;
  company: ManualCompany;
  channel: ManualChannel;
  amount: number;
  note?: string;
  updatedBy: string;
  updatedAt: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

/** Chặn nhầm tay: không cho khai chi phí cho tháng quá xa trong tương lai. */
export function isMonthAllowed(month: string, today = new Date()): boolean {
  if (!isValidMonth(month)) return false;
  const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const limitKey = `${limit.getUTCFullYear()}-${String(limit.getUTCMonth() + 1).padStart(2, "0")}`;
  return month <= limitKey;
}

export async function readManualSpend(): Promise<ManualSpendEntry[]> {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as ManualSpendEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface UpsertInput {
  month: string;
  company: ManualCompany;
  channel: ManualChannel;
  amount: number;
  note?: string;
  updatedBy: string;
}

export class ManualSpendInputError extends Error {}

/**
 * Ghi đè theo khóa (month, company, channel) — nhập lại cùng một ô là sửa, không
 * phải cộng dồn. amount = 0 xoá hẳn bản ghi để file không đầy dòng rỗng.
 */
export async function upsertManualSpend(input: UpsertInput): Promise<ManualSpendEntry[]> {
  if (!isValidMonth(input.month)) throw new ManualSpendInputError(`Tháng không hợp lệ: ${input.month}`);
  if (!isMonthAllowed(input.month)) throw new ManualSpendInputError("Không thể khai chi phí cho tháng quá xa trong tương lai");
  if (!manualChannelKeys().includes(input.channel)) throw new ManualSpendInputError(`Kênh không hợp lệ: ${input.channel}`);
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new ManualSpendInputError("Chi phí phải là số không âm");

  return withFileLock(FILE, async () => {
    const all = await readManualSpend();
    const idx = all.findIndex(
      (e) => e.month === input.month && e.company === input.company && e.channel === input.channel,
    );

    if (input.amount === 0) {
      if (idx >= 0) all.splice(idx, 1);
    } else {
      const entry: ManualSpendEntry = {
        month: input.month,
        company: input.company,
        channel: input.channel,
        amount: Math.round(input.amount),
        note: input.note?.trim() || undefined,
        updatedBy: input.updatedBy,
        updatedAt: new Date().toISOString(),
      };
      if (idx >= 0) all[idx] = entry; else all.push(entry);
    }

    try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* exists */ }
    await writeFileAtomic(FILE, JSON.stringify(all, null, 2));
    return all;
  });
}

export interface MonthManualSpend {
  total: number;
  breakdown: Array<{ channel: ManualChannel; label: string; amount: number; note?: string }>;
}

const EMPTY: MonthManualSpend = { total: 0, breakdown: [] };

/** Chi phí nhập tay của một tháng, tách theo công ty. Tháng chưa khai → 0đ. */
export async function getManualSpendForMonth(
  month: string,
): Promise<Record<ManualCompany, MonthManualSpend>> {
  const all = await readManualSpend();
  const out: Record<ManualCompany, MonthManualSpend> = {
    MBC: { total: 0, breakdown: [] },
    MBI: { total: 0, breakdown: [] },
  };

  for (const e of all) {
    if (e.month !== month) continue;
    if (!isCompany(e.company)) continue;
    const amount = Number(e.amount) || 0;
    if (amount <= 0) continue;
    out[e.company].total += amount;
    out[e.company].breakdown.push({
      channel: e.channel,
      label: manualChannelLabel(e.channel),
      amount,
      note: e.note,
    });
  }

  for (const co of companyIds()) {
    out[co].breakdown.sort((a, b) => b.amount - a.amount);
  }
  return out;
}

export { EMPTY as EMPTY_MANUAL_SPEND };
