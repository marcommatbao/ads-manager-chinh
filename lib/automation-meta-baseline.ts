// ─────────────────────────────────────────────
// Mốc ngân sách gốc của campaign Facebook — để kẹp mọi lần rule tự đổi.
//
// Nhánh Google kẹp theo `dailyBudget` lúc khởi chạy đọc từ campaign-launches.json.
// Facebook không có bản ghi tương đương và không dựng lùi được: Graph API chỉ trả
// mức HIỆN TẠI, không trả mức lúc lập campaign.
//
// Nên mốc được lấy đúng một lần — ở lần đầu engine định đổi ngân sách campaign đó —
// rồi giữ nguyên mãi. Hệ quả cố ý: lần đổi đầu tiên tính từ hiện trạng. Đó là sự
// thật duy nhất có trong tay; đoán một con số "gốc" rồi kẹp theo con số đoán thì
// còn tệ hơn không kẹp, vì nó trông như có cơ sở.
// ─────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

const FILE = path.join(process.cwd(), "data", "automation-meta-baseline.json");

export interface MetaBudgetBaseline {
  campaignId: string;
  campaignName: string;
  /** Mức ngân sách/ngày lúc engine chạm vào campaign này lần đầu (VND). */
  baselineVnd: number;
  recordedAt: string;
  /** Rule nào làm phát sinh mốc — để tra ngược. */
  recordedByRule: string;
}

type Store = Record<string, MetaBudgetBaseline>;

function load(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Mốc đã lưu, hoặc null nếu chưa từng chạm campaign này. */
export function getBaseline(campaignId: string): MetaBudgetBaseline | null {
  return load()[campaignId] ?? null;
}

/**
 * Lấy mốc; chưa có thì lập mốc bằng `currentVnd` rồi trả về.
 * KHÔNG ghi đè mốc cũ — đó là toàn bộ lý do tồn tại của file này.
 */
export function ensureBaseline(
  campaignId: string,
  campaignName: string,
  currentVnd: number,
  ruleName: string,
): number {
  const store = load();
  const existing = store[campaignId];
  if (existing && existing.baselineVnd > 0) return existing.baselineVnd;

  store[campaignId] = {
    campaignId,
    campaignName,
    baselineVnd: currentVnd,
    recordedAt: new Date().toISOString(),
    recordedByRule: ruleName,
  };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileAtomicSync(FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    // Ghi hỏng thì vẫn kẹp theo mức hiện tại của lần này — thà kẹp chặt hơn
    // là bỏ kẹp. Lần sau sẽ thử lập mốc lại.
    console.warn("[MetaBaseline] không lưu được mốc:", err);
  }
  return currentVnd;
}

/** Trần/sàn cho phép quanh mốc gốc — lấy đúng ngưỡng nhánh Google đang dùng. */
export const BASELINE_MIN_RATIO = 0.5;
export const BASELINE_MAX_RATIO = 3.0;
/** Sàn tuyệt đối, không phụ thuộc mốc. */
export const ABS_MIN_BUDGET_VND = 100_000;
/** Chênh lệch nhỏ hơn mức này thì không đáng một lần ghi lên tài khoản. */
export const MIN_BUDGET_DELTA_VND = 50_000;

export interface ClampResult {
  /** Mức sẽ ghi, đã kẹp. */
  newVnd: number;
  /** Có đáng ghi không (sau khi kẹp). */
  meaningful: boolean;
  /** Vì sao không ghi — để nhật ký nói đúng lý do. */
  reason: string | null;
  baselineVnd: number;
}

/** Hàm thuần — tính mức ngân sách mới sau khi kẹp. Không đụng file, không gọi API. */
export function clampBudgetChange(
  currentVnd: number,
  baselineVnd: number,
  pct: number,
  direction: 1 | -1,
): ClampResult {
  const raw = Math.round(currentVnd * (1 + (direction * pct) / 100));
  const min = Math.max(ABS_MIN_BUDGET_VND, baselineVnd * BASELINE_MIN_RATIO);
  const max = baselineVnd * BASELINE_MAX_RATIO;
  // Sàn tuyệt đối thắng trần khi mốc quá nhỏ, nếu không sẽ ra khoảng rỗng.
  const newVnd = Math.round(Math.max(min, Math.min(Math.max(max, min), raw)));

  const delta = Math.abs(newVnd - currentVnd);
  if (delta < MIN_BUDGET_DELTA_VND) {
    const hitCeiling = direction === 1 && currentVnd >= max;
    const hitFloor = direction === -1 && currentVnd <= min;
    return {
      newVnd,
      meaningful: false,
      baselineVnd,
      reason: hitCeiling
        ? `Đã chạm trần ${Math.round(max).toLocaleString("vi-VN")}₫ (300% mốc gốc ${baselineVnd.toLocaleString("vi-VN")}₫)`
        : hitFloor
        ? `Đã chạm sàn ${Math.round(min).toLocaleString("vi-VN")}₫ (50% mốc gốc ${baselineVnd.toLocaleString("vi-VN")}₫)`
        : `Thay đổi chỉ ${delta.toLocaleString("vi-VN")}₫ — nhỏ hơn ${MIN_BUDGET_DELTA_VND.toLocaleString("vi-VN")}₫, chưa đáng một lần đổi`,
    };
  }
  return { newVnd, meaningful: true, reason: null, baselineVnd };
}
