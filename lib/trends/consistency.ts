// Đợt 28 — tự kiểm số tab "Diễn biến" trên DỮ LIỆU THẬT (job "Tự kiểm truy vấn thật") — HÀM THUẦN.
// Không có số "chuẩn" để so, nên so các con số PHẢI khớp nhau: tổng theo ngày = tổng theo chiến dịch; tách theo tuổi = giới =
// vị trí = tổng chiến dịch cùng loại; Google thiết bị = khung giờ = tổng chiến dịch. Lệch quá ngưỡng → báo kèm số.
import type { PlatformTrend } from "./fetch"
import type { BTable } from "./breakdown"

const vnd = (n: number) => `₫${Math.round(n).toLocaleString("vi-VN")}`
const close = (a: number, b: number, pct: number, abs: number) => Math.abs(a - b) <= Math.max(abs, Math.max(Math.abs(a), Math.abs(b)) * pct)

export function checkTrend(t: PlatformTrend, range: { from: string; to: string }): { issues: string[]; summary: string } {
  const issues: string[] = []
  const days = t.days.filter((d) => d.date >= range.from && d.date <= range.to)
  const dSpend = days.reduce((s, d) => s + d.spend, 0), cSpend = t.campaigns.reduce((s, c) => s + c.cur.spend, 0)
  if (!close(dSpend, cSpend, 0.01, 1000)) issues.push(`${t.platform}: tổng chi theo ngày ${vnd(dSpend)} ≠ tổng theo chiến dịch ${vnd(cSpend)}`)
  const dRes = days.reduce((s, d) => s + d.purchases + d.leads, 0)
  const cRes = t.campaigns.reduce((s, c) => s + (c.kind === "leads" ? c.cur.leads : c.cur.purchases), 0)
  // Theo ngày đếm MỌI lượt mua + lead của mọi chiến dịch; theo chiến dịch chỉ đếm kết quả đúng loại → theo ngày ≥ theo chiến dịch.
  if (dRes + 0.5 < cRes) issues.push(`${t.platform}: kết quả theo ngày (${Math.round(dRes)}) ít hơn theo chiến dịch (${Math.round(cRes)})`)
  const neg = t.campaigns.filter((c) => c.cur.spend < 0 || c.cur.purchases < 0 || c.cur.leads < 0)
  if (neg.length) issues.push(`${t.platform}: ${neg.length} chiến dịch có số âm`)
  return { issues, summary: `${t.platform}: ${t.campaigns.length} chiến dịch, chi ${vnd(cSpend)}, ${Math.round(cRes)} kết quả, ${days.length} ngày` }
}

export function checkBreakdown(tables: BTable[], t: PlatformTrend): { issues: string[]; summary: string } {
  const issues: string[] = []
  const prefix = t.platform === "meta" ? "meta_" : "google_"
  const parts: string[] = []
  for (const kind of ["sales", "leads"] as const) {
    const mine = tables.filter((x) => x.dim.startsWith(prefix) && x.kind === kind)
    if (!mine.length) continue
    const camp = t.campaigns.filter((c) => c.kind === kind)
    const cSpend = camp.reduce((s, c) => s + c.cur.spend, 0)
    const cRes = camp.reduce((s, c) => s + (kind === "leads" ? c.cur.leads : c.cur.purchases), 0)
    for (const x of mine) {
      if (!close(x.totalSpend, cSpend, 0.02, 2000)) issues.push(`${x.title}: tổng chi ${vnd(x.totalSpend)} ≠ tổng chiến dịch ${vnd(cSpend)}`)
      // Meta có thể ẩn một ít kết quả ở bảng tách (ngưỡng riêng tư) → chỉ báo khi lệch > 10%.
      if (!close(x.totalResults, cRes, 0.1, 3)) issues.push(`${x.title}: tổng kết quả ${Math.round(x.totalResults)} ≠ tổng chiến dịch ${Math.round(cRes)}`)
    }
    parts.push(`${kind === "leads" ? "lead" : "bán hàng"}: ${mine.length} bảng, chi ${vnd(cSpend)}, ${Math.round(cRes)} kết quả`)
  }
  return { issues, summary: `${t.platform} tách — ${parts.join("; ") || "không có bảng"}` }
}
