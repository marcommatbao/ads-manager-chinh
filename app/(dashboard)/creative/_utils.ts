// ─────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────

export function fmtVND(n: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n);
}

export function formatReach(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Nhãn sản phẩm cho id dạng `custom_<tên>` (sản phẩm trong hồ sơ doanh nghiệp / gõ tay) → `<tên>`. */
export function customProductName(id: string): string {
  return id.startsWith("custom_") ? id.slice("custom_".length) : id;
}
