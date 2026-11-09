// ============================================================
// Đợt 23 — chấm kết quả ĐO LẠI của phiên xử lý (7 / 14 ngày) — HÀM THUẦN
// ============================================================
// Trước đây: "cải thiện" = CPA mới < CPA lúc mở phiên — giảm 1% cũng tính là xong; phiên chấm theo ROAS (MBC) vẫn bị đo
// bằng CPA; mốc 7 ngày chỉ ghi số, không báo gì. Nay:
//   CPA : đạt khi CPA ≤ trần, HOẶC giảm ≥ 10%, HOẶC trước 0 đơn nay có đơn. Xấu đi khi tăng > 10%, hoặc chi tiền mà 0 đơn.
//   ROAS: đạt khi ROAS ≥ mức tối thiểu (ceiling), HOẶC tăng ≥ 10%. Xấu đi khi giảm > 10%, hoặc chi tiền mà 0 doanh thu.
//   Còn lại = "chưa rõ" (không đủ để nói tốt hay xấu) — không đóng phiên là "đạt".
// 14/10/2026: thêm "insufficient" (chưa đủ dữ liệu) — trước đây 3 đơn (2,1tr ÷ 3 = 707k/đơn) đã bị chấm "xấu hơn" và gợi ý
// hoàn tác, trong khi thêm/bớt 1 đơn là CPA nhảy 530k ↔ 1,06tr. Nay:
//   • cả hai kỳ đều có đơn mà kỳ sau < MIN_AFTER_ORDERS hoặc tổng < MIN_TOTAL_ORDERS → chưa đủ dữ liệu (không tốt, không xấu);
//   • chi tiền mà 0 đơn chỉ "xấu" khi số tiền đó theo CPA cũ lẽ ra mua được ≥ ZERO_ORDER_EXPECTED đơn (P(0 đơn) ≤ 5%).
// Trước 0 đơn → nay có đơn giữ luật cũ (đi từ 0 lên là tín hiệu riêng).

export type RemeasureVerdict = "improved" | "same" | "worse" | "insufficient"
export interface PerfSnap { cost: number; orders: number; value: number }
/** "cpl" (Đợt 23 · 3d) chấm y như "cpa" — `orders` của PerfSnap khi đó là số lead. */
export interface Goal { basis: "cpa" | "roas" | "cpl"; target: number; ceiling: number }

/** Ngưỡng thay đổi tối thiểu để coi là thật sự tốt / xấu hơn (tránh nhiễu). */
export const MIN_CHANGE = 0.1
/** Cỡ mẫu tối thiểu để kết luận (đơn / lead / lượt mua). */
export const MIN_AFTER_ORDERS = 5, MIN_TOTAL_ORDERS = 10
/** 0 đơn chỉ là "xấu" khi theo CPA cũ lẽ ra đã có ≥ 3 đơn (Poisson: P(0 | λ=3) ≈ 5%). */
export const ZERO_ORDER_EXPECTED = 3

export function judgeRemeasure(goal: Goal | null, before: PerfSnap | null, after: PerfSnap): { verdict: RemeasureVerdict; basis: Goal["basis"]; before: number | null; after: number | null } {
  const basis = goal?.basis ?? "cpa"
  if (basis === "roas") {
    const a = after.cost > 0 ? after.value / after.cost : null
    const b = before && before.cost > 0 ? before.value / before.cost : null
    if (a === null) return { verdict: "same", basis, before: b, after: a }
    if (after.cost > 0 && after.value <= 0) return { verdict: zeroVerdict(before, after), basis, before: b, after: 0 }
    if (smallSample(before, after)) return { verdict: "insufficient", basis, before: b, after: a }
    if ((goal && a >= goal.ceiling) || (b !== null && b > 0 && a >= b * (1 + MIN_CHANGE))) return { verdict: "improved", basis, before: b, after: a }
    if (b !== null && b > 0 && a < b * (1 - MIN_CHANGE)) return { verdict: "worse", basis, before: b, after: a }
    return { verdict: "same", basis, before: b, after: a }
  }
  const a = after.orders > 0 ? after.cost / after.orders : null
  const b = before && before.orders > 0 ? before.cost / before.orders : null
  if (a === null) return { verdict: after.cost > 0 ? zeroVerdict(before, after) : "same", basis, before: b, after: null }
  // Soát 07/10: trước 0 đơn nay có đơn KHÔNG tự động là "đạt" — có mục tiêu thì phải về trần (vd 5tr / 1 đơn, trần 200k → chưa rõ).
  if (b === null) return { verdict: !goal || a <= goal.ceiling ? "improved" : "same", basis, before: null, after: a }
  if (smallSample(before, after)) return { verdict: "insufficient", basis, before: b, after: a }
  if ((goal && a <= goal.ceiling) || a <= b * (1 - MIN_CHANGE)) return { verdict: "improved", basis, before: b, after: a }
  if (a > b * (1 + MIN_CHANGE)) return { verdict: "worse", basis, before: b, after: a }
  return { verdict: "same", basis, before: b, after: a }
}

/** Cả hai kỳ có đơn nhưng quá ít để so tỉ lệ. */
function smallSample(before: PerfSnap | null, after: PerfSnap): boolean {
  const nb = before?.orders ?? 0, na = after.orders
  return nb > 0 && na > 0 && (na < MIN_AFTER_ORDERS || nb + na < MIN_TOTAL_ORDERS)
}
/** Chi tiền mà 0 đơn: "xấu" chỉ khi theo CPA cũ lẽ ra đã có ≥ ZERO_ORDER_EXPECTED đơn; không biết CPA cũ → giữ luật cũ (xấu). */
function zeroVerdict(before: PerfSnap | null, after: PerfSnap): RemeasureVerdict {
  if (!before || before.orders <= 0 || before.cost <= 0) return "worse"
  const expected = after.cost / (before.cost / before.orders)
  return expected >= ZERO_ORDER_EXPECTED ? "worse" : "insufficient"
}

/** Mã số lưu trong result (Record<string, number|null>): 1 đạt · 0 chưa rõ · -1 xấu đi · 2 chưa đủ dữ liệu. */
export const VERDICT_CODE: Record<RemeasureVerdict, number> = { improved: 1, same: 0, worse: -1, insufficient: 2 }
