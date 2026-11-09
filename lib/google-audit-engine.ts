import { enums } from "google-ads-api";
import { getGoogleAdsCustomer } from "./google-ads-client";
import { enumName } from "./google-ads-enums";
import { generateAuditInsight } from "./google-audit-ai";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import type { TFunction } from "@/lib/i18n/translate";
import { viT, nfOf } from "@/lib/google-i18n";
export interface AuditCheck {
  id: string;
  name: string;
  description: string;
  score: number;       // 0 to 10
  status: "PASS" | "WARNING" | "FAIL";
  recommendation: string;
  /**
   * Chất lượng DỮ LIỆU đứng sau kết luận — tách hẳn khỏi `status`.
   *  - OK          : đọc đủ, kết luận đáng tin.
   *  - UNREADABLE  : truy vấn hỏng. Kết luận KHÔNG có giá trị và tiêu chí
   *                  này bị loại khỏi điểm tổng.
   *  - PARTIAL     : đọc được nhưng chạm trần LIMIT, kết luận tính trên
   *                  một phần dữ liệu.
   * Trước đây helper q() nuốt lỗi thành mảng rỗng, nên truy vấn hỏng biến
   * thành "không có Shared Negative List nào" (FAIL bịa ra) hoặc "ngân
   * sách phân phối hiệu quả" (PASS bịa ra) — và cả hai đều được cộng vào
   * điểm tổng như thể là sự thật.
   */
  dataStatus: "OK" | "UNREADABLE" | "PARTIAL";
  dataNote?: string;
  /** Tiêu chí này có nút Auto-Fix thực sự mutate tài khoản hay không. */
  fixable: boolean;
}

export interface AuditResult {
  overallScore: number;
  letterGrade: string;
  checks: AuditCheck[];
  // Real Gemini-generated summary (lib/google-audit-ai.ts) — null when
  // GEMINI_API_KEY/GOOGLE_AUDIT_AI_ENABLED is off, the call times out, or
  // errors. Deliberately not backfilled with rule-based text on failure:
  // this field exists specifically to make "AI" honest, so it must never
  // silently contain non-AI content.
  aiInsight: string | null;
  /** Số tiêu chí bị loại khỏi điểm vì không đọc được dữ liệu. */
  unreadableCount: number;
  /** Mẫu số thật của điểm tổng (14 tiêu chí + 3 PMax nếu có, trừ tiêu chí không đọc được). */
  scoredCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

interface QueryOutcome {
  ok: boolean;
  rows: Row[];
  /** Số dòng trả về đã chạm trần LIMIT → kết quả bị cắt cụt. */
  capped: boolean;
  err: string | null;
}

/** Trần LIMIT của các truy vấn có giới hạn — khai báo một chỗ để thông báo
 *  cho người dùng khớp với con số thật trong GAQL. */
const CAP_SEARCH_TERMS = 200;
const CAP_QUALITY_SCORE = 500;
const CAP_LANDING_PAGES = 50;

export class GoogleAuditEngine {
  async runAudit(customerId: string, t: TFunction = viT): Promise<AuditResult> {
    const company: string =
      customerId === process.env.GOOGLE_ADS_CUSTOMER_ID_MBI?.replace(/-/g, "")
        ? "MBI"
        : "MBC";

    const customer = getGoogleAdsCustomer(company);

    /**
     * Truy vấn có BÁO LỖI. Trước đây `catch { return [] }` biến mọi truy vấn
     * hỏng thành "không tìm thấy gì" — nghĩa là hạ tầng hỏng và tài khoản
     * sạch sẽ trả về cùng một kết quả. `cap` là trần LIMIT của truy vấn (nếu
     * có) để biết kết quả có bị cắt cụt không.
     */
    async function q(gaql: string, cap?: number): Promise<QueryOutcome> {
      try {
        const rows = (await customer.query(gaql)) as Row[];
        return { ok: true, rows, capped: cap !== undefined && rows.length >= cap, err: null };
      } catch (e) {
        const err = googleAdsErrorMessage(e);
        return { ok: false, rows: [], capped: false, err };
      }
    }

    /** Dựng phần data-honesty cho một tiêu chí từ (các) truy vấn nó dựa vào. */
    function dataOf(...sources: QueryOutcome[]): Pick<AuditCheck, "dataStatus" | "dataNote"> {
      const broken = sources.filter((r) => !r.ok);
      if (broken.length > 0) {
        return {
          dataStatus: "UNREADABLE",
          dataNote: t("libgoogle.ae.noRead", { err: broken.map((b) => b.err).join(" · ") }),
        };
      }
      if (sources.some((r) => r.capped)) {
        return {
          dataStatus: "PARTIAL",
          dataNote: t("libgoogle.ae.capped"),
        };
      }
      return { dataStatus: "OK" };
    }

    // Run all 14 checks in parallel — each isolated so one failure doesn't block others
    const [
      campQ,
      budgetQ,
      rsaQ,
      extensionQ,
      searchTermQ,
      negListQ,
      kwQ,
      qsQ,
      convQ,
      geoQ,
      deviceQ,
      lpQ,
      impressionShareQ,
      biddingStrategyQ,
    ] = await Promise.all([
      // 1. Campaign count
      q(`SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`),

      // 2. Budget utilization
      q(`SELECT campaign.id, metrics.cost_micros, campaign_budget.amount_micros
         FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`),

      // 3. Ad Strength — real per-ad quality rating, not just "has any ad"
      q(`SELECT ad_group_ad.ad.id, ad_group_ad.ad_strength FROM ad_group_ad WHERE ad_group_ad.status = 'ENABLED'`),

      // 4. Ad Extensions / Assets
      q(`SELECT campaign_extension_setting.extension_type FROM campaign_extension_setting
         WHERE campaign.status = 'ENABLED'`),

      // 5. Search Term Waste — terms with cost but zero conversions
      q(`SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions
         FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.cost_micros > 1000000
         ORDER BY metrics.cost_micros DESC LIMIT ${CAP_SEARCH_TERMS}`, CAP_SEARCH_TERMS),

      // 6. Shared Negative Keyword Lists
      q(`SELECT shared_set.name, shared_set.status, shared_set.type FROM shared_set
         WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'`),

      // 7. Ad Group Keyword Coverage
      q(`SELECT ad_group.id, ad_group_criterion.criterion_id FROM ad_group_criterion
         WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status = 'ENABLED'
         AND campaign.status = 'ENABLED'`),

      // 8. Quality Score
      q(`SELECT ad_group_criterion.quality_info.quality_score FROM ad_group_criterion
         WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status = 'ENABLED'
         AND campaign.status = 'ENABLED' LIMIT ${CAP_QUALITY_SCORE}`, CAP_QUALITY_SCORE),

      // 9. Conversion Health
      q(`SELECT conversion_action.name, conversion_action.status FROM conversion_action
         WHERE conversion_action.status = 'ENABLED'`),

      // 10. Geographic Accuracy — location criteria + Presence vs Interest targeting mode
      q(`SELECT campaign.id, campaign_criterion.type, campaign.geo_target_type_setting.positive_geo_target_type
         FROM campaign_criterion
         WHERE campaign_criterion.type = 'LOCATION' AND campaign.status = 'ENABLED'`),

      // 11. Device Bid — CPA by device
      q(`SELECT segments.device, metrics.cost_micros, metrics.conversions FROM campaign
         WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS
         AND segments.device IN ('MOBILE', 'DESKTOP')`),

      // 12. Landing Page — mobile friendly score proxy
      q(`SELECT landing_page_view.unexpanded_final_url, metrics.mobile_friendly_clicks_percentage
         FROM landing_page_view WHERE segments.date DURING LAST_30_DAYS LIMIT ${CAP_LANDING_PAGES}`, CAP_LANDING_PAGES),

      // 13. Impression Share Lost (budget vs rank) — Search campaigns only
      q(`SELECT campaign.id, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
         FROM campaign WHERE campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH'
         AND segments.date DURING LAST_30_DAYS`),

      // 14. Bidding Strategy Coverage — manual vs smart bidding among conversioning campaigns
      q(`SELECT campaign.id, campaign.bidding_strategy_type, metrics.conversions FROM campaign
         WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS`),
    ]);

    const campRows = campQ.rows;
    const budgetRows = budgetQ.rows;
    const rsaRows = rsaQ.rows;
    const extensionRows = extensionQ.rows;
    const searchTermRows = searchTermQ.rows;
    const negListRows = negListQ.rows;
    const kwRows = kwQ.rows;
    const qsRows = qsQ.rows;
    const convRows = convQ.rows;
    const geoRows = geoQ.rows;
    const deviceRows = deviceQ.rows;
    const lpRows = lpQ.rows;
    const impressionShareRows = impressionShareQ.rows;
    const biddingStrategyRows = biddingStrategyQ.rows;

    const checks: AuditCheck[] = [];

    // ── 1. Account Structure ──
    {
      const count = campRows.length;
      let score = 9; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.structOk", { n: count });
      if (count > 25) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.structMany", { n: count }); }
      else if (count === 0) { score = 3; status = "FAIL"; rec = t("libgoogle.ae.structNone"); }
      checks.push({ id: "campaign_count", name: "Account Structure", description: t("libgoogle.ae.structDesc"), score, status, recommendation: rec, ...dataOf(campQ), fixable: false });
    }

    // ── 2. Budget Utilization ──
    {
      // campaign_budget.amount_micros là ngân sách MỘT NGÀY, còn
      // metrics.cost_micros ở đây là tổng chi 30 ngày. So thẳng hai con số
      // này (bản cũ: `spend < budget * 0.3`) tức là so chi-30-ngày với 30%
      // của MỘT ngày — sai 100 lần, nên gần như không campaign nào lọt và
      // tiêu chí này luôn PASS. Chính route auto-fix lại nhân 30 cho đúng,
      // nên hai bên đưa ra kết luận trái ngược nhau trên cùng dữ liệu.
      const DAYS_IN_WINDOW = 30;
      let underSpent = 0;
      budgetRows.forEach((r: Row) => {
        const dailyBudget = Number(r.campaign_budget?.amount_micros ?? 0);
        const spend30d    = Number(r.metrics?.cost_micros ?? 0);
        const budget30d   = dailyBudget * DAYS_IN_WINDOW;
        if (budget30d > 0 && spend30d < budget30d * 0.3) underSpent++;
      });
      const total = budgetRows.length || 1;
      const pct = Math.round((underSpent / total) * 100);
      let score = 9; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.budOk");
      if (underSpent > 0) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.budLow", { u: underSpent, total, pct }); }
      checks.push({ id: "budget_utilization", name: "Budget Utilization", description: t("libgoogle.ae.budDesc"), score, status, recommendation: rec, ...dataOf(budgetQ), fixable: false });
    }

    // ── 3. Ad Strength ──
    {
      const strengths = rsaRows.map((r: Row) => enumName(enums.AdStrength, r.ad_group_ad?.ad_strength));
      const rated = strengths.filter((s: string) => s !== "UNKNOWN" && s !== "UNSPECIFIED" && s !== "PENDING" && s !== "NO_ADS");
      const goodCount = rated.filter((s: string) => s === "GOOD" || s === "EXCELLENT").length;
      const total = rated.length || 1;
      const pct = Math.round((goodCount / total) * 100);
      let score = 8; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.adsOk", { pct });
      if (rated.length === 0) { score = 4; status = "WARNING"; rec = t("libgoogle.ae.adsNone"); }
      else if (pct < 40) { score = 4; status = "FAIL"; rec = t("libgoogle.ae.adsFail", { pct }); }
      else if (pct < 65) { score = 6; status = "WARNING"; rec = t("libgoogle.ae.adsWarn", { pct }); }
      checks.push({ id: "ad_strength", name: "Ad Strength", description: t("libgoogle.ae.adsDesc"), score, status, recommendation: rec, ...dataOf(rsaQ), fixable: false });
    }

    // ── 4. Ad Assets (Extensions) ──
    {
      const uniqueTypes = new Set(extensionRows.map((r: Row) => r.campaign_extension_setting?.extension_type));
      const count = uniqueTypes.size;
      let score = 4; let status: "PASS" | "WARNING" | "FAIL" = "FAIL";
      let rec = t("libgoogle.ae.extNone");
      if (count >= 3) { score = 9; status = "PASS"; rec = t("libgoogle.ae.extGood", { n: count, types: [...uniqueTypes].join(", ").toLowerCase() }); }
      else if (count > 0) { score = 6; status = "WARNING"; rec = t("libgoogle.ae.extFew", { n: count }); }
      checks.push({ id: "ad_extensions", name: "Ad Assets (Extensions)", description: t("libgoogle.ae.extDesc"), score, status, recommendation: rec, ...dataOf(extensionQ), fixable: false });
    }

    // ── 5. Search Term Waste ──
    {
      const wastedRows = searchTermRows.filter((r: Row) => Number(r.metrics?.conversions ?? 0) === 0);
      const totalCost  = searchTermRows.reduce((s: number, r: Row) => s + Number(r.metrics?.cost_micros ?? 0), 0);
      const wastedCost = wastedRows.reduce((s: number, r: Row) => s + Number(r.metrics?.cost_micros ?? 0), 0);
      const wastedPct  = totalCost > 0 ? Math.round((wastedCost / totalCost) * 100) : 0;
      let score = 8; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.stwOk");
      if (wastedPct > 50) { score = 3; status = "FAIL"; rec = t("libgoogle.ae.stwFail", { pct: wastedPct, n: wastedRows.length }); }
      else if (wastedPct > 25) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.stwWarn", { pct: wastedPct, n: wastedRows.length }); }
      checks.push({ id: "search_term_waste", name: "Search Term Waste", description: t("libgoogle.ae.stwDesc"), score, status, recommendation: rec, ...dataOf(searchTermQ), fixable: true });
    }

    // ── 6. Shared Negative Keyword Lists ──
    {
      const count = negListRows.length;
      let score = 4; let status: "PASS" | "WARNING" | "FAIL" = "FAIL";
      let rec = t("libgoogle.ae.negNone");
      if (count >= 2) { score = 10; status = "PASS"; rec = t("libgoogle.ae.negMany", { n: count }); }
      else if (count === 1) { score = 7; status = "PASS"; rec = t("libgoogle.ae.negOne"); }
      checks.push({ id: "negative_lists", name: "Shared Negative Keyword Lists", description: t("libgoogle.ae.negDesc"), score, status, recommendation: rec, ...dataOf(negListQ), fixable: false });
    }

    // ── 7. Ad Group Keyword Coverage ──
    {
      const grouped: Record<string, number> = {};
      kwRows.forEach((r: Row) => {
        const id = String(r.ad_group?.id ?? "unknown");
        grouped[id] = (grouped[id] ?? 0) + 1;
      });
      const groups = Object.values(grouped);
      const avgKw = groups.length > 0 ? Math.round(groups.reduce((a, b) => a + b, 0) / groups.length) : 0;
      const tooMany = groups.filter(c => c > 20).length;
      const tooFew  = groups.filter(c => c < 3).length;
      let score = 9; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.kwOk", { avg: avgKw });
      if (tooMany > 0 || tooFew > groups.length * 0.3) {
        score = 6; status = "WARNING";
        rec = t("libgoogle.ae.kwWarn", { many: tooMany, few: tooFew, avg: avgKw });
      }
      if (groups.length === 0) { score = 3; status = "FAIL"; rec = t("libgoogle.ae.kwNone"); }
      checks.push({ id: "keyword_coverage", name: "Ad Group Keyword Coverage", description: t("libgoogle.ae.kwDesc"), score, status, recommendation: rec, ...dataOf(kwQ), fixable: false });
    }

    // ── 8. Quality Score Distribution ──
    {
      const scores = qsRows.map((r: Row) => Number(r.ad_group_criterion?.quality_info?.quality_score ?? 0)).filter(s => s > 0);
      const highQS = scores.filter(s => s >= 7).length;
      const total  = scores.length || 1;
      const pct    = Math.round((highQS / total) * 100);
      const avg    = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : 0;
      let score = 8; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.qsOk", { pct, avg });
      if (pct < 40) { score = 4; status = "FAIL"; rec = t("libgoogle.ae.qsFail", { pct, avg }); }
      else if (pct < 65) { score = 6; status = "WARNING"; rec = t("libgoogle.ae.qsWarn", { pct, avg }); }
      if (scores.length === 0) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.qsNone"); }
      checks.push({ id: "quality_score", name: "Quality Score Distribution", description: t("libgoogle.ae.qsDesc"), score, status, recommendation: rec, ...dataOf(qsQ), fixable: true });
    }

    // ── 9. Conversion Health ──
    {
      const count = convRows.length;
      let score = 4; let status: "PASS" | "WARNING" | "FAIL" = "FAIL";
      let rec = t("libgoogle.ae.convNone");
      if (count >= 2) { score = 10; status = "PASS"; rec = t("libgoogle.ae.convMany", { n: count }); }
      else if (count === 1) { score = 7; status = "PASS"; rec = t("libgoogle.ae.convOne"); }
      checks.push({ id: "conversion_tracking", name: "Conversion Health", description: t("libgoogle.ae.convDesc"), score, status, recommendation: rec, ...dataOf(convQ), fixable: false });
    }

    // ── 10. Geographic Accuracy ──
    {
      // Mỗi dòng là MỘT tiêu chí vị trí, không phải một campaign: campaign
      // nhắm 20 tỉnh sẽ đếm thành 20. Bản cũ chia trên số dòng rồi gọi kết
      // quả là "% campaign" — một campaign nhiều tỉnh lấn át phần còn lại.
      // Nay gom theo campaign.id trước khi tính tỷ lệ.
      const geoByCampaign = new Map<string, string>();
      geoRows.forEach((r: Row) => {
        const cid = String(r.campaign?.id ?? "");
        if (!cid) return;
        geoByCampaign.set(cid, enumName(enums.PositiveGeoTargetType, r.campaign?.geo_target_type_setting?.positive_geo_target_type));
      });
      const criteriaCount = geoRows.length;
      const count = geoByCampaign.size;
      let score = 4; let status: "PASS" | "WARNING" | "FAIL" = "FAIL";
      let rec = t("libgoogle.ae.geoNone");
      if (count > 0) {
        const modes = [...geoByCampaign.values()];
        const presenceOrInterest = modes.filter((t) => t === "PRESENCE_OR_INTEREST").length;
        const presencePct = Math.round(((count - presenceOrInterest) / count) * 100);
        score = 10; status = "PASS"; rec = t("libgoogle.ae.geoOk", { n: count, c: criteriaCount });
        if (presenceOrInterest > count / 2) {
          score = 7; status = "WARNING";
          rec = t("libgoogle.ae.geoWarn", { n: count, pct: presencePct });
        }
      }
      checks.push({ id: "geo_targeting", name: "Geographic Accuracy", description: t("libgoogle.ae.geoDesc"), score, status, recommendation: rec, ...dataOf(geoQ), fixable: false });
    }

    // ── 11. Device Bid Adjustments ──
    {
      const deviceMap: Record<string, { cost: number; conv: number }> = {};
      deviceRows.forEach((r: Row) => {
        const dev  = enumName(enums.Device, r.segments?.device);
        const cost = Number(r.metrics?.cost_micros ?? 0);
        const conv = Number(r.metrics?.conversions ?? 0);
        if (!deviceMap[dev]) deviceMap[dev] = { cost: 0, conv: 0 };
        deviceMap[dev].cost += cost;
        deviceMap[dev].conv += conv;
      });

      const mobile  = deviceMap["MOBILE"]  ?? { cost: 0, conv: 0 };
      const desktop = deviceMap["DESKTOP"] ?? { cost: 0, conv: 0 };
      const cpaMobile  = mobile.conv  > 0 ? mobile.cost  / mobile.conv  : 0;
      const cpaDesktop = desktop.conv > 0 ? desktop.cost / desktop.conv : 0;
      const ratio = cpaDesktop > 0 && cpaMobile > 0 ? cpaMobile / cpaDesktop : 1;

      let score = 8; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.devOk");
      if (ratio > 2.5) { score = 4; status = "FAIL"; rec = t("libgoogle.ae.devFail", { r: ratio.toFixed(1) }); }
      else if (ratio > 1.5) { score = 6; status = "WARNING"; rec = t("libgoogle.ae.devWarn", { r: ratio.toFixed(1) }); }
      if (cpaMobile === 0 && cpaDesktop === 0) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.devNone"); }
      checks.push({ id: "device_bid", name: "Device Bid Adjustments", description: t("libgoogle.ae.devDesc"), score, status, recommendation: rec, ...dataOf(deviceQ), fixable: true });
    }

    // ── 12. Landing Page — Mobile Friendliness ──
    // Named for what this actually measures: metrics.mobile_friendly_clicks_percentage.
    // Google Ads API doesn't expose real page-speed/Core Web Vitals data — this is
    // NOT a speed metric, despite the check's old name implying otherwise.
    {
      const scores = lpRows
        .map((r: Row) => Number(r.metrics?.mobile_friendly_clicks_percentage ?? -1))
        .filter((s: number) => s >= 0);
      const avg = scores.length > 0
        ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
        : -1;
      let score = 7; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.lpOk");
      if (avg >= 0) {
        if (avg < 50) { score = 3; status = "FAIL"; rec = t("libgoogle.ae.lpFail", { avg }); }
        else if (avg < 75) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.lpWarn", { avg }); }
        else { score = 9; status = "PASS"; rec = t("libgoogle.ae.lpGood", { avg }); }
      } else if (lpRows.length > 0) {
        // Có trang đích, chỉ là Google không trả chỉ số mobile-friendly cho
        // dòng nào. Nói "kiểm tra cấu hình tracking URL" ở đây là chỉ sai chỗ:
        // trang đích rõ ràng đang được ghi nhận, thứ thiếu là CHỈ SỐ.
        score = 5; status = "WARNING";
        rec = t("libgoogle.ae.lpNoMetric", { n: lpRows.length });
      } else {
        score = 5; status = "WARNING";
        rec = t("libgoogle.ae.lpNone");
      }
      checks.push({ id: "lp_speed", name: "Landing Page — Mobile Friendliness", description: t("libgoogle.ae.lpDesc"), score, status, recommendation: rec, ...dataOf(lpQ), fixable: false });
    }

    // ── 13. Impression Share Lost (Budget vs Rank) ──
    {
      const validRows = impressionShareRows.filter((r: Row) =>
        Number(r.metrics?.search_budget_lost_impression_share ?? -1) >= 0 ||
        Number(r.metrics?.search_rank_lost_impression_share ?? -1) >= 0
      );
      const budgetLostVals = validRows.map((r: Row) => Number(r.metrics?.search_budget_lost_impression_share ?? 0));
      const rankLostVals = validRows.map((r: Row) => Number(r.metrics?.search_rank_lost_impression_share ?? 0));
      const avgBudgetLostPct = budgetLostVals.length > 0 ? Math.round((budgetLostVals.reduce((a: number, b: number) => a + b, 0) / budgetLostVals.length) * 100) : 0;
      const avgRankLostPct = rankLostVals.length > 0 ? Math.round((rankLostVals.reduce((a: number, b: number) => a + b, 0) / rankLostVals.length) * 100) : 0;
      const worstPct = Math.max(avgBudgetLostPct, avgRankLostPct);
      const cause = avgBudgetLostPct >= avgRankLostPct ? t("libgoogle.ae.causeBudget") : t("libgoogle.ae.causeRank");
      const fixHint = avgBudgetLostPct >= avgRankLostPct
        ? t("libgoogle.ae.fixBudget")
        : t("libgoogle.ae.fixRank");

      let score = 9; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.isOk");
      if (validRows.length === 0) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.isNone"); }
      else if (worstPct > 40) { score = 3; status = "FAIL"; rec = t("libgoogle.ae.isFail", { pct: worstPct, cause, fix: fixHint }); }
      else if (worstPct > 20) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.isWarn", { pct: worstPct, cause, fix: fixHint }); }
      checks.push({ id: "impression_share", name: "Impression Share Lost", description: t("libgoogle.ae.isDesc"), score, status, recommendation: rec, ...dataOf(impressionShareQ), fixable: false });
    }

    // ── 14. Bidding Strategy Coverage ──
    {
      const MANUAL_TYPES = new Set(["MANUAL_CPC", "MANUAL_CPM", "MANUAL_CPV", "MANUAL_CPA"]);
      const conversioning = biddingStrategyRows.filter((r: Row) => Number(r.metrics?.conversions ?? 0) > 0);
      const manualConversioning = conversioning.filter((r: Row) => MANUAL_TYPES.has(enumName(enums.BiddingStrategyType, r.campaign?.bidding_strategy_type)));
      const totalConversioning = conversioning.length;
      const pct = totalConversioning > 0 ? Math.round((manualConversioning.length / totalConversioning) * 100) : 0;

      let score = 9; let status: "PASS" | "WARNING" | "FAIL" = "PASS";
      let rec = t("libgoogle.ae.bidOk");
      if (totalConversioning === 0) { score = 5; status = "WARNING"; rec = t("libgoogle.ae.bidNone"); }
      else if (pct > 30) { score = 6; status = "WARNING"; rec = t("libgoogle.ae.bidWarn", { m: manualConversioning.length, total: totalConversioning, pct }); }
      checks.push({ id: "bidding_strategy", name: "Bidding Strategy Coverage", description: t("libgoogle.ae.bidDesc"), score, status, recommendation: rec, ...dataOf(biddingStrategyQ), fixable: false });
    }

    // ── Đợt 10a · F2: kiểm tra PMax — cùng dữ liệu với trang PMax X-quang ──
    try {
      const { pmaxXray } = await import("@/lib/pmax/xray");
      const { pmaxAuditChecks } = await import("@/lib/pmax/audit-checks");
      const { lastDays } = await import("@/lib/case/dates");
      checks.push(...pmaxAuditChecks(await pmaxXray(company, lastDays(30), {}, t), null, t));
    } catch (e) {
      const { pmaxAuditChecks } = await import("@/lib/pmax/audit-checks");
      checks.push(...pmaxAuditChecks(null, e instanceof Error ? e.message : String(e), t));
    }

    // Tiêu chí không đọc được KHÔNG được tính điểm. Trước đây truy vấn hỏng
    // trả mảng rỗng, và mảng rỗng lại được diễn giải thành kết luận thật —
    // "không có Shared Negative List nào" (FAIL, 4 điểm) hay "ngân sách phân
    // phối hiệu quả" (PASS, 9 điểm) — rồi cộng thẳng vào điểm tổng. Điểm A
    // hay điểm F đều có thể sinh ra từ một sự cố mạng.
    const scored      = checks.filter((c) => c.dataStatus !== "UNREADABLE");
    const unreadable  = checks.filter((c) => c.dataStatus === "UNREADABLE");
    const totalScore  = scored.reduce((sum, c) => sum + c.score, 0);
    const overallScore = scored.length > 0
      ? Math.round((totalScore / (scored.length * 10)) * 100)
      : 0;

    // Điểm không đọc được thì cho điểm 0 và nói thẳng, thay vì để nguyên
    // điểm bịa mà tiêu chí đã tự gán khi thấy mảng rỗng.
    for (const c of unreadable) {
      c.score = 0;
      c.status = "WARNING";
      c.recommendation = t("libgoogle.ae.unreadable", { note: c.dataNote ?? t("libgoogle.ae.unreadableDefault") });
    }

    // Không đọc được tiêu chí NÀO thì không có điểm nào để chấm. Để rơi
    // xuống "F" sẽ vẽ một chữ F đỏ chót cho một sự cố kết nối — đúng kiểu
    // kết luận bịa mà cả thay đổi này sinh ra để dẹp.
    let letterGrade = "F";
    if (scored.length === 0)     letterGrade = "?";
    else if (overallScore >= 90) letterGrade = "A+";
    else if (overallScore >= 80) letterGrade = "A";
    else if (overallScore >= 70) letterGrade = "B";
    else if (overallScore >= 60) letterGrade = "C";
    else if (overallScore >= 50) letterGrade = "D";

    // Không gọi Gemini khi chẳng có dữ liệu nào để tóm tắt — vừa tốn tiền
    // vừa mời AI bình luận về những kết luận không tồn tại.
    const aiInsight = scored.length === 0 ? null : await generateAuditInsight(
      { overallScore, letterGrade, checks, aiInsight: null, unreadableCount: unreadable.length, scoredCount: scored.length },
      company,
      nfOf(t) === nfOf(viT) ? "vi" : "en"
    );

    return {
      overallScore,
      letterGrade,
      checks,
      aiInsight,
      unreadableCount: unreadable.length,
      scoredCount: scored.length,
    };
  }
}

export const googleAuditEngine = new GoogleAuditEngine();
