// ============================================================
// Khoản "Sản phẩm mới" đã tiêu bao nhiêu (12/10/2026, task #6285)
// ============================================================
// Khoản chi bổ sung loại new_product có `campaignContains` → cộng chi tiêu các chiến dịch có chữ đó trong tên,
// đúng công ty và đúng kênh của khoản, trong tháng của khoản. Dùng CHUNG đường đo với P&L
// (gatherCampaignsWithStatus + detectCompany + platformOf) để "đã tiêu" ở đây khớp chi tiêu trên Dashboard.
// Chỉ Google / Facebook đo được qua API; kênh nhập tay (TikTok, Zalo, …) trả spent = null kèm lý do.

import { gatherCampaignsWithStatus } from "@/lib/nba/gather";
import { detectCompany, platformOf } from "@/lib/nba/collectors/helpers";
import { resolvePeriod } from "@/lib/finance/period";
import type { Campaign } from "@/types/ads.types";
import type { ExtraSpendEntry } from "@/lib/settings/kpi-store";

export interface ExtraSpendProgress {
  id: string;
  /** null = không đo được (kênh không có API / thiếu chữ tên chiến dịch / nền tảng lỗi). */
  spent: number | null;
  /** Tên chiến dịch khớp (tối đa 20) — để người xem kiểm chữ lọc có bắt đúng không. */
  campaigns: string[];
  reason: string | null;
}

const AUTO_CHANNELS = new Set(["google", "facebook"]);

/** Hàm thuần — tách khỏi lượt gọi API để test được với danh sách chiến dịch dựng tay. */
export function matchExtraSpend(
  entries: ExtraSpendEntry[],
  campaigns: Pick<Campaign, "name" | "platform" | "company" | "metrics">[],
  errors: { metaError: string | null; googleError: string | null },
): ExtraSpendProgress[] {
  return entries.filter((e) => e.kind === "new_product").map((e) => {
    if (!e.campaignContains) return { id: e.id, spent: null, campaigns: [], reason: "Chưa nhập chữ trong tên chiến dịch nên không đo được" };
    if (!AUTO_CHANNELS.has(e.channel)) return { id: e.id, spent: null, campaigns: [], reason: "Kênh này không lấy chi tiêu tự động được" };
    const err = e.channel === "google" ? errors.googleError : errors.metaError;
    if (err) return { id: e.id, spent: null, campaigns: [], reason: `Chưa lấy được số ${e.channel === "google" ? "Google" : "Facebook"}: ${err}` };
    const needle = e.campaignContains.toLowerCase();
    let spent = 0;
    const names: string[] = [];
    for (const c of campaigns) {
      if (platformOf(c as Campaign) !== e.channel) continue;
      if (detectCompany(c as Campaign) !== e.company) continue;
      if (!(c.name ?? "").toLowerCase().includes(needle)) continue;
      spent += c.metrics?.spend ?? 0;
      if (names.length < 20) names.push(c.name);
    }
    return { id: e.id, spent: Math.round(spent), campaigns: names, reason: names.length === 0 ? "Chưa có chiến dịch nào có chữ này trong tên" : null };
  });
}

/** Đo các khoản "Sản phẩm mới" của một tháng (YYYY-MM). Không có khoản nào cần đo thì KHÔNG gọi Meta/Google. */
export async function extraSpendProgress(monthKey: string, entries: ExtraSpendEntry[]): Promise<ExtraSpendProgress[]> {
  const need = entries.filter((e) => e.kind === "new_product" && e.campaignContains && AUTO_CHANNELS.has(e.channel));
  if (need.length === 0) return matchExtraSpend(entries, [], { metaError: null, googleError: null });
  const b = resolvePeriod({ month: monthKey });
  const { campaigns, metaError, googleError } = await gatherCampaignsWithStatus({ from: b.adFrom, to: b.adTo });
  return matchExtraSpend(entries, campaigns, { metaError, googleError });
}
