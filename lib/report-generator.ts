// ============================================================
// AdsCommand — Report Generator
// Types + data gathering for PDF/Excel reports
// ============================================================

import { getCurrentUser, type SessionUser } from "./auth";
import { metaClient } from "./meta-client";
import { detectCompany } from "@/store/useAdsStore";
import { promises as fs } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import path from "path";
import { companyIds } from "@/lib/companies"

// ─────────────────────────────────────────────
// Report Config
// ─────────────────────────────────────────────

export interface ReportConfig {
  type: "pdf" | "excel";
  period: { start: string; end: string };
  company: string /* mã công ty hoặc "ALL" */;
  sections: {
    summary: boolean;
    campaigns: boolean;
    cpl: boolean;
    budget_history: boolean;
    ai_insights: boolean;
  };
  generated_by: string;
}

export interface ReportCampaign {
  id: string;
  name: string;
  company: string | null;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  cpl: number;
  /** null = CHƯA ĐO ĐƯỢC doanh thu (Meta không trả action_values), KHÁC 0.
   *  0 nghĩa là đo được và đúng bằng không — hai chuyện khác hẳn nhau, và
   *  bản PDF tô ĐỎ mọi giá trị < 1 nên nhầm chỗ này là vu oan cho campaign. */
  roas: number | null;
}

export interface ReportData {
  config: ReportConfig;
  summary: {
    total_spend: number;
    total_leads: number;
    avg_cpl: number;
    avg_roas: number | null;
    total_impressions: number;
    total_clicks: number;
    active_campaigns: number;
  };
  campaigns: ReportCampaign[];
  mbc_summary: { spend: number; leads: number; cpl: number };
  mbi_summary: { spend: number; leads: number; cpl: number };
  /** Nguồn dữ liệu lấy hụt. Rỗng = báo cáo đầy đủ; có phần tử = bảng bên
   *  trong ĐANG THIẾU, không phải "không chạy quảng cáo". */
  dataGaps: string[];
  generated_at: string;
}

// ─────────────────────────────────────────────
// Data Gathering
// ─────────────────────────────────────────────

export async function gatherReportData(config: ReportConfig): Promise<ReportData> {
  // Get user for permission filtering
  const user = await getCurrentUser();
  const allowedCompanies = user?.companies as string[] || companyIds();

  // Fetch campaigns from Meta
  // Ghi sổ thay vì nuốt: báo cáo Excel/PDF này xuất cho quản lý và khách hàng.
  // Meta lỗi mà im lặng thì file xuất ra có bảng trống, người nhận hiểu là
  // "không chạy quảng cáo" chứ không phải "lấy dữ liệu thất bại".
  const dataGaps: string[] = [];
  const rawCampaigns = await metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED"] }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ReportGenerator] không lấy được danh sách chiến dịch:", msg);
    dataGaps.push(`Danh sách chiến dịch: ${msg}`);
    return [];
  });
  const dateRange = { from: config.period.start, to: config.period.end };

  // Fetch insights
  const campaignIds = rawCampaigns.map((c: { id: string }) => c.id);
  const insights = campaignIds.length > 0
    ? await metaClient.getCampaignInsights(campaignIds, dateRange).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ReportGenerator] không lấy được insights:", msg);
        dataGaps.push(`Số liệu hiệu quả: ${msg}`);
        return [];
      })
    : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insightMap = new Map((insights as any[]).map((ins: any) => [ins.campaign_id, ins]));

  // Transform and filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let campaigns: ReportCampaign[] = rawCampaigns.map((c: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ins = insightMap.get(c.id) as any;
    const company = detectCompany(c.name, c.name);
    const spend = ins ? parseFloat(ins.spend || "0") : 0;
    const impressions = ins ? parseInt(ins.impressions || "0", 10) : 0;
    const clicks = ins ? parseInt(ins.clicks || "0", 10) : 0;
    const conversions = ins?.actions
      ?.filter((a: { action_type: string }) => ["purchase", "complete_registration", "omni_purchase"].includes(a.action_type))
      .reduce((sum: number, a: { value: string }) => sum + parseInt(a.value || "0", 10), 0) ?? 0;

    // ROAS — trước đây hardcode `roas: 0`, nên MỌI báo cáo PDF/Excel xuất ra
    // đều hiện "0.00x" tô ĐỎ, kể cả campaign đang lãi. Doanh thu vốn ĐÃ có
    // trong phản hồi (`action_values` nằm trong INSIGHT_FIELDS của meta-client)
    // — chỉ là chỗ này không đọc. Cách tính lấy đúng theo bản đã chạy tốt ở
    // app/api/campaigns/compare/route.ts.
    //
    // Không có `action_values` = Meta KHÔNG đo được doanh thu (điển hình:
    // campaign chạy lead, không có sự kiện mua) → để null, KHÔNG hạ về 0.
    const actionValues = ins?.action_values as Array<{ action_type: string; value: string }> | undefined;
    const revenue = Array.isArray(actionValues)
      ? actionValues
          .filter(a => a.action_type === "purchase" || a.action_type === "omni_purchase")
          .reduce((sum, a) => sum + (parseFloat(a.value || "0") || 0), 0)
      : null;
    const roas = revenue === null ? null : (spend > 0 ? revenue / spend : 0);

    return {
      id: c.id,
      name: c.name,
      company,
      status: c.status,
      spend,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      conversions,
      cpl: conversions > 0 ? spend / conversions : 0,
      roas,
    };
  });

  // Filter by config company AND user permissions
  if (config.company !== "ALL") {
    campaigns = campaigns.filter((c) => c.company === config.company);
  }
  campaigns = campaigns.filter((c) => allowedCompanies.includes(c.company ?? ""));

  // Build summaries
  const total_spend = campaigns.reduce((s, c) => s + c.spend, 0);
  const total_leads = campaigns.reduce((s, c) => s + c.conversions, 0);

  const mbc = campaigns.filter((c) => c.company === "MBC");
  const mbi = campaigns.filter((c) => c.company === "MBI");

  const mbcSpend = mbc.reduce((s, c) => s + c.spend, 0);
  const mbcLeads = mbc.reduce((s, c) => s + c.conversions, 0);
  const mbiSpend = mbi.reduce((s, c) => s + c.spend, 0);
  const mbiLeads = mbi.reduce((s, c) => s + c.conversions, 0);

  return {
    config,
    summary: {
      total_spend,
      total_leads,
      avg_cpl: total_leads > 0 ? total_spend / total_leads : 0,
      // Trung bình có TRỌNG SỐ theo chi tiêu, và chỉ gộp campaign đo được
      // doanh thu. Campaign chưa đo được mà tính như ROAS 0 sẽ kéo tụt số
      // tổng — đúng kiểu bịa mà bản cũ mắc phải.
      avg_roas: (() => {
        const measured = campaigns.filter(c => c.roas !== null);
        const spendOf = measured.reduce((s2, c) => s2 + c.spend, 0);
        if (measured.length === 0 || spendOf <= 0) return null;
        const revenueOf = measured.reduce((s2, c) => s2 + (c.roas as number) * c.spend, 0);
        return revenueOf / spendOf;
      })(),
      total_impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
      total_clicks: campaigns.reduce((s, c) => s + c.clicks, 0),
      active_campaigns: campaigns.filter((c) => c.status === "ACTIVE").length,
    },
    campaigns,
    mbc_summary: { spend: mbcSpend, leads: mbcLeads, cpl: mbcLeads > 0 ? mbcSpend / mbcLeads : 0 },
    mbi_summary: { spend: mbiSpend, leads: mbiLeads, cpl: mbiLeads > 0 ? mbiSpend / mbiLeads : 0 },
    dataGaps,
    generated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Report History (JSON persistence)
// ─────────────────────────────────────────────

export interface ReportHistoryItem {
  id: string;
  name: string;
  company: string;
  format: "pdf" | "excel";
  period: string;
  generated_by: string;
  generated_at: string;
}

const HISTORY_FILE = path.join(process.cwd(), "data", "report-history.json");

export async function getReportHistory(): Promise<ReportHistoryItem[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addReportHistory(item: ReportHistoryItem): Promise<void> {
  await withFileLock(HISTORY_FILE, async () => {
    const history = await getReportHistory();
    history.unshift(item);
    // Keep max 50 entries
    const capped = history.slice(0, 50);
    await writeFileAtomic(HISTORY_FILE, JSON.stringify(capped, null, 2));
  });
}
