// KPI monthly targets validator
// All monetary/count values must be non-negative integers
//
// Phân bổ theo kênh: tổng các kênh KHÔNG được vượt tổng chi QC của tháng đó.
// Nhỏ hơn thì hợp lệ — phần chênh là tiền chưa phân bổ.

import {
  kpiChannelLabel, sumChannelBudget, EXTRA_SPEND_KINDS,
  type MonthKpi, type ChannelBudget, type ExtraSpendKind,
} from "@/lib/settings/kpi-store";
import { kpiChannelKeys } from "@/lib/settings/ad-channels";

export interface ValidationError {
  field: string;
  message: string;
}

export function validateMonthKpi(month: number, kpi: Partial<MonthKpi>): ValidationError[] {
  const errors: ValidationError[] = [];
  const pfx = `month[${month}]`;

  const fields: (keyof MonthKpi)[] = ["revenueMbc", "adSpendMbc", "adSpendMbi", "ordersMbi"];
  for (const key of fields) {
    const v = kpi[key];
    if (v !== undefined) {
      const n = Number(v);
      if (isNaN(n) || n < 0 || !Number.isFinite(n)) {
        errors.push({
          field: `${pfx}.${key}`,
          message: `KPI ${key} tháng ${month} phải là số không âm`,
        });
      }
    }
  }

  for (const side of [
    { key: "adSpendMbcByChannel", total: "adSpendMbc", label: "MBC" },
    { key: "adSpendMbiByChannel", total: "adSpendMbi", label: "MBI" },
  ] as const) {
    const byChannel = kpi[side.key] as Partial<ChannelBudget> | undefined;
    if (byChannel === undefined) continue;

    // Đợt 27: kênh lạ (không có trong sổ kênh) → báo lỗi, không lặng lẽ bỏ số.
    for (const ch of Object.keys(byChannel)) {
      if (!kpiChannelKeys().includes(ch)) errors.push({ field: `${pfx}.${side.key}.${ch}`, message: `Kênh “${ch}” không có trong danh sách kênh — tải lại trang KPI` });
    }
    for (const ch of kpiChannelKeys()) {
      const v = byChannel[ch];
      if (v === undefined) continue;
      const n = Number(v);
      if (isNaN(n) || n < 0 || !Number.isFinite(n)) {
        errors.push({
          field: `${pfx}.${side.key}.${ch}`,
          message: `Ngân sách ${kpiChannelLabel(ch)} (${side.label}) tháng ${month} phải là số không âm`,
        });
      }
    }

    // Tổng phân bổ > tổng chi QC nghĩa là đã hứa nhiều tiền hơn số có. Chặn ở
    // đây, vì lưu được thì mọi thanh tiến độ trên Dashboard đều nói dối: từng
    // kênh trong hạn mức mà cộng lại đã vượt KPI tháng.
    const allocated = sumChannelBudget(byChannel);
    const total = Math.max(0, Number(kpi[side.total]) || 0);
    if (allocated > total) {
      errors.push({
        field: `${pfx}.${side.key}`,
        message:
          `Tháng ${month}: phân bổ theo kênh của ${side.label} đang là ` +
          `${allocated.toLocaleString("vi-VN")}đ, vượt ${(allocated - total).toLocaleString("vi-VN")}đ ` +
          `so với Chi QC ${side.label} (${total.toLocaleString("vi-VN")}đ)`,
      });
    }
  }

  errors.push(...validateExtraSpend(month, kpi.extraSpend));
  return errors;
}

const MAX_EXTRA_PER_MONTH = 50;
/** 12/10: khoản chi bổ sung — mỗi dòng phải đủ công ty / kênh / loại / số tiền; nói rõ dòng nào sai để người nhập sửa được. */
export function validateExtraSpend(month: number, list: unknown): ValidationError[] {
  if (list === undefined) return [];
  const errors: ValidationError[] = [];
  const pfx = `month[${month}].extraSpend`;
  if (!Array.isArray(list)) return [{ field: pfx, message: `Khoản chi bổ sung tháng ${month} không hợp lệ` }];
  if (list.length > MAX_EXTRA_PER_MONTH) errors.push({ field: pfx, message: `Tháng ${month}: tối đa ${MAX_EXTRA_PER_MONTH} khoản chi bổ sung` });
  (list as Record<string, unknown>[]).forEach((e, i) => {
    const at = `Tháng ${month}, khoản bổ sung thứ ${i + 1}`;
    const f = `${pfx}[${i}]`;
    if (e?.company !== "MBC" && e?.company !== "MBI") errors.push({ field: `${f}.company`, message: `${at}: chọn công ty MBC hoặc MBI` });
    if (typeof e?.channel !== "string" || !kpiChannelKeys().includes(e.channel)) errors.push({ field: `${f}.channel`, message: `${at}: kênh không có trong danh sách kênh` });
    if (!EXTRA_SPEND_KINDS.includes(e?.kind as ExtraSpendKind)) errors.push({ field: `${f}.kind`, message: `${at}: chọn loại "Đối tác hỗ trợ" hoặc "Sản phẩm mới"` });
    const amount = Number(e?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) errors.push({ field: `${f}.amount`, message: `${at}: số tiền phải lớn hơn 0` });
    if (typeof e?.note === "string" && e.note.length > 120) errors.push({ field: `${f}.note`, message: `${at}: ghi chú tối đa 120 ký tự` });
    if (e?.campaignContains !== undefined && e.campaignContains !== "") {
      if (e?.kind !== "new_product") errors.push({ field: `${f}.campaignContains`, message: `${at}: chỉ khoản "Sản phẩm mới" mới đo theo tên chiến dịch` });
      else if (typeof e.campaignContains !== "string" || e.campaignContains.trim().length < 2 || e.campaignContains.length > 60) errors.push({ field: `${f}.campaignContains`, message: `${at}: chữ trong tên chiến dịch cần 2–60 ký tự` });
    }
  });
  return errors;
}

export function validateKpiYear(months: MonthKpi[]): ValidationError[] {
  const errors: ValidationError[] = [];
  months.forEach((m, i) => {
    errors.push(...validateMonthKpi(i + 1, m));
  });
  return errors;
}
