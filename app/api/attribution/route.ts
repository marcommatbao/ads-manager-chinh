import { NextRequest, NextResponse } from "next/server"
import { dateClauseForRange } from "@/lib/google-date-range";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { enums } from "google-ads-api"
import { getCurrentUser } from "@/lib/auth"
import { safeDateRange, InvalidGaqlInput } from "@/lib/google-ads-guards"
import { canAccessCompany } from "@/lib/permissions"
import { getGoogleAdsCustomer }      from "@/lib/google-ads-client"
import { enumName }                  from "@/lib/google-ads-enums"
import { metaClient, initMetaClient } from "@/lib/meta-client"
import { detectCompany } from "@/lib/company-detect"
import { friendlyError } from "@/lib/not-configured";

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split("T")[0]
}

// Google's LAST_N_DAYS literals mean "the N days ENDING YESTERDAY" — today is
// not included. Meta's window used to be built as today-N → today, so the two
// channels were compared over different periods (Meta carried an extra,
// partial day and started a day later). One conversion here, used by both.
const RANGE_DAYS: Record<string, number> = {
  TODAY: 1, YESTERDAY: 1,
  LAST_7_DAYS: 7, LAST_14_DAYS: 14, LAST_30_DAYS: 30,
  LAST_60_DAYS: 60, LAST_90_DAYS: 90,
}

function rangeToDates(range: string): { from: string; to: string; days: number } {
  // safeDateRange already rejected anything not in its allowlist; anything in
  // the allowlist we have no day-count for falls back to 30 explicitly rather
  // than silently becoming 90 (the old ternary's default).
  const days = RANGE_DAYS[range] ?? 30
  return { from: getDateDaysAgo(days), to: getDateDaysAgo(1), days }
}

/** Meta action types counted as a conversion here. "omni_purchase" is left out
 *  on purpose: it already aggregates web/app/offline purchases, so adding it to
 *  "purchase" double-counts the same conversion. */
const FB_CONVERSION_ACTIONS = ["lead", "purchase"] as const

function sumActions(
  list: Array<{ action_type: string; value: string }> | null | undefined,
): number {
  return (list ?? [])
    .filter((a) => (FB_CONVERSION_ACTIONS as readonly string[]).includes(a.action_type))
    .reduce((sum, a) => sum + (parseFloat(a.value) || 0), 0)
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { searchParams } = new URL(req.url)
    const company   = (searchParams.get("company") || "MBC") as string
    let dateRange: string
    try {
      dateRange = safeDateRange(searchParams.get("range"))
    } catch (err) {
      if (err instanceof InvalidGaqlInput) {
        return NextResponse.json({ error: friendlyError(err.message) }, { status: 400 })
      }
      throw err
    }

    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 })
    }

    const customer = getGoogleAdsCustomer(company)
    const window = rangeToDates(dateRange)

    // ── Pull conversion data từ Google Ads ──
    // A second query against click_view (LIMIT 5000) used to run alongside
    // this one and its result was never read anywhere — every page load paid
    // for it in latency and API quota. Removed.
    // KHÔNG lọc `campaign.status = 'ENABLED'`.
    //
    // Trang này so hiệu quả của một KỲ ĐÃ QUA. Campaign tiêu tiền trong kỳ rồi
    // bị tắt/xoá sau đó vẫn là tiền đã tiêu và conversion đã có — lọc theo
    // trạng thái HIỆN TẠI làm chúng biến mất khỏi phía Google, trong khi phía
    // Facebook lấy ở cấp tài khoản nên vẫn đếm đủ. Hai bên đếm trên hai tập
    // campaign khác nhau thì mọi tỉ lệ so sánh bên dưới đều lệch, và lệch theo
    // hướng làm Google trông chi ít hơn thực tế.
    const convPaths = await customer.query(`
      SELECT
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.conversions,
        metrics.conversions_value,
        metrics.view_through_conversions,
        metrics.cross_device_conversions,
        metrics.cost_micros
      FROM campaign
      WHERE ${dateClauseForRange(dateRange)}
    `)

    // Google đếm MỌI conversion action đang bật, Facebook chỉ đếm lead+purchase
    // — hai định nghĩa khác nhau đặt cạnh nhau thành "56% vs 44%". Không thể tự
    // chọn hộ action nào mới là "lead thật" (đó là quyết định nghiệp vụ), nhưng
    // có thể BÀY RA rổ conversion của Google gồm những gì, để người đọc tự thấy
    // con số 4.763 là lead thật hay gồm cả micro-conversion.
    let conversionActions: Array<{ name: string; category: string; conv: number }> = []
    try {
      const actionRows = await customer.query(`
        SELECT
          segments.conversion_action_name,
          segments.conversion_action_category,
          metrics.conversions
        FROM campaign
        WHERE ${dateClauseForRange(dateRange)}
      `)
      type ActionRow = {
        segments?: { conversion_action_name?: string; conversion_action_category?: number }
        metrics?: { conversions?: number }
      }
      const byAction = new Map<string, { category: string; conv: number }>()
      for (const r of actionRows as ActionRow[]) {
        const name = r.segments?.conversion_action_name
        if (!name) continue
        const category = enumName(enums.ConversionActionCategory, r.segments?.conversion_action_category) || ""
        const prev = byAction.get(name)
        byAction.set(name, {
          category,
          conv: (prev?.conv ?? 0) + (r.metrics?.conversions || 0),
        })
      }
      conversionActions = [...byAction.entries()]
        .map(([name, v]) => ({ name, category: v.category, conv: Math.round(v.conv * 10) / 10 }))
        .sort((a, b) => b.conv - a.conv)
    } catch (err) {
      // Không lấy được thì thôi — phần so sánh chính vẫn chạy. Nhưng đừng nuốt
      // im: rổ conversion không xem được cũng là một thông tin.
      console.warn("[attribution] không tách được conversion action:", googleAdsErrorMessage(err))
    }

    // Facebook data — real Meta Insights account summary (single shared ad
    // account, same as every other Meta route in this codebase; there is no
    // per-company Meta account split like Google Ads has). Previously this
    // pulled from getAlerts(), which only contains campaigns that fired a
    // budget/CPL threshold alert — a spend snapshot at alert-fire time, not
    // real period totals — silently undercounting Facebook against Google's
    // live GAQL numbers.
    // Split per company by campaign name. getAccountSummary() returns ONE
    // aggregate row for the whole ad account, so this page used to show the
    // same Facebook numbers on the MBC tab and the MBI tab — and the
    // conversion-share percentages divided one company's Google conversions
    // by a total containing BOTH companies' Facebook conversions, so the split
    // was wrong on both tabs. Campaign name is the only company signal a
    // shared Meta ad account offers; detectCompany() is the same rule the rest
    // of this codebase uses.
    let fbSpend = 0
    let fbConv  = 0
    let fbRevenue = 0
    let fbUnclassifiedSpend = 0
    let fbUnclassifiedCampaigns = 0
    let metaError: string | null = null
    const fbCampaignRows: Array<{ name: string; spend: number; conv: number; revenue: number }> = []

    try {
      await initMetaClient()
      const rows = await metaClient.getCampaignInsightsForAccount({ from: window.from, to: window.to })
      for (const row of rows) {
        const name = row.campaign_name ?? ""
        const spend = parseFloat(row.spend ?? "0") || 0
        const conv = sumActions(row.actions)
        const revenue = sumActions(row.action_values)

        // detectCompany() always returns MBC or MBI; treat a name carrying no
        // company marker at all as unclassified instead of letting the
        // fallback quietly bill it to whichever company is on screen.
        const hasMarker = /\bMBC\b|\bMBI\b/i.test(name)
        if (!hasMarker) {
          fbUnclassifiedSpend += spend
          fbUnclassifiedCampaigns++
          continue
        }
        if (detectCompany(name) !== company) continue

        fbSpend += spend
        fbConv += conv
        fbRevenue += revenue
        fbCampaignRows.push({ name, spend: Math.round(spend), conv, revenue: Math.round(revenue) })
      }
    } catch (err) {
      // Meta not configured / API error — keep 0 but SAY SO. A silent 0 reads
      // as "Facebook sold nothing", which is a different statement entirely.
      metaError = err instanceof Error ? err.message : "Meta API error"
    }

    // ── Tổng hợp metrics từng channel ──
    const ggSpend = convPaths.reduce((s: number, r: any) =>
      s + (r.metrics?.cost_micros || 0) / 1_000_000, 0)
    const ggConv  = convPaths.reduce((s: number, r: any) =>
      s + (r.metrics?.conversions || 0), 0)
    const ggViewThrough = convPaths.reduce((s: number, r: any) =>
      s + (r.metrics?.view_through_conversions || 0), 0)
    // conversions_value was already being SELECTed and then thrown away, so
    // the report could show how many conversions each channel produced but
    // never how much money — which is the actual question being asked of it.
    const ggRevenue = convPaths.reduce<number>(
      (sum, r) => sum + Number((r.metrics as { conversions_value?: number } | undefined)?.conversions_value ?? 0),
      0,
    )

    const totalSpend = ggSpend + fbSpend
    const totalConv  = ggConv  + fbConv
    const totalRevenue = ggRevenue + fbRevenue

    const roas = (revenue: number, spend: number) => spend > 0
      ? Math.round((revenue / spend) * 100) / 100
      : 0

    // ── True CPL (last-click, real — no cross-channel journey data exists
    // in this codebase, so no "assisted"/multi-touch figure is computed
    // here; a previous version fabricated one from a fixed 0.55 ratio and
    // labeled the real last-click CPL as "chưa đúng" in the UI, which was
    // actively misleading, not just imprecise) ──
    const fbCPL_lastClick = fbConv > 0
      ? Math.round(fbSpend / fbConv) : 0

    // ── Campaign-level breakdown ──
    // Role used to be a stereotype about the channel type: SEARCH → CLOSING,
    // everything else → AWARENESS/ASSIST. That labelled every Performance Max
    // campaign as merely assisting even while it closed hundreds of
    // conversions (PMax serves Search inventory too). Role is now read off
    // measured behaviour: a campaign whose conversions arrive mostly WITHOUT a
    // click (view-through) is assisting; one converting on clicks is closing;
    // below a minimum volume there is no honest label to give.
    // Dữ liệu thật 30 ngày cho thấy không campaign nào vượt 50% view-through
    // (MBC dao động 0–41%), nên chỉ hai nhãn ASSIST/CLOSING thì mọi campaign
    // đều rơi vào CLOSING và cột này không nói thêm được gì. Thêm một bậc
    // giữa: từ một phần tư conversion trở lên không qua click là hành vi khác
    // hẳn campaign gần như chỉ đóng bằng click.
    const MIN_CONV_FOR_ROLE = 5
    const ASSIST_VIEW_THROUGH_SHARE = 0.5
    const MIXED_VIEW_THROUGH_SHARE = 0.25

    // Lọc theo CHI TIÊU, không theo conversion.
    //
    // Bảng này trước đây chỉ hiện campaign có conversion > 0 — nghĩa là campaign
    // tiêu tiền mà không ra gì thì biến mất khỏi báo cáo hiệu quả, đúng loại
    // dòng cần nhìn thấy nhất. Số thật 30 ngày của MBI: 21,4tr (Google) +
    // 16,6tr (Facebook) = 38tr, tức 40% tổng chi MBI, nằm trong các campaign
    // 0 conversion và không xuất hiện ở bất kỳ đâu trên màn hình.
    const campaignBreakdown = convPaths
      .filter((r: any) => (r.metrics?.cost_micros || 0) > 0)
      .map((r: any) => {
        const channelType = enumName(enums.AdvertisingChannelType, r.campaign?.advertising_channel_type)
        const conv = r.metrics?.conversions || 0
        const viewThrough = r.metrics?.view_through_conversions || 0
        const spend = Math.round((r.metrics?.cost_micros || 0) / 1_000_000)
        const revenue = Math.round(r.metrics?.conversions_value || 0)
        const vtShare = (conv + viewThrough) > 0 ? viewThrough / (conv + viewThrough) : 0

        const role =
          conv === 0                           ? "KHÔNG CÓ CONVERSION" :
          conv < MIN_CONV_FOR_ROLE             ? "CHƯA ĐỦ DỮ LIỆU" :
          vtShare >= ASSIST_VIEW_THROUGH_SHARE ? "AWARENESS/ASSIST" :
          vtShare >= MIXED_VIEW_THROUGH_SHARE  ? "VỪA ĐÓNG VỪA HỖ TRỢ" :
          "CLOSING"

        return {
          name:        r.campaign?.name || "",
          /** Trạng thái HIỆN TẠI, không phải trạng thái lúc tiêu tiền. Có để UI
           *  đánh dấu campaign đã tắt — nếu không, bỏ lọc ENABLED xong người
           *  đọc sẽ thắc mắc vì sao campaign không còn chạy vẫn nằm trong báo
           *  cáo (nó nằm đó vì nó ĐÃ tiêu tiền trong kỳ). */
          status:      enumName(enums.CampaignStatus, r.campaign?.status) || "",
          platform:    "google",
          type:        channelType,
          spend,
          conv,
          revenue,
          roas:        roas(revenue, spend),
          cpl:         conv > 0 ? Math.round(spend / conv) : 0,
          viewThrough,
          viewThroughShare: Math.round(vtShare * 100),
          role,
        }
      })
      // Sorted by money brought in, not by cheapest CPL — a campaign with a
      // tiny CPL and no revenue was being pushed to the top of the list.
      .sort((a, b) => b.revenue - a.revenue || a.cpl - b.cpl)

    const facebookBreakdown = fbCampaignRows
      .filter((c) => c.spend > 0)
      .map((c) => ({
        name: c.name,
        // Meta insights ở cấp tài khoản không kèm trạng thái campaign; để rỗng
        // thay vì đoán "đang chạy".
        status: "",
        platform: "facebook",
        type: "FACEBOOK",
        spend: c.spend,
        conv: c.conv,
        revenue: c.revenue,
        roas: roas(c.revenue, c.spend),
        cpl: c.conv > 0 ? Math.round(c.spend / c.conv) : 0,
        viewThrough: 0,
        viewThroughShare: 0,
        // Meta không trả view-through ở mức campaign nên không có cơ sở đo vai
        // trò. Nhãn phải khác "CHƯA ĐỦ DỮ LIỆU" của Google: bên đó nghĩa là
        // campaign chưa đủ conversion để kết luận, còn ở đây campaign có thể
        // đang chạy rất tốt (422 conversion, ROAS 12.67x) mà vẫn không đo được
        // — gộp chung một nhãn là nói sai về campaign đang thắng.
        role: c.conv === 0 ? "KHÔNG CÓ CONVERSION" : "KHÔNG ĐO ĐƯỢC",
      }))
      .sort((a, b) => b.revenue - a.revenue || a.cpl - b.cpl)

    return NextResponse.json({
      dateRange,
      summary: {
        totalSpend: Math.round(totalSpend),
        totalConv,
        totalRevenue: Math.round(totalRevenue),
        totalCPL: totalConv > 0 ? Math.round(totalSpend / totalConv) : 0,
        totalRoas: roas(totalRevenue, totalSpend),
      },
      channels: {
        google: {
          spend:       Math.round(ggSpend),
          conv:        ggConv,
          revenue:     Math.round(ggRevenue),
          roas:        roas(ggRevenue, ggSpend),
          cpl:         ggConv > 0 ? Math.round(ggSpend / ggConv) : 0,
          viewThrough: Math.round(ggViewThrough),
          share:       totalConv > 0 ? Math.round(ggConv / totalConv * 100) : 0,
          // The two platforms do not count the same things, and the share
          // percentages above divide one by the other — so each side has to
          // state what it counted.
          conversionBasis: "Mọi conversion action đang bật trong tài khoản Google Ads",
          /** Rổ conversion của Google gồm những action nào — để người đọc tự
           *  đánh giá con số này có so được với lead+purchase của Facebook
           *  không. Rỗng = không tách được (xem log), KHÔNG phải "không có". */
          conversionActions,
        },
        facebook: {
          spend:         Math.round(fbSpend),
          conv:          fbConv,
          revenue:       Math.round(fbRevenue),
          roas:          roas(fbRevenue, fbSpend),
          cpl_lastClick: fbCPL_lastClick,
          share:         totalConv > 0 ? Math.round(fbConv / totalConv * 100) : 0,
          conversionBasis: "Chỉ action \"lead\" và \"purchase\" (bỏ omni_purchase để không đếm trùng)",
          companySplit: "by_campaign_name" as const,
          unclassifiedSpend: Math.round(fbUnclassifiedSpend),
          unclassifiedCampaigns: fbUnclassifiedCampaigns,
        },
      },
      campaignBreakdown,
      facebookBreakdown,
      // Tiền chảy vào campaign không ra conversion nào — con số đáng hành động
      // nhất trên màn hình này, nên nó được tính sẵn thay vì bắt người đọc tự
      // cộng các dòng trong bảng.
      wasted: {
        google: {
          campaigns: campaignBreakdown.filter((c) => c.conv === 0).length,
          spend: campaignBreakdown.filter((c) => c.conv === 0).reduce((sum, c) => sum + c.spend, 0),
        },
        facebook: {
          campaigns: facebookBreakdown.filter((c) => c.conv === 0).length,
          spend: facebookBreakdown.filter((c) => c.conv === 0).reduce((sum, c) => sum + c.spend, 0),
        },
      },
      dataQuality: {
        window: { from: window.from, to: window.to, days: window.days },
        metaError,
        // Revenue on both sides is what the ad platforms themselves tracked —
        // it has not been reconciled against Odoo.
        revenueSource: "platform_tracking",
      },
      // No cross-channel touchpoint/session data exists anywhere in this
      // codebase, so no real multi-touch "customer journey" can be computed
      // — a previous version fabricated fixed-percentage journeys here.
      // Only real, measured signals go in keyInsights now.
      keyInsights: [
        ggViewThrough > 50
          ? `${Math.round(ggViewThrough)} view-through conversions trên Google — khách thấy Display/PMax rồi convert sau`
          : null,
      ].filter(Boolean),
    })
  } catch (error: any) {
    return NextResponse.json({ error: friendlyError(error.message) }, { status: 500 })
  }
}
