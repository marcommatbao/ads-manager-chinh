// ============================================================
// Giá thầu thủ công — đề xuất từ dữ liệu đã chạy
// ============================================================
// Trả lời câu "chiến dịch chạy một thời gian rồi, giá thầu thủ công bao nhiêu
// là vừa" bằng HAI ràng buộc độc lập, rồi mới hoà giải:
//
//   1. TRẦN CHI TRẢ  = mục tiêu CPA × tỷ lệ chuyển đổi
//      Đây là mức cao nhất còn có lãi. Trả hơn mức này thì mỗi lượt chuyển
//      đổi đắt hơn mục tiêu, bất kể quảng cáo hiển thị đẹp đến đâu.
//
//   2. SÀN THỊ TRƯỜNG = ước tính của chính Google
//      (first_page_cpc / top_of_page_cpc). Đặt dưới sàn trang đầu thì gần như
//      không mua được lượt hiển thị nào — tiết kiệm trên giấy, thực tế là tắt
//      quảng cáo mà không biết.
//
// Hai ràng buộc này có thể MÂU THUẪN: trần chi trả thấp hơn sàn trang đầu
// nghĩa là với tỷ lệ chuyển đổi hiện tại, KHÔNG có giá thầu nào vừa đủ rẻ vừa
// hiện được. Lúc đó câu trả lời đúng không phải một con số giá thầu mà là
// "sửa tỷ lệ chuyển đổi / điểm chất lượng, hoặc bỏ từ khoá này" — và engine
// nói thẳng như vậy thay vì nặn ra một con số vô nghĩa.
//
// Về "đã chạy thời gian": số lượt chuyển đổi mới là thứ quyết định tin được
// hay không, không phải số ngày. 2 chuyển đổi trên 40 lượt nhấp cho tỷ lệ 5%
// nhưng khoảng tin cậy trải từ ~1% tới ~17% — tức giá thầu đề xuất có thể sai
// hơn mười lần. Vì vậy mọi đề xuất đi kèm KHOẢNG, dựng từ khoảng tin cậy
// Wilson, và mẫu mỏng thì hạ mức tự tin xuống chứ không giấu.

import { enums } from "google-ads-api";
import type { TFunction } from "@/lib/i18n/translate";
import { viT, nfOf } from "@/lib/google-i18n";
import { dateClauseForDays } from "@/lib/google-date-range";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { enumName } from "@/lib/google-ads-enums";
import { getCPLTarget } from "@/lib/cpl-targets";
import { resolveMatchType } from "@/lib/google-ads-helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MICROS = 1_000_000;

/** Sàn tuyệt đối khi ghi giá thầu, tính bằng ĐỒNG.
 *
 *  Cẩn thận đơn vị: Google đo tiền bằng "micros", 1 đồng = 1.000.000 micros.
 *  Nên ₫1.000 là 1_000_000_000 micros, KHÔNG phải 1_000_000. Hằng số
 *  MIN_CPC_MICROS ở app/api/google/audit/auto-fix/route.ts từng ghi
 *  `1_000_000 // ₫1.000` — tức sàn thật chỉ là ₫1, và cái chốt "bỏ qua vì
 *  cắt tiếp sẽ xuống dưới sàn" ở đó chưa từng chặn được gì. Engine này làm
 *  việc bằng đồng để khỏi vấp lại. */
export const MIN_CPC_VND = 1_000;

/** Mức chuyển đổi/tháng mà Smart Bidding có đủ tín hiệu để học. Dưới mức này
 *  đấu thầu tự động thường loạng choạng và thủ công mới có cửa; trên mức này
 *  chuyển sang thủ công thường là bước lùi. Mốc tham chiếu chung của ngành,
 *  không phải chuẩn riêng tài khoản — nên chỉ dùng để CẢNH BÁO, không để chặn. */
const SMART_BIDDING_LEARNS_AT = 15;

/** Đủ dữ liệu để tin tỷ lệ chuyển đổi của CHÍNH từ khoá đó. */
const KW_ENOUGH_CLICKS = 30;
const KW_ENOUGH_CONV = 3;
/** Đủ để mượn tỷ lệ chuyển đổi của chiến dịch khi từ khoá quá mỏng. */
const CAMP_ENOUGH_CLICKS = 100;
const CAMP_ENOUGH_CONV = 10;

/** Lệch dưới mức này coi như đang đặt đúng — cùng biên ±15% mà
 *  app/api/improvements/keywords/route.ts đã dùng, để hai màn hình không
 *  nói hai kiểu về cùng một từ khoá. */
const ON_TRACK_BAND = 0.15;

export type BidConfidence = "du" | "tam" | "thieu";
export type BidVerdict = "giam" | "tang" | "giu" | "khong_dat_duoc" | "thieu_du_lieu";

export interface KeywordBidRec {
  resourceName: string;
  text: string;
  matchType: string;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;

  clicks: number;
  conversions: number;
  cost: number;
  avgCpc: number;
  qualityScore: number | null;
  /** Giá thầu đang đặt (đ) */
  currentBid: number;

  /** Tỷ lệ chuyển đổi dùng để tính, và khoảng tin cậy 90% của nó */
  cvr: number;
  cvrLow: number;
  cvrHigh: number;
  /** "keyword" = số của chính từ khoá; "campaign" = mượn của chiến dịch */
  cvrSource: "keyword" | "campaign" | "none";

  targetCpa: number;
  targetCpaSource: "google" | "noi_bo";

  /** Ước tính của Google — null khi Google không trả (từ khoá quá mới/ít dữ liệu) */
  firstPageCpc: number | null;
  topOfPageCpc: number | null;

  /** Trần chi trả và khoảng của nó */
  affordableCeiling: number;
  bidRange: [number, number] | null;
  /** Con số cuối cùng đề xuất; null khi không đề xuất được */
  recommendedBid: number | null;

  confidence: BidConfidence;
  verdict: BidVerdict;
  reason: string;
  /** Phần đang trả VƯỢT trần mỗi tháng, nếu lượt nhấp giữ nguyên. */
  overspendPerMonth: number;
}

export interface CampaignBidSummary {
  campaignId: string;
  campaignName: string;
  company: string;
  biddingStrategy: string;
  /** Chỉ chiến dịch đang chạy MANUAL_CPC mới ghi giá thầu được */
  isManualCpc: boolean;
  canApply: boolean;
  /** Cảnh báo khi chiến dịch đang chạy đấu thầu tự động */
  gateNote: string | null;
  /** true = nên DỪNG (ĐỪNG chuyển sang thủ công) — cờ ổn định thay cho việc dò chữ trong gateNote. */
  gateStop: boolean;

  days: number;
  clicks: number;
  conversions: number;
  cost: number;

  keywordCount: number;
  countGiam: number;
  countTang: number;
  countGiu: number;
  countKhongDatDuoc: number;
  countThieuDuLieu: number;
  overspendPerMonth: number;

  keywords: KeywordBidRec[];
}

// ─────────────────────────────────────────────
// Khoảng tin cậy Wilson
// ─────────────────────────────────────────────
// Dùng Wilson chứ không dùng công thức sai số chuẩn thông thường: với tỷ lệ
// nhỏ và mẫu ít — đúng cảnh của tỷ lệ chuyển đổi quảng cáo — công thức thường
// cho cận dưới ÂM, vô nghĩa với một tỷ lệ. Wilson luôn nằm trong [0,1] và
// lệch về phía an toàn khi mẫu mỏng.
export function wilsonInterval(successes: number, trials: number, z = 1.645): { low: number; high: number } {
  if (trials <= 0) return { low: 0, high: 0 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

// ─────────────────────────────────────────────
// Tính đề xuất cho một từ khoá
// ─────────────────────────────────────────────

interface ComputeInput {
  clicks: number;
  conversions: number;
  currentBid: number;
  avgCpc: number;
  qualityScore: number | null;
  targetCpa: number;
  firstPageCpc: number | null;
  topOfPageCpc: number | null;
  campaignClicks: number;
  campaignConversions: number;
  /** Số ngày của khoảng dữ liệu, để quy đổi mức vượt trần ra mỗi tháng */
  days: number;
}

export function computeKeywordBid(i: ComputeInput, t: TFunction = viT): Pick<
  KeywordBidRec,
  "cvr" | "cvrLow" | "cvrHigh" | "cvrSource" | "affordableCeiling" | "bidRange"
  | "recommendedBid" | "confidence" | "verdict" | "reason" | "overspendPerMonth"
> {
  const none = {
    cvr: 0, cvrLow: 0, cvrHigh: 0, cvrSource: "none" as const,
    affordableCeiling: 0, bidRange: null, recommendedBid: null,
    overspendPerMonth: 0,
  };

  // ── Nguồn tỷ lệ chuyển đổi: của chính từ khoá nếu đủ dày, không thì mượn
  //    của chiến dịch. Mượn thì phải hạ mức tự tin, vì từ khoá này có thể
  //    chuyển đổi khác hẳn mặt bằng chiến dịch.
  let cvrSource: "keyword" | "campaign" | "none";
  let succ: number, trials: number, confidence: BidConfidence;

  if (i.clicks >= KW_ENOUGH_CLICKS && i.conversions >= KW_ENOUGH_CONV) {
    cvrSource = "keyword"; succ = i.conversions; trials = i.clicks; confidence = "du";
  } else if (i.campaignClicks >= CAMP_ENOUGH_CLICKS && i.campaignConversions >= CAMP_ENOUGH_CONV) {
    cvrSource = "campaign"; succ = i.campaignConversions; trials = i.campaignClicks; confidence = "tam";
  } else if (i.clicks > 0 && i.conversions > 0) {
    cvrSource = "keyword"; succ = i.conversions; trials = i.clicks; confidence = "thieu";
  } else {
    return {
      ...none, confidence: "thieu", verdict: "thieu_du_lieu",
      reason: t("libgoogle.mb.noData", { clicks: i.clicks }),
    };
  }

  let { low, high } = wilsonInterval(succ, trials);
  const cvr = succ / trials;

  // Mượn tỷ lệ của chiến dịch thì mượn cả ĐỘ CHÍNH XÁC của nó — mà độ chính
  // xác đó không thuộc về từ khoá này. Chiến dịch 2.000 lượt nhấp cho khoảng
  // rất hẹp, dán lên một từ khoá mới 40 lượt nhấp là hứa một mức chắc chắn
  // không có thật. Khi bản thân từ khoá đã có đủ lượt nhấp để nói được điều
  // gì đó, nới khoảng ra bao trùm cả hai nguồn: ta thực sự không biết từ khoá
  // này giống hay khác mặt bằng chiến dịch.
  if (cvrSource === "campaign" && i.clicks >= 10) {
    const own = wilsonInterval(i.conversions, i.clicks);
    low = Math.min(low, own.low);
    high = Math.max(high, own.high);
  }

  // ── Ràng buộc 1: trần chi trả ──
  const ceiling = i.targetCpa * cvr;
  const rangeLow = i.targetCpa * low;
  const rangeHigh = i.targetCpa * high;

  // ── Ràng buộc 2: sàn thị trường ──
  const floor = i.firstPageCpc;
  const monthFactor = i.days > 0 ? 30 / i.days : 1;

  // Mâu thuẫn: rẻ đủ để có lãi thì không hiện được
  if (floor !== null && ceiling < floor) {
    const qsNote = i.qualityScore !== null && i.qualityScore <= 4
      ? t("libgoogle.mb.qsNote", { qs: i.qualityScore })
      : "";
    return {
      cvr, cvrLow: low, cvrHigh: high, cvrSource,
      affordableCeiling: ceiling, bidRange: [rangeLow, rangeHigh], recommendedBid: null,
      confidence, verdict: "khong_dat_duoc",
      overspendPerMonth: i.avgCpc > ceiling ? Math.max(0, (i.avgCpc - ceiling) * i.clicks * monthFactor) : 0,
      reason: t("libgoogle.mb.unreachable", { ceil: fmt(ceiling, t), cpa: fmt(i.targetCpa, t), cvr: (cvr * 100).toFixed(1), floor: fmt(floor, t), qsNote }),
    };
  }

  // Không trả hơn mức cần để lên đầu trang: mục tiêu ở đây là tối ưu chi phí,
  // không phải giành vị trí bằng mọi giá.
  let recommended = ceiling;
  if (i.topOfPageCpc !== null && i.topOfPageCpc < recommended) recommended = i.topOfPageCpc;
  if (floor !== null && recommended < floor) recommended = floor;
  recommended = Math.max(recommended, MIN_CPC_VND);

  const ratio = i.currentBid > 0 ? i.currentBid / recommended : 0;
  let verdict: BidVerdict;
  if (i.currentBid <= 0) verdict = "giu";
  else if (ratio > 1 + ON_TRACK_BAND) verdict = "giam";
  else if (ratio < 1 - ON_TRACK_BAND) verdict = "tang";
  else verdict = "giu";

  // Mức vượt trần tính theo GIÁ THỰC TRẢ (avgCpc), không theo giá thầu: giá
  // thầu là mức trần bạn khai, còn tiền ra khỏi túi là avgCpc. Lấy giá thầu mà
  // tính sẽ thổi phồng khoản "tiết kiệm" lên nhiều lần.
  const overspend = i.avgCpc > recommended ? (i.avgCpc - recommended) * i.clicks * monthFactor : 0;

  const srcNote = cvrSource === "campaign"
    ? t("libgoogle.mb.srcCampaign", { cvr: (cvr * 100).toFixed(1), clicks: i.clicks, conv: i.conversions })
    : t("libgoogle.mb.srcKeyword", { conv: i.conversions, clicks: i.clicks });
  const rangeNote = t("libgoogle.mb.rangeNote", { lo: fmt(rangeLow, t), hi: fmt(rangeHigh, t) });
  const capNote = i.topOfPageCpc !== null && i.topOfPageCpc < ceiling
    ? t("libgoogle.mb.capNote", { top: fmt(i.topOfPageCpc, t) })
    : "";

  let reason: string;
  if (verdict === "giam") {
    reason = t("libgoogle.mb.reasonDown", { cur: fmt(i.currentBid, t), rec: fmt(recommended, t), pct: Math.round((ratio - 1) * 100), src: srcNote, cap: capNote, range: rangeNote });
  } else if (verdict === "tang") {
    reason = t("libgoogle.mb.reasonUp", { cur: fmt(i.currentBid, t), rec: fmt(recommended, t), pct: Math.round((1 - ratio) * 100), src: srcNote, range: rangeNote });
  } else {
    reason = t("libgoogle.mb.reasonHold", { cur: fmt(i.currentBid, t), rec: fmt(recommended, t), src: srcNote, range: rangeNote });
  }

  return {
    cvr, cvrLow: low, cvrHigh: high, cvrSource,
    affordableCeiling: ceiling, bidRange: [rangeLow, rangeHigh],
    recommendedBid: recommended, confidence, verdict, reason,
    overspendPerMonth: overspend,
  };
}

function fmt(v: number, t: TFunction = viT): string {
  return `₫${Math.round(v).toLocaleString(nfOf(t))}`;
}

// ─────────────────────────────────────────────
// Lấy dữ liệu thật từ Google Ads
// ─────────────────────────────────────────────

const SAFE_DAYS = new Set([14, 30, 60, 90]);

/** Chỉ nhận vài giá trị cố định rồi ghép thẳng vào GAQL — GAQL không có
 *  tham số ràng buộc nên mọi thứ đi vào câu truy vấn đều phải tự kiểm. */
function safeDays(days: number): number {
  return SAFE_DAYS.has(days) ? days : 30;
}

export async function fetchManualBidRecommendations(
  company: string,
  days = 30,
  campaignIdFilter?: string,
  t: TFunction = viT,
): Promise<{ campaigns: CampaignBidSummary[]; warnings: string[] }> {
  const customer = getGoogleAdsCustomer(company);
  const d = safeDays(days);
  const warnings: string[] = [];
  const campFilter = campaignIdFilter && /^\d+$/.test(campaignIdFilter)
    ? `AND campaign.id = ${campaignIdFilter}` : "";

  // Hai truy vấn: chiến dịch (chiến lược đấu thầu + target CPA + tổng số) và
  // từ khoá (số liệu + giá thầu đang đặt + ước tính vị trí của Google).
  const [campRows, kwRows] = await Promise.all([
    customer.query(`
      SELECT campaign.id, campaign.name, campaign.bidding_strategy_type,
             campaign.target_cpa.target_cpa_micros,
             campaign.maximize_conversions.target_cpa_micros,
             metrics.clicks, metrics.conversions, metrics.cost_micros
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND campaign.advertising_channel_type = 'SEARCH'
        AND ${dateClauseForDays(d)}
        ${campFilter}
    `) as Promise<Row[]>,
    customer.query(`
      SELECT ad_group_criterion.resource_name,
             ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             ad_group_criterion.effective_cpc_bid_micros,
             ad_group_criterion.quality_info.quality_score,
             ad_group_criterion.position_estimates.first_page_cpc_micros,
             ad_group_criterion.position_estimates.top_of_page_cpc_micros,
             ad_group.id, ad_group.name,
             campaign.id, campaign.name,
             metrics.clicks, metrics.conversions, metrics.cost_micros, metrics.average_cpc
      FROM keyword_view
      WHERE ad_group_criterion.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND campaign.status = 'ENABLED'
        AND campaign.advertising_channel_type = 'SEARCH'
        AND metrics.impressions > 0
        AND ${dateClauseForDays(d)}
        ${campFilter}
      ORDER BY metrics.cost_micros DESC
      LIMIT 2000
    `) as Promise<Row[]>,
  ]);

  // Gộp số liệu chiến dịch (GAQL trả nhiều dòng khi có segment)
  interface CampAgg {
    id: string; name: string; strategy: string; targetCpaMicros: number;
    clicks: number; conversions: number; cost: number;
  }
  const camps = new Map<string, CampAgg>();
  for (const r of campRows) {
    const id = String(r.campaign?.id ?? "");
    if (!id) continue;
    const existing = camps.get(id);
    const clicks = Number(r.metrics?.clicks ?? 0);
    const conv = Number(r.metrics?.conversions ?? 0);
    const cost = Number(r.metrics?.cost_micros ?? 0) / MICROS;
    if (existing) {
      existing.clicks += clicks; existing.conversions += conv; existing.cost += cost;
    } else {
      camps.set(id, {
        id,
        name: String(r.campaign?.name ?? id),
        strategy: enumName(enums.BiddingStrategyType, r.campaign?.bidding_strategy_type) ?? "UNKNOWN",
        targetCpaMicros: Number(
          r.campaign?.target_cpa?.target_cpa_micros ??
          r.campaign?.maximize_conversions?.target_cpa_micros ?? 0
        ),
        clicks, conversions: conv, cost,
      });
    }
  }

  // Gộp số liệu từ khoá
  interface KwAgg {
    resourceName: string; text: string; matchType: string;
    adGroupId: string; adGroupName: string; campaignId: string; campaignName: string;
    clicks: number; conversions: number; cost: number;
    currentBid: number; qualityScore: number | null;
    firstPageCpc: number | null; topOfPageCpc: number | null;
  }
  const kws = new Map<string, KwAgg>();
  for (const r of kwRows) {
    const rn = String(r.ad_group_criterion?.resource_name ?? "");
    if (!rn) continue;
    const clicks = Number(r.metrics?.clicks ?? 0);
    const conv = Number(r.metrics?.conversions ?? 0);
    const cost = Number(r.metrics?.cost_micros ?? 0) / MICROS;
    const existing = kws.get(rn);
    if (existing) {
      existing.clicks += clicks; existing.conversions += conv; existing.cost += cost;
      continue;
    }
    const fp = Number(r.ad_group_criterion?.position_estimates?.first_page_cpc_micros ?? 0);
    const tp = Number(r.ad_group_criterion?.position_estimates?.top_of_page_cpc_micros ?? 0);
    const qs = Number(r.ad_group_criterion?.quality_info?.quality_score ?? 0);
    kws.set(rn, {
      resourceName: rn,
      text: String(r.ad_group_criterion?.keyword?.text ?? "?"),
      matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type) ?? "UNKNOWN",
      adGroupId: String(r.ad_group?.id ?? ""),
      adGroupName: String(r.ad_group?.name ?? ""),
      campaignId: String(r.campaign?.id ?? ""),
      campaignName: String(r.campaign?.name ?? ""),
      clicks, conversions: conv, cost,
      currentBid: Number(r.ad_group_criterion?.effective_cpc_bid_micros ?? 0) / MICROS,
      qualityScore: qs > 0 ? qs : null,
      // Google không trả ước tính cho từ khoá quá mới/ít dữ liệu — để null
      // chứ không đặt 0, vì 0 sẽ bị đọc thành "sàn bằng không".
      firstPageCpc: fp > 0 ? fp / MICROS : null,
      topOfPageCpc: tp > 0 ? tp / MICROS : null,
    });
  }

  if (kws.size === 0) warnings.push(t("libgoogle.mb.warnNoKw", { d }));

  // Dựng kết quả theo chiến dịch
  const byCampaign = new Map<string, KwAgg[]>();
  for (const kw of kws.values()) {
    const list = byCampaign.get(kw.campaignId) ?? [];
    list.push(kw);
    byCampaign.set(kw.campaignId, list);
  }

  const out: CampaignBidSummary[] = [];
  for (const [campaignId, list] of byCampaign) {
    const camp = camps.get(campaignId);
    const campaignName = camp?.name ?? list[0].campaignName;
    const strategy = camp?.strategy ?? "UNKNOWN";
    const isManualCpc = strategy === "MANUAL_CPC";

    const targetCpa = (camp?.targetCpaMicros ?? 0) > 0
      ? camp!.targetCpaMicros / MICROS
      : getCPLTarget(campaignName);
    const targetCpaSource: "google" | "noi_bo" = (camp?.targetCpaMicros ?? 0) > 0 ? "google" : "noi_bo";

    const campClicks = camp?.clicks ?? list.reduce((s, k) => s + k.clicks, 0);
    const campConv = camp?.conversions ?? list.reduce((s, k) => s + k.conversions, 0);

    // Cổng chiến lược: chiến dịch đang chạy tự động và ĐÃ đủ chuyển đổi để học
    // thì chuyển sang thủ công thường là bước lùi — reset giai đoạn học, mất
    // tín hiệu theo thời điểm/thiết bị/người dùng mà thủ công không có.
    let gateNote: string | null = null;
    let gateStop = false;
    if (!isManualCpc) {
      const convPerMonth = campConv * (d > 0 ? 30 / d : 1);
      gateStop = convPerMonth >= SMART_BIDDING_LEARNS_AT;
      gateNote = gateStop
        ? t("libgoogle.mb.gateStop", { strategy, n: convPerMonth.toFixed(0) })
        : t("libgoogle.mb.gateInfo", { strategy, n: convPerMonth.toFixed(0), min: SMART_BIDDING_LEARNS_AT });
    }

    const recs: KeywordBidRec[] = list.map((kw) => {
      const computed = computeKeywordBid({
        clicks: kw.clicks,
        conversions: kw.conversions,
        currentBid: kw.currentBid,
        avgCpc: kw.clicks > 0 ? kw.cost / kw.clicks : 0,
        qualityScore: kw.qualityScore,
        targetCpa,
        firstPageCpc: kw.firstPageCpc,
        topOfPageCpc: kw.topOfPageCpc,
        campaignClicks: campClicks,
        campaignConversions: campConv,
        days: d,
      }, t);
      return {
        resourceName: kw.resourceName,
        text: kw.text,
        matchType: kw.matchType,
        adGroupId: kw.adGroupId,
        adGroupName: kw.adGroupName,
        campaignId,
        campaignName,
        clicks: kw.clicks,
        conversions: kw.conversions,
        cost: kw.cost,
        avgCpc: kw.clicks > 0 ? kw.cost / kw.clicks : 0,
        qualityScore: kw.qualityScore,
        currentBid: kw.currentBid,
        targetCpa,
        targetCpaSource,
        firstPageCpc: kw.firstPageCpc,
        topOfPageCpc: kw.topOfPageCpc,
        ...computed,
      };
    });

    recs.sort((a, b) => b.overspendPerMonth - a.overspendPerMonth || b.cost - a.cost);

    out.push({
      campaignId, campaignName, company,
      biddingStrategy: strategy,
      isManualCpc,
      canApply: isManualCpc,
      gateNote,
      gateStop,
      days: d,
      clicks: campClicks,
      conversions: campConv,
      cost: camp?.cost ?? list.reduce((s, k) => s + k.cost, 0),
      keywordCount: recs.length,
      countGiam: recs.filter((r) => r.verdict === "giam").length,
      countTang: recs.filter((r) => r.verdict === "tang").length,
      countGiu: recs.filter((r) => r.verdict === "giu").length,
      countKhongDatDuoc: recs.filter((r) => r.verdict === "khong_dat_duoc").length,
      countThieuDuLieu: recs.filter((r) => r.verdict === "thieu_du_lieu").length,
      overspendPerMonth: recs.reduce((s, r) => s + r.overspendPerMonth, 0),
      keywords: recs,
    });
  }

  out.sort((a, b) => b.overspendPerMonth - a.overspendPerMonth);
  return { campaigns: out, warnings };
}
