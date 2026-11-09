// ============================================================
// Số liệu chiến dịch theo khoảng ngày — dùng chung cho route giao diện (/api/meta/campaigns, /api/google/campaigns) và
// MCP cho Claude (lib/mcp). Tách nguyên văn từ hai route 27/10 (task #7142): đổi logic ở đây là đổi cho cả hai.
// Quyền: hàm nhận SessionUser và tự lọc theo vai trò/công ty y như route cũ.
// ============================================================
import type { SessionUser } from "@/lib/auth"
import { metaClient, initMetaClient } from "@/lib/meta-client"
import { getCompaniesForRole, canAccessCompany } from "@/lib/permissions"
import { detectCompany } from "@/lib/company-detect"
import { resolveConversionActionTypes, buildGoalByCampaignMap, sumConversionActions, sumConversionValues } from "@/lib/meta-conversion-goal"
import { googleAdsClient, convertMicros } from "@/lib/google-client"
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client"
import type { Campaign } from "@/types/ads.types"

export class CompanyAccessError extends Error {}

export interface MetaPerformance { campaigns: Campaign[]; currency: string; conversionGoalsUnavailable: boolean }

export async function getMetaCampaignPerformance(
  user: SessionUser,
  { status: statusParam, from, to }: { status?: string | null; from?: string | null; to?: string | null },
): Promise<MetaPerformance> {
    const info = await initMetaClient();
    const currency = info.currency;

    const statusFilter = statusParam
      ? [statusParam]
      : ["ACTIVE", "PAUSED", "ARCHIVED"];

    const rawCampaigns = await metaClient.getCampaigns({ status: statusFilter });

    /** true = không lấy được mục tiêu chuyển đổi → cột "Kết quả"/CPL đáng ngờ. */
    let conversionGoalsUnavailable = false;

    const insightsMap = new Map<string, { spend: number; revenue: number; impressions: number; clicks: number; roas: number; conversions: number; resultValue: number | null; resultRoas: number | null }>();

    if (from && to) {
      const campaignIds = rawCampaigns.map((c) => c.id);
      // getAdSetsGoalInfo cho biết MỖI campaign đang tối ưu theo sự kiện nào.
      // Nuốt lỗi ở đây rất đắt: bản đồ rỗng thì resolveConversionActionTypes()
      // rơi về mặc định ["omni_purchase","purchase"] cho MỌI campaign — tức
      // campaign chạy lead bị đếm nhầm sự kiện, cột "Kết quả" và CPL sai mà
      // nhìn vẫn hợp lý. Đây đúng là bẫy đếm sai mà lib/meta-conversion-goal.ts
      // sinh ra để xử lý, nên để nó tái phát im lặng là hỏng cả mục đích.
      const [rawInsights, adSetGoals] = await Promise.all([
        metaClient.getCampaignInsights(campaignIds, { from, to }),
        metaClient.getAdSetsGoalInfo().catch((err: unknown) => {
          console.error("[meta/campaigns] getAdSetsGoalInfo failed:", err instanceof Error ? err.message : err);
          conversionGoalsUnavailable = true;
          return [];
        }),
      ]);
      const goalByCampaign = buildGoalByCampaignMap(adSetGoals);

      for (const ins of rawInsights) {
        const spend = parseFloat(ins.spend ?? "0");
        const revenue = (ins.action_values ?? [])
          .filter((a) => a.action_type === "purchase")
          .reduce((s, a) => s + parseFloat(a.value), 0);
        const impressions = parseInt(ins.impressions ?? "0", 10);
        const clicks = parseInt(ins.clicks ?? "0", 10);
        // "Kết quả"/conversions must match what THIS campaign is actually
        // optimizing for (see lib/meta-conversion-goal.ts) — not a blanket
        // "purchase" filter, which was reporting an unrelated event count
        // (and therefore a wrong CPL) for any campaign optimizing for
        // something else, e.g. add_payment_info, lead, complete_registration.
        const actionTypes = resolveConversionActionTypes(goalByCampaign.get(ins.campaign_id));
        // Trước đây cộng cả mảng actionTypes — mà mảng đó là danh sách ƯU
        // TIÊN: omni_purchase là tập cha của purchase nên cùng một lượt mua
        // bị đếm hai lần, làm "Kết quả" gấp đôi và CPL còn một nửa so với
        // Ads Manager. sumConversionActions() lấy đúng một loại.
        const conversions = sumConversionActions(ins.actions, actionTypes);
        const roas = spend > 0 ? revenue / spend : 0;
        // Cột "Giá trị kết quả" / "ROAS kết quả" (như Ads Manager): cùng loại kết quả với "Kết quả" ở trên — không dùng
        // `revenue` (cố định purchase) vì chiến dịch tối ưu sự kiện khác sẽ lệch Ads Manager.
        const resultValue = sumConversionValues(ins.action_values, actionTypes);
        const resultRoas = resultValue !== null && spend > 0 ? resultValue / spend : null;

        insightsMap.set(ins.campaign_id, { spend, revenue, impressions, clicks, roas, conversions, resultValue, resultRoas });
      }
    }

    // Meta has one shared ad account for both companies — tag each campaign
    // with its company (name-prefix heuristic, same as lib/finance/company-pnl.ts)
    // and drop whatever this role isn't allowed to see. Was previously
    // returned completely unfiltered/untagged to any authenticated user,
    // including viewer_mbc/viewer_mbi.
    const allowedCompanies = getCompaniesForRole(user);

    const campaigns: Campaign[] = rawCampaigns
      .map((c) => {
        const ins = insightsMap.get(c.id);
        const spend = ins?.spend ?? 0;
        const impressions = ins?.impressions ?? 0;
        const clicks = ins?.clicks ?? 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

        return {
          id:          c.id,
          name:        c.name,
          platform:    "facebook",
          status:      c.status === "ACTIVE" ? "ACTIVE" : c.status === "PAUSED" ? "PAUSED" : "ARCHIVED",
          objective:   c.objective ?? "",
          dailyBudget: parseInt(c.daily_budget ?? "0", 10),
          totalBudget: parseInt(c.lifetime_budget ?? "0", 10),
          startDate:   c.start_time?.split("T")[0] ?? "",
          endDate:     c.stop_time ? c.stop_time.split("T")[0] : null,
          company:     detectCompany(c.name),
          metrics: {
            impressions,
            clicks,
            spend,
            ctr,
            cpc,
            cpm,
            roas:        ins?.roas ?? 0,
            conversions: ins?.conversions ?? 0,
            revenue:     ins?.revenue ?? 0,
            resultValue: ins?.resultValue ?? null,
            resultRoas:  ins?.resultRoas ?? null,
          },
        } satisfies Campaign;
      })
      .filter((c) => allowedCompanies.includes(c.company as string));

  return { campaigns, currency, conversionGoalsUnavailable }
}

export interface GooglePerformance { campaigns: Campaign[]; uniqueUsersError?: string | null }

/** company: một công ty (phải có quyền, sai → CompanyAccessError) hoặc null = mọi công ty vai trò được xem. */
export async function getGoogleCampaignPerformance(
  user: SessionUser,
  { company, from, to }: { company?: string | null; from?: string | null; to?: string | null },
): Promise<GooglePerformance> {
  if (company && !canAccessCompany(user, company)) throw new CompanyAccessError("Access denied for this company")
    // No explicit company → scope to every company the role is allowed to
    // see (never "no filter at all", which used to leak both MBC and MBI
    // campaigns to a plain viewer_mbc/viewer_mbi request).
    const allowedAccountIds = (company ? [company] : getCompaniesForRole(user))
      .map((c) => GOOGLE_CUSTOMER_IDS[c])
      .filter((id): id is string => !!id);

    // getUniqueUsersByCampaign không bao giờ ném lỗi (xem lib/google-client.ts):
    // hỏng thì trả map rỗng kèm lý do, nên đặt chung Promise.all vẫn an toàn —
    // một cột hụt số KHÔNG được phép làm hỏng cả bảng campaign.
    const [allCampaigns, allInsights, uniqueUsers] = await Promise.all([
      googleAdsClient.getCampaigns(),
      from && to ? googleAdsClient.getCampaignInsights({ from, to }) : Promise.resolve([]),
      from && to
        ? googleAdsClient.getUniqueUsersByCampaign({ from, to })
        : Promise.resolve({ byCampaign: new Map<string, number>(), error: "Chưa chọn khoảng thời gian." }),
    ]);

    const filteredCampaigns = allCampaigns.filter((c) => allowedAccountIds.includes(c.accountId));
    const filteredInsights = allInsights.filter((i) => allowedAccountIds.includes(i.accountId));

    const campaigns: Campaign[] = filteredCampaigns.map((c) => {
      const campaignInsights = filteredInsights.filter((i) => i.campaignId === c.id);
      const totalClicks      = campaignInsights.reduce((s, i) => s + i.clicks, 0);
      const totalImpressions = campaignInsights.reduce((s, i) => s + i.impressions, 0);
      const totalCostMicros  = campaignInsights.reduce((s, i) => s + i.costMicros, 0);
      const totalConv        = campaignInsights.reduce((s, i) => s + i.conversions, 0);
      const totalRevenue     = campaignInsights.reduce((s, i) => s + i.conversionsValue, 0);
      const spend            = convertMicros(totalCostMicros);
      const ctr              = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const cpc              = totalClicks > 0 ? spend / totalClicks : 0;
      const cpm              = totalImpressions > 0 ? (spend / totalImpressions) * 1000 : 0;
      const roas             = spend > 0 ? totalRevenue / spend : 0;

      return {
        id:          c.id,
        name:        c.name,
        platform:    "google",
        status:      c.status === "ENABLED" ? "ACTIVE" : c.status === "PAUSED" ? "PAUSED" : "ARCHIVED",
        objective:   c.advertisingChannelType ?? "",
        dailyBudget: convertMicros(c.dailyBudgetMicros),
        totalBudget: 0,
        startDate:   c.startDate ?? "",
        endDate:     c.endDate ?? null,
        company:     company ?? null,
        accountId:   c.accountId,
        accountName: c.accountName,
        metrics: {
          impressions: totalImpressions,
          clicks:      totalClicks,
          spend,
          ctr,
          cpc,
          cpm,
          roas:        Math.round(roas * 100) / 100,
          conversions: totalConv,
          revenue:     totalRevenue,
          // Không có khoá trong map = Google không trả cho chiến dịch này
          // (Search/PMax). Để null chứ không hạ về 0.
          uniqueUsers: uniqueUsers.byCampaign.has(c.id)
            ? uniqueUsers.byCampaign.get(c.id)!
            : null,
        },
      };
    });

  return { campaigns, uniqueUsersError: uniqueUsers.error }
}
