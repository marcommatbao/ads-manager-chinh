// GET /api/dashboard/unified
// Aggregates Facebook + Google data into a single unified summary
// Used by UnifiedOverview component on the Dashboard

import { NextRequest, NextResponse } from "next/server";
import { sumConversionActions } from "@/lib/meta-conversion-goal";
import { getCurrentUser } from "@/lib/auth";
import { metaClient, initMetaClient } from "@/lib/meta-client";
import { googleAdsClient, convertMicros } from "@/lib/google-client";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { detectCompany } from "@/lib/company-detect";
import { fetchMbcRevenue, fetchMbiOrders } from "@/lib/finance/company-pnl";
import { hasModule } from "@/lib/companies";
import { isCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

type CompanyFilter = string /* mã công ty hoặc "ALL" */;

function sumActions(
  actions: Array<{ action_type: string; value: string }> | null,
  types: string[]
): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || "0"), 0);
}

// Doanh thu do NỀN TẢNG tự khai (action_values / conversions_value). Đây KHÔNG
// phải tiền vào tài khoản công ty — trang /revenue-attribution đối chiếu nó với
// đơn hàng thật trong Odoo, nên con số này cần được trả ra để so.
// Ba tên gọi dưới đây là BA CÁCH GHI CỦA CÙNG MỘT lượt mua, không phải ba
// loại chuyển đổi khác nhau: offsite_conversion.fb_pixel_purchase là lượt mua
// do Pixel ghi, purchase là bản tổng hợp, omni_purchase là tập cha gộp cả
// web/app/offline. Meta trả CẢ BA dòng cho cùng một đơn, nên cộng dồn là nhân
// ba doanh thu. Chính repo này đã ghi luật đó ở app/api/cpl/route.ts
// ("summing it together with 'purchase' double-counts") và
// app/api/attribution/route.ts ("bỏ omni_purchase để không đếm trùng").
//
// Đây là con số /revenue-attribution đem đối chiếu với đơn hàng thật trong
// Odoo — thổi phồng nó lên ba lần thì chính phép đối chiếu đó mất nghĩa.
//
// Xếp theo ĐỘ BAO PHỦ giảm dần rồi lấy loại đầu tiên có mặt: tài khoản nào
// Meta không trả omni_purchase thì vẫn còn purchase, rồi tới bản của Pixel.
// Cách này không bao giờ tệ hơn cách cũ — khi chỉ có một loại xuất hiện thì
// kết quả y hệt, khi có nhiều loại thì mới hết trùng.
const FB_VALUE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function fbDeclaredValue(actionValues: Array<{ action_type: string; value: string }> | null): number {
  return sumConversionActions(actionValues, FB_VALUE_ACTIONS);
}

function fbLeadsFromActions(actions: Array<{ action_type: string; value: string }> | null): number {
  // Cùng bẫy: "lead" là bản tổng hợp, còn onsite_conversion.lead_grouped
  // (biểu mẫu ngay trên Facebook) và offsite_conversion.fb_pixel_lead (Pixel
  // trên website) là hai nguồn mà "lead" đã gộp sẵn.
  let leads = sumConversionActions(actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]);
  // Fallback: if no lead actions, use conversions.
  // Bốn loại này KHÁC nhau thật (mua / đăng ký / liên hệ / nộp đơn) nên ở đây
  // cộng dồn mới đúng — không phải cùng một hành động gọi bằng nhiều tên.
  if (leads === 0) {
    leads = sumActions(actions, ["purchase", "complete_registration", "contact", "submit_application"]);
  }
  return leads;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const to   = searchParams.get("to")   ?? new Date().toISOString().split("T")[0];
  const companyParam = (searchParams.get("company") ?? "ALL").toUpperCase();
  const company: CompanyFilter = isCompany(companyParam) ? companyParam : "ALL";

  // ── Facebook ──
  let fbSpend = 0, fbLeads = 0, fbClicks = 0, fbDeclared = 0;
  let fbError: string | null = null;
  try {
    await initMetaClient();
    if (company === "ALL") {
      const fb = await metaClient.getAccountSummary({ from, to });
      fbSpend  = parseFloat(fb.spend ?? "0");
      fbClicks = parseInt(fb.clicks ?? "0", 10);
      fbLeads  = fbLeadsFromActions(fb.actions);
      fbDeclared = fbDeclaredValue(fb.action_values);
    } else {
      // Meta has a single shared ad account for both companies — same
      // name-prefix heuristic (detectCompany) used by app/api/meta/campaigns/route.ts
      // to split MBC vs MBI, since there's no per-company account to query directly.
      const campaigns = await metaClient.getCampaigns({ status: ["ACTIVE", "PAUSED", "ARCHIVED"], limit: 500 });
      const matchingIds = campaigns.filter((c) => detectCompany(c.name) === company).map((c) => c.id);
      const insights = await metaClient.getCampaignInsights(matchingIds, { from, to });
      for (const ins of insights) {
        fbSpend  += parseFloat(ins.spend ?? "0");
        fbClicks += parseInt(ins.clicks ?? "0", 10);
        fbLeads  += fbLeadsFromActions(ins.actions);
        fbDeclared += fbDeclaredValue(ins.action_values);
      }
    }
  } catch (e) {
    fbError = e instanceof Error ? e.message : "Facebook error";
  }

  // ── Google ──
  let ggSpend = 0, ggLeads = 0, ggClicks = 0, ggDeclared = 0;
  let ggError: string | null = null;
  try {
    if (company === "ALL") {
      const gg = await googleAdsClient.getAccountSummary({ from, to });
      // getAccountSummary gộp từ getAccountBreakdown, mà hàm đó BỎ QUA tài
      // khoản lỗi. Không hỏi lại thì tổng thiếu hẳn một tài khoản trong im
      // lặng — tiền thật, trên màn hình đầu tiên người dùng nhìn mỗi sáng.
      const missed = googleAdsClient.lastBreakdownErrors;
      if (missed.length > 0) {
        ggError = `Thiếu số liệu ${missed.length} tài khoản Google (${missed.map(m => m.accountName).join(", ")}) — tổng bên dưới ĐANG THIẾU phần đó.`;
      }
      ggSpend  = convertMicros(gg.costMicros);
      ggClicks = gg.clicks;
      ggLeads  = gg.conversions;
      ggDeclared = gg.conversionsValue;
    } else {
      // Google splits MBC/MBI by customer ID — same lookup as
      // app/api/google/campaigns/route.ts and lib/google-ads-client.ts.
      const customerId = GOOGLE_CUSTOMER_IDS[company];
      const breakdown = await googleAdsClient.getAccountBreakdown({ from, to });
      // Đúng tài khoản của công ty đang xem bị lỗi thì mọi số về 0 mà không có
      // lỗi nào nổi lên — "không tiêu đồng nào" và "không lấy được" nhìn y hệt.
      const missedHere = googleAdsClient.lastBreakdownErrors.filter(m => m.accountId === customerId);
      if (missedHere.length > 0) {
        ggError = `Không lấy được số liệu Google của ${company}: ${missedHere[0].message}`;
      }
      const totals = breakdown
        .filter((b) => b.accountId === customerId)
        .reduce(
          (acc, b) => ({
            costMicros:  acc.costMicros  + b.costMicros,
            clicks:      acc.clicks      + b.clicks,
            conversions: acc.conversions + b.conversions,
            conversionsValue: acc.conversionsValue + b.conversionsValue,
          }),
          { costMicros: 0, clicks: 0, conversions: 0, conversionsValue: 0 }
        );
      ggSpend  = convertMicros(totals.costMicros);
      ggClicks = totals.clicks;
      ggLeads  = totals.conversions;
      ggDeclared = totals.conversionsValue;
    }
  } catch (e) {
    ggError = e instanceof Error ? e.message : "Google error";
  }

  // ── Doanh thu MBC + đơn hàng MBI THẬT (Odoo) ──
  //
  // declaredValue ở dưới (fbDeclared/ggDeclared) là do Meta/Google TỰ KHAI —
  // chú thích ở fbDeclaredValue() đã nói rõ đây KHÔNG phải tiền vào tài khoản
  // công ty. Số THẬT nằm ở đây, cùng nguồn Odoo Report API mà card "Hiệu quả
  // chi phí theo công ty" (lib/finance/company-pnl.ts) đang dùng — cố tình gọi
  // lại đúng hai hàm đó thay vì tự viết fetch riêng, để các nơi hiển thị không
  // bao giờ lệch nhau vì hai cách tính khác nhau.
  //
  // LUÔN gọi cả hai, không phụ thuộc bộ lọc `company` — đây là hai sự thật cố
  // định của từng công ty (MBC đo doanh thu, MBI đo đơn hàng, không công ty
  // nào đo được cả hai), nên ẩn chúng đi chỉ vì người dùng đang xem "Tất cả"
  // hay "MBI" là giấu đúng số họ cần thấy thường xuyên nhất.
  let mbcRevenue: number | null = null;
  let mbcRevenueError: string | null = null;
  let mbiOrders: number | null = null;
  let mbiOrdersError: string | null = null;
  // Đợt 22b: Odoo / Report API là của Mắt Bão (gói matbao). Bản cài khách không gọi (trước đây mỗi lần mở Dashboard đều gọi
  // rồi nhận lỗi "MATBAO_REPORT_API chưa cấu hình"); giao diện cũng đã ẩn hai ô này. Bản Mắt Bão: y nguyên.
  if (hasModule("matbao")) {
    const isoFrom = `${from}T00:00:00Z`;
    const isoTo = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString();
    const [mbcRes, mbiRes] = await Promise.all([
      fetchMbcRevenue(isoFrom, isoTo).catch((e) => ({
        revenue: 0, orders: 0,
        error: friendlyError(e instanceof Error ? e.message : "Lỗi không rõ khi lấy doanh thu MBC"),
      })),
      fetchMbiOrders(isoFrom, isoTo).catch((e) => ({
        orders: 0,
        error: friendlyError(e instanceof Error ? e.message : "Lỗi không rõ khi lấy đơn hàng MBI"),
      })),
    ]);
    if (mbcRes.error) mbcRevenueError = mbcRes.error; else mbcRevenue = mbcRes.revenue;
    if (mbiRes.error) mbiOrdersError = mbiRes.error; else mbiOrders = mbiRes.orders;
  }

  // ── Aggregate ──
  const totalSpend  = fbSpend  + ggSpend;
  const totalLeads  = fbLeads  + ggLeads;
  const totalClicks = fbClicks + ggClicks;
  const totalCpl    = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const fbCpl = fbLeads  > 0 ? fbSpend  / fbLeads  : 0;
  const ggCpl = ggLeads  > 0 ? ggSpend  / ggLeads  : 0;

  const fbBudgetPct = totalSpend > 0 ? Math.round((fbSpend / totalSpend) * 100) : 0;
  const ggBudgetPct = totalSpend > 0 ? 100 - fbBudgetPct : 0;

  // ── Channel comparison ──
  //
  // IMPORTANT: the two platforms are NOT counting the same thing.
  //   Facebook → fbLeadsFromActions(): lead-type actions only.
  //   Google   → metrics.conversions: EVERY conversion action the account
  //              marks "include in Conversions" (calls, form submits,
  //              purchases, whatever is configured).
  //
  // Dividing spend by those two different denominators and declaring a
  // winner is not a like-for-like comparison — it structurally flatters
  // whichever platform counts more event types. On the live MBC/MBI account
  // this produced "Google hiệu quả hơn 96%" (FB 8 "leads" vs Google ~500
  // "conversions"), which is an artifact of the definitions, not a finding.
  //
  // Aligning them means deciding which Google conversion actions count as a
  // lead — an account-configuration decision this code cannot make on the
  // business's behalf. So the numbers are still shown (both are real), the
  // basis of each is now declared, and the winner/rebalance claim is
  // withheld while the bases differ.
  const FB_LEADS_BASIS = "Hành động dạng lead (lead, lead_grouped, pixel_lead)";
  const GG_LEADS_BASIS = "Tất cả conversion action bật trong tài khoản Google Ads";
  const comparable = false; // set to true only once both sides count the same event set

  let betterChannel: "FACEBOOK" | "GOOGLE" | null = null;
  let cplDiffPct = 0;
  let shouldRebalance = false;
  let recommendation = "";

  if (fbCpl > 0 && ggCpl > 0 && !comparable) {
    recommendation =
      "Chưa so sánh trực tiếp được CPL hai kênh: Facebook chỉ tính hành động dạng lead, " +
      "còn Google tính mọi conversion action đang bật. Muốn so sánh đúng, cần thống nhất " +
      "đâu là 'lead' cho Google (Cài đặt → Google Ads conversion actions).";
  } else if (fbCpl > 0 && ggCpl > 0) {
    if (fbCpl < ggCpl) {
      betterChannel = "FACEBOOK";
      cplDiffPct = Math.round(((ggCpl - fbCpl) / ggCpl) * 100);
    } else {
      betterChannel = "GOOGLE";
      cplDiffPct = Math.round(((fbCpl - ggCpl) / fbCpl) * 100);
    }
    shouldRebalance = cplDiffPct > 20 && totalSpend > 0;
    if (shouldRebalance) {
      const winner = betterChannel === "FACEBOOK" ? "Facebook" : "Google";
      recommendation = `${winner} đang có CPL thấp hơn ${cplDiffPct}%. Cân nhắc chuyển thêm ngân sách sang ${winner} để tối ưu chi phí.`;
    } else {
      recommendation = `Facebook và Google đang cân bằng tốt. CPL chênh lệch ${cplDiffPct}% — tiếp tục theo dõi.`;
    }
  } else if (fbCpl > 0) {
    recommendation = "Chỉ có dữ liệu Facebook. Kết nối Google Ads để so sánh hiệu quả kênh.";
  } else if (ggCpl > 0) {
    recommendation = "Chỉ có dữ liệu Google. Kết nối Facebook Ads để so sánh hiệu quả kênh.";
  } else {
    recommendation = "Chưa có đủ dữ liệu để so sánh kênh trong khoảng thời gian này.";
  }

  return NextResponse.json({
    success: true,
    summary: {
      total:    { spend: totalSpend, leads: totalLeads, clicks: totalClicks, cpl: totalCpl, declaredValue: fbDeclared + ggDeclared },
      facebook: { spend: fbSpend,  leads: fbLeads,  clicks: fbClicks,  cpl: fbCpl,  budgetPct: fbBudgetPct, leadsBasis: FB_LEADS_BASIS, declaredValue: fbDeclared, error: fbError },
      google:   { spend: ggSpend,  leads: ggLeads,  clicks: ggClicks,  cpl: ggCpl,  budgetPct: ggBudgetPct, leadsBasis: GG_LEADS_BASIS, declaredValue: ggDeclared, error: ggError },
      insight:  { betterChannel, cplDiffPct, shouldRebalance, recommendation, comparable },
      mbcRevenue: { value: mbcRevenue, error: mbcRevenueError },
      mbiOrders: { value: mbiOrders, error: mbiOrdersError },
    },
    breakdown: [
      { channel: "facebook", error: fbError },
      { channel: "google",   gg: ggError ? { error: ggError } : null },
    ],
  });
}
