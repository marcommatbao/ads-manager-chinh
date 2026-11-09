// GET /api/google/campaigns/[id] — single Google Ads campaign detail with
// ad groups + daily breakdown, matching the shape app/(dashboard)/campaigns/[id]/page.tsx
// already expects from the Meta equivalent (app/api/meta/campaigns/[id]/route.ts).
// This route never existed — the detail page was hardcoded to the Meta endpoint
// for every campaign, including Google ones.
import { NextRequest, NextResponse } from "next/server";
import { enums } from "google-ads-api";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { enumName } from "@/lib/google-ads-enums";
import { getCurrentUser } from "@/lib/auth";
import { safeDate, InvalidGaqlInput } from "@/lib/google-ads-guards";
import { canAccessCompany } from "@/lib/permissions";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { friendlyError } from "@/lib/not-configured";
const toVnd = (micros: unknown) => Number(micros ?? 0) / 1_000_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const company = searchParams.get("company") as string | null;
  // from/to land inside quoted GAQL literals below, so they are validated
  // rather than trusted — the same treatment the toolkit routes already give
  // their `range`/`campaignId` params (lib/google-ads-guards.ts).
  let from: string;
  let to: string;
  try {
    from = safeDate(searchParams.get("from"), new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    to   = safeDate(searchParams.get("to"), new Date().toISOString().slice(0, 10));
  } catch (err) {
    if (err instanceof InvalidGaqlInput) {
      return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 });
    }
    throw err;
  }
  if (from > to) {
    return NextResponse.json({ error: "Ngày bắt đầu phải trước ngày kết thúc" }, { status: 400 });
  }

  if (!company) {
    return NextResponse.json({ error: "Thiếu công ty" }, { status: 400 });
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }
  const campaignId = parseInt(id, 10);
  if (!campaignId || isNaN(campaignId)) {
    return NextResponse.json({ error: "campaignId không hợp lệ" }, { status: 400 });
  }

  try {
    const customer = getGoogleAdsCustomer(company);

    // Campaign info + budget + period-aggregate metrics (no segments.date in
    // SELECT → API aggregates across the WHERE date range into one row).
    // campaign.start_date/end_date deliberately omitted — this account's API
    // access rejects them ("Unrecognized field in the query"), same
    // limitation already worked around in lib/google-client.ts's
    // fetchCampaignsForAccount (hardcodes startDate: "").
    const campaignRows = await customer.query(`
      SELECT
        campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
        metrics.cost_micros, metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND segments.date BETWEEN '${from}' AND '${to}'
    `);
    const c = campaignRows[0] as Record<string, Record<string, unknown>> | undefined;
    if (!c?.campaign) {
      return NextResponse.json({ error: "Không tìm thấy campaign trên Google Ads" }, { status: 404 });
    }

    const spend = toVnd(c.metrics?.cost_micros);
    const clicks = Number(c.metrics?.clicks ?? 0);
    const impressions = Number(c.metrics?.impressions ?? 0);
    const conversions = Number(c.metrics?.conversions ?? 0);
    // `metrics.conversions_value` ĐÃ nằm trong câu SELECT từ trước nhưng chưa
    // bao giờ được trả về — giống hệt `action_values` bên Meta.
    //
    // KHÔNG dùng toVnd ở đây: conversions_value là số thực theo ĐƠN VỊ TIỀN
    // của tài khoản, không phải micros như cost_micros. Chia thêm 1e6 sẽ làm
    // doanh thu nhỏ đi một triệu lần và ROAS luôn ra ~0.
    const revenue = Number(c.metrics?.conversions_value ?? 0);

    // Daily breakdown
    const dailyRows = await customer.query(`
      SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND segments.date BETWEEN '${from}' AND '${to}'
      ORDER BY segments.date ASC
    `);
    const daily = (dailyRows as Array<Record<string, Record<string, unknown>>>).map((r) => ({
      date: String(r.segments?.date ?? ""),
      spend: toVnd(r.metrics?.cost_micros),
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      ctr: Number(r.metrics?.ctr ?? 0) * 100,
      leads: Number(r.metrics?.conversions ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      revenue: Number(r.metrics?.conversions_value ?? 0),
    }));

    // Ad groups (aggregated across the same date range) — Google's closest
    // analogue to Meta's "ad sets". Google budgets live at the campaign
    // level, not per ad group, so dailyBudget/optimizationGoal don't have a
    // real per-ad-group source and are surfaced honestly as empty/0 rather
    // than fabricated.
    const adGroupRows = await customer.query(`
      SELECT ad_group.id, ad_group.name, ad_group.status,
        metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
        metrics.cost_micros, metrics.conversions, metrics.conversions_value
      FROM ad_group
      WHERE campaign.id = ${campaignId}
        AND segments.date BETWEEN '${from}' AND '${to}'
    `);
    const adsets = (adGroupRows as Array<Record<string, Record<string, unknown>>>).map((r) => {
      const agSpend = toVnd(r.metrics?.cost_micros);
      const agConversions = Number(r.metrics?.conversions ?? 0);
      const agRevenue = Number(r.metrics?.conversions_value ?? 0);
      return {
        id: String(r.ad_group?.id ?? ""),
        name: String(r.ad_group?.name ?? ""),
        status: enumName(enums.AdGroupStatus, r.ad_group?.status) === "ENABLED" ? "ACTIVE"
          : enumName(enums.AdGroupStatus, r.ad_group?.status) === "PAUSED" ? "PAUSED" : "ARCHIVED",
        dailyBudget: 0,
        optimizationGoal: "",
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        spend: agSpend,
        ctr: Number(r.metrics?.ctr ?? 0) * 100,
        cpc: toVnd(r.metrics?.average_cpc),
        conversions: agConversions,
        leads: agConversions,
        revenue: agRevenue,
        roas: agSpend > 0 ? agRevenue / agSpend : null,
      };
    });

    const campaignStatus = enumName(enums.CampaignStatus, c.campaign?.status);

    return NextResponse.json({
      campaign: {
        id: String(c.campaign?.id ?? ""),
        name: String(c.campaign?.name ?? ""),
        status: campaignStatus === "ENABLED" ? "ACTIVE" : campaignStatus === "PAUSED" ? "PAUSED" : "ARCHIVED",
        objective: enumName(enums.AdvertisingChannelType, c.campaign?.advertising_channel_type),
        dailyBudget: toVnd(c.campaign_budget?.amount_micros),
        lifetimeBudget: 0,
        startTime: "",
        stopTime: null,
        createdTime: "",
      },
      metrics: {
        impressions,
        clicks,
        spend,
        ctr: Number(c.metrics?.ctr ?? 0) * 100,
        cpc: toVnd(c.metrics?.average_cpc),
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        reach: 0,
        frequency: 0,
        conversions,
        leads: conversions,
        revenue,
        roas: spend > 0 ? revenue / spend : null,
      },
      adsets,
      period: { from, to },
      daily,
    });
  } catch (err) {
    const message = googleAdsErrorMessage(err);
    return NextResponse.json({ error: friendlyError(message) }, { status: 500 });
  }
}
