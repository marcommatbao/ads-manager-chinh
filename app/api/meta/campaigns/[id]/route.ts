// GET /api/meta/campaigns/[id] — single campaign detail with adsets + insights
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { detectCompany } from "@/lib/company-detect";
import { graphFetch, isMetaTransientInsightError, describeMetaError } from "@/lib/meta-client";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";
import { friendlyError } from "@/lib/not-configured";

/** Gọi một endpoint insights có thử lại cho nhóm "Meta quá tải / hết giờ chờ".
 *
 *  Ba lệnh gọi trong file này trước đây dùng `fetch` trần: không đọc header
 *  hạn mức, không tôn trọng thời gian nghỉ chung, và bỏ cuộc ngay lỗi đầu
 *  tiên. Là truy vấn một chiến dịch nên nhẹ hơn hẳn cấp tài khoản, nhưng
 *  không có lý do gì để nó kém bền hơn các đường còn lại. */
async function insightsFetch<T>(url: string, label: string): Promise<T | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await graphFetch(url);
    const json = (await res.json()) as T & { error?: { message?: string; code?: number } };
    if (!json?.error) return json;
    if (isMetaTransientInsightError(json.error) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    console.warn(`[meta/campaigns/${label}] ${describeMetaError(json.error.message ?? "?", json.error.code)}`);
    return null;
  }
  return null;
}

const BASE = META_GRAPH_BASE;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: friendlyError("META_ACCESS_TOKEN not configured") }, { status: 500 });

  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  try {
    // Fetch campaign details
    const campaignRes = await fetch(
      `${BASE}/${id}?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time&access_token=${token}`
    );
    const campaign = await campaignRes.json() as Record<string, unknown> & { error?: { message: string } };
    if (campaign.error) return NextResponse.json({ error: campaign.error.message }, { status: 502 });

    // Meta has ONE shared ad account for both companies — a viewer/admin
    // scoped to one company must not be able to read the other company's
    // campaign detail just by knowing/guessing its ID (matches the RBAC
    // pattern already enforced on the sibling budget/status mutation routes).
    const campaignCompany = detectCompany((campaign.name as string) ?? "");
    if (!canAccessCompany(user, campaignCompany)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
    }

    // Fetch campaign insights
    const insightParams = new URLSearchParams({
      fields: "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values",
      time_range: JSON.stringify({ since: from, until: to }),
      access_token: token,
    });
    const insightData = await insightsFetch<{ data?: Array<Record<string, unknown>> }>(`${BASE}/${id}/insights?${insightParams}`, "insights");
    const insight = insightData?.data?.[0] ?? {};

    // Fetch ad sets
    const adsetRes = await fetch(
      `${BASE}/${id}/adsets?fields=id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time&limit=50&access_token=${token}`
    );
    const adsetData = await adsetRes.json() as { data?: Array<Record<string, unknown>> };
    const adsets = adsetData.data ?? [];

    // Fetch adset insights in one batch
    const adsetIds = adsets.map((a) => (a as { id: string }).id);
    const adsetInsightsMap: Record<string, Record<string, unknown>> = {};
    if (adsetIds.length > 0) {
      const batchBody = adsetIds.map((adsetId) => ({
        method: "GET",
        relative_url: `${adsetId}/insights?fields=impressions,clicks,spend,ctr,cpc,actions,action_values&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}`,
      }));
      const batchRes = await fetch(`${BASE}?access_token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch: batchBody }),
      });
      const batchData = await batchRes.json() as Array<{ code: number; body: string }>;
      batchData.forEach((item, idx) => {
        if (item.code === 200) {
          try {
            const parsed = JSON.parse(item.body) as { data?: Array<Record<string, unknown>> };
            adsetInsightsMap[adsetIds[idx]] = parsed.data?.[0] ?? {};
          } catch { /* skip */ }
        }
      });
    }

    const parseNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
    const parseActions = (ins: Record<string, unknown>, type: string) =>
      ((ins.actions as Array<{ action_type: string; value: string }>) ?? [])
        .filter((a) => a.action_type === type)
        .reduce((s, a) => s + parseNum(a.value), 0);

    // Doanh thu quy đổi. `action_values` ĐÃ được xin trong `fields` từ trước
    // (dòng 65) nhưng chưa bao giờ được bóc ra — nên trang chi tiết đành gõ
    // cứng ROAS = "—". Không thêm một lượt gọi Meta nào, chỉ đọc phần dữ liệu
    // vẫn đang bị vứt đi.
    //
    // `purchase` là giá trị đơn hàng mà Pixel gửi về. Chiến dịch LEADS không
    // có action này → doanh thu 0, và đó là 0 THẬT chứ không phải thiếu dữ
    // liệu; phần chấm điểm phải tự biết đừng đo ROAS cho chiến dịch thu lead.
    const parseActionValues = (ins: Record<string, unknown>, type: string) =>
      ((ins.action_values as Array<{ action_type: string; value: string }>) ?? [])
        .filter((a) => a.action_type === type)
        .reduce((s, a) => s + parseNum(a.value), 0);

    // Daily insights (time_increment=1)
    const dailyParams = new URLSearchParams({
      fields: "impressions,clicks,spend,ctr,cpc,actions,action_values,date_start",
      time_range: JSON.stringify({ since: from, until: to }),
      time_increment: "1",
      access_token: token,
    });
    const dailyData = await insightsFetch<{ data?: Array<Record<string, unknown>> }>(`${BASE}/${id}/insights?${dailyParams}`, "daily");
    const daily = (dailyData?.data ?? []).map((d) => ({
      date: d.date_start as string,
      spend: parseNum(d.spend),
      impressions: parseNum(d.impressions),
      clicks: parseNum(d.clicks),
      ctr: parseNum(d.ctr),
      leads: ((d.actions as Array<{ action_type: string; value: string }>) ?? [])
        .filter((a) => a.action_type === "lead")
        .reduce((s, a) => s + parseNum(a.value), 0),
      conversions: parseActions(d, "purchase"),
      revenue: parseActionValues(d, "purchase"),
    }));

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        // VND is a zero-decimal currency — no /100 conversion (matches the
        // list endpoint at app/api/meta/campaigns/route.ts, which doesn't divide).
        dailyBudget: parseNum(campaign.daily_budget),
        lifetimeBudget: parseNum(campaign.lifetime_budget),
        startTime: campaign.start_time,
        stopTime: campaign.stop_time,
        createdTime: campaign.created_time,
      },
      metrics: {
        impressions: parseNum(insight.impressions),
        clicks: parseNum(insight.clicks),
        spend: parseNum(insight.spend),
        ctr: parseNum(insight.ctr),
        cpc: parseNum(insight.cpc),
        cpm: parseNum(insight.cpm),
        reach: parseNum(insight.reach),
        frequency: parseNum(insight.frequency),
        conversions: parseActions(insight as Record<string, unknown>, "purchase"),
        leads: parseActions(insight as Record<string, unknown>, "lead"),
        revenue: parseActionValues(insight as Record<string, unknown>, "purchase"),
        // ROAS = doanh thu / chi tiêu. Chi tiêu 0 → null, KHÔNG phải 0:
        // "chưa tiêu đồng nào" và "tiêu mà không thu được gì" là hai tình
        // trạng khác hẳn nhau, gộp thành 0 là mời người đọc kết luận sai.
        roas: parseNum(insight.spend) > 0
          ? parseActionValues(insight as Record<string, unknown>, "purchase") / parseNum(insight.spend)
          : null,
      },
      adsets: adsets.map((a) => {
        const as = a as Record<string, unknown>;
        const ai = adsetInsightsMap[(as.id as string)] ?? {};
        return {
          id: as.id,
          name: as.name,
          status: as.status,
          dailyBudget: parseNum(as.daily_budget),
          optimizationGoal: as.optimization_goal,
          impressions: parseNum(ai.impressions),
          clicks: parseNum(ai.clicks),
          spend: parseNum(ai.spend),
          ctr: parseNum(ai.ctr),
          cpc: parseNum(ai.cpc),
          conversions: parseActions(ai, "purchase"),
          leads: parseActions(ai, "lead"),
          revenue: parseActionValues(ai, "purchase"),
          roas: parseNum(ai.spend) > 0 ? parseActionValues(ai, "purchase") / parseNum(ai.spend) : null,
        };
      }),
      period: { from, to },
      daily,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: friendlyError(message) }, { status: 500 });
  }
}
