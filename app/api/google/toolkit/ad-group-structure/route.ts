// ============================================================
// GET /api/google/toolkit/ad-group-structure
// ============================================================
// Audit chỉ ra "N ad group có >20 từ khoá (phân mảnh)" nhưng không nói là
// nhóm nào. Endpoint này trả về đúng danh sách đó, kèm từng từ khoá với
// chi phí/chuyển đổi/Quality Score thật, và một đề xuất tách theo ý định.
//
// Đây là màn hình CHỈ ĐỌC. Không có nút ghi nào — tách ad group là thao
// tác không hoàn tác được và làm reset lịch sử Quality Score của từ khoá,
// nên quyết định phải là của người chạy, sau khi nhìn số thật.

import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/lib/i18n/server";
import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { safeDateRange } from "@/lib/google-ads-guards";
import { resolveMatchType } from "@/lib/google-ads-helpers";
import {
  classifyKeyword,
  intentMetaT,
  OVERSIZED_AD_GROUP,
  UNDERSIZED_AD_GROUP,
  MIN_SPLIT_SIZE,
  MATERIAL_COST_SHARE,
  MIN_SPLIT_CONVERSIONS,
  DOMINANT_SHARE,
  type KeywordIntent,
} from "@/lib/keyword-intent-split";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GaqlRow = Record<string, any>;

/** Khoá so trùng: bỏ dấu, bỏ khoảng trắng thừa. "mắt bão id", "mat bao id"
 *  và "mat bao  id" là CÙNG một từ khoá đang chạy ở nhiều nhóm — nhìn bằng
 *  mắt thì tưởng khác nhau vì cách gõ dấu. */
function dupKey(text: string): string {
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Trần số dòng — công bố ra ngoài chứ không cắt cụt trong im lặng. */
const CAP_KEYWORDS = 2000;

interface KeywordEntry {
  text: string;
  matchType: string;
  intent: KeywordIntent;
  matchedOn: string | null;
  cost: number;
  clicks: number;
  conversions: number;
  qualityScore: number | null;
}

export async function GET(req: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const company = pickCompany(searchParams.get("company"));
    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
    }
    const dateRange = safeDateRange(searchParams.get("dateRange"));

    // Thương hiệu và đối thủ KHÔNG được đoán. Đoán sai tên thương hiệu sẽ
    // đẩy nhầm nhóm sinh lời nhất sang nhóm khác, và người dùng không có
    // cách nào biết là đã bị đẩy nhầm.
    const brandTerms = (searchParams.get("brand") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const competitorTerms = (searchParams.get("competitor") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const customer = getGoogleAdsCustomer(company);

    const rows = (await customer.query(`
      SELECT
        campaign.id, campaign.name,
        ad_group.id, ad_group.name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM keyword_view
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
        AND segments.date DURING ${dateRange}
      ORDER BY metrics.cost_micros DESC
      LIMIT ${CAP_KEYWORDS}
    `)) as unknown as GaqlRow[];

    const groups = new Map<string, {
      adGroupId: string; adGroupName: string;
      campaignId: string; campaignName: string;
      keywords: KeywordEntry[];
    }>();

    for (const r of rows) {
      const agId = String(r.ad_group?.id ?? "");
      const text = String(r.ad_group_criterion?.keyword?.text ?? "");
      if (!agId || !text) continue;
      const entry = groups.get(agId) ?? {
        adGroupId: agId,
        adGroupName: String(r.ad_group?.name ?? ""),
        campaignId: String(r.campaign?.id ?? ""),
        campaignName: String(r.campaign?.name ?? ""),
        keywords: [],
      };
      const { intent, matched } = classifyKeyword(text, brandTerms, competitorTerms);
      const qs = r.ad_group_criterion?.quality_info?.quality_score;
      entry.keywords.push({
        text,
        matchType: resolveMatchType(r.ad_group_criterion?.keyword?.match_type),
        intent,
        matchedOn: matched,
        cost: Number(r.metrics?.cost_micros ?? 0) / 1_000_000,
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions: Number(r.metrics?.conversions ?? 0),
        // 0 nghĩa là Google CHƯA chấm điểm (thường do quá ít hiển thị), khác
        // hẳn với điểm 1. Trộn hai thứ này sẽ kéo điểm trung bình xuống sai.
        qualityScore: typeof qs === "number" && qs > 0 ? qs : null,
      });
      groups.set(agId, entry);
    }

    const oversized = [...groups.values()]
      .filter((g) => g.keywords.length > OVERSIZED_AD_GROUP)
      .map((g) => {
        const byIntent = new Map<KeywordIntent, KeywordEntry[]>();
        for (const k of g.keywords) {
          byIntent.set(k.intent, [...(byIntent.get(k.intent) ?? []), k]);
        }
        const splits = [...byIntent.entries()]
          .map(([intent, kws]) => ({
            intent,
            label: intentMetaT(intent, t).label,
            rationale: intentMetaT(intent, t).rationale,
            count: kws.length,
            cost: Math.round(kws.reduce((s, k) => s + k.cost, 0)),
            conversions: Math.round(kws.reduce((s, k) => s + k.conversions, 0) * 100) / 100,
            // Chỉ tính trung bình trên những từ khoá THẬT SỰ có điểm.
            avgQualityScore: (() => {
              const scored = kws.map((k) => k.qualityScore).filter((q): q is number => q !== null);
              return scored.length > 0
                ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
                : null;
            })(),
            scoredCount: kws.filter((k) => k.qualityScore !== null).length,
            keywords: kws.sort((a, b) => b.cost - a.cost),
            costShare: 0, // điền ở dưới, khi đã biết tổng chi phí của nhóm
            worthSplitting: false,
          }))
          .sort((a, b) => b.cost - a.cost);

        const groupCost = g.keywords.reduce((s, k) => s + k.cost, 0);

        // Đếm số từ khoá KHÔNG đủ để kết luận có nên tách. Bản đầu chỉ xét
        // `count >= 3`, nên một nhóm con 4 từ khoá tiêu ĐÚNG 0₫ vẫn được
        // tính là "tách được" — tách ra thì thay đổi đúng con số 0. Nhóm con
        // chỉ đáng đứng riêng khi nó thật sự mang tiền hoặc mang chuyển đổi.
        for (const sp of splits) {
          sp.costShare = groupCost > 0 ? sp.cost / groupCost : 0;
          sp.worthSplitting =
            sp.count >= MIN_SPLIT_SIZE &&
            (sp.costShare >= MATERIAL_COST_SHARE || sp.conversions >= MIN_SPLIT_CONVERSIONS);
        }

        const dominant = splits[0];
        const dominantShare = dominant?.costShare ?? 0;
        const viable = splits.filter((sp) => sp.worthSplitting);

        // Nhiều từ khoá mà gần như cùng MỘT ý định thì tách là vô nghĩa —
        // và tách nhầm còn làm reset lịch sử Quality Score đang tốt.
        let verdict: "SPLIT" | "KEEP" = "KEEP";
        let verdictReason: string;
        if (dominantShare >= DOMINANT_SHARE) {
          verdictReason = t("libgoogle.ags.noSplitSingle", { pct: Math.round(dominantShare * 100), label: dominant.label });
        } else if (viable.length >= 2) {
          verdict = "SPLIT";
          verdictReason = t("libgoogle.ags.split", { n: viable.length, list: viable.map((v) => t("libgoogle.ags.splitItem", { label: v.label, count: v.count, pct: Math.round(v.costShare * 100) })).join(" · ") });
        } else {
          verdictReason = t("libgoogle.ags.noSplitSmall");
        }

        return {
          ...g,
          keywordCount: g.keywords.length,
          totalCost: Math.round(g.keywords.reduce((s, k) => s + k.cost, 0)),
          totalConversions: Math.round(g.keywords.reduce((s, k) => s + k.conversions, 0) * 100) / 100,
          splits,
          viableSplits: viable.length,
          /** Tỉ lệ kiểu khớp của cả nhóm. Nhóm chạy Broad bắt truy vấn lỏng
           *  hơn hẳn nhóm chạy Phrase, nên CPA cao hơn là ĐƯƠNG NHIÊN — so
           *  CPA giữa hai nhóm khác kiểu khớp mà không nói ra điều này là so
           *  hai thứ khác nhau rồi kết luận một thứ đang lãng phí. */
          matchTypeMix: (() => {
            const mix: Record<string, number> = {};
            for (const k of g.keywords) mix[k.matchType] = (mix[k.matchType] ?? 0) + 1;
            return mix;
          })(),
          verdict,
          verdictReason,
          dominantShare: Math.round(dominantShare * 100),
          /** CPA của cả nhóm — để so giữa các nhóm cùng làm một việc. */
          cpa: g.keywords.reduce((s, k) => s + k.conversions, 0) > 0
            ? Math.round(groupCost / g.keywords.reduce((s, k) => s + k.conversions, 0))
            : null,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);

    const undersized = [...groups.values()]
      .filter((g) => g.keywords.length < UNDERSIZED_AD_GROUP)
      .map((g) => ({
        adGroupId: g.adGroupId,
        adGroupName: g.adGroupName,
        campaignName: g.campaignName,
        keywordCount: g.keywords.length,
        cost: Math.round(g.keywords.reduce((s, k) => s + k.cost, 0)),
      }))
      .sort((a, b) => b.cost - a.cost);

    // ── Từ khoá chạy trùng ở nhiều nhóm ──────────────────────
    // Cùng một từ khoá nằm ở hai ad group (nhất là hai CHIẾN DỊCH khác
    // nhau) thì chỉ một cái thắng phiên đấu giá, còn dữ liệu chuyển đổi bị
    // chia đôi — cả hai cùng học chậm. Đây là thứ soi bằng mắt rất khó thấy
    // vì cách gõ dấu khác nhau ("mắt bão id" ↔ "mat bao id").
    const byKey = new Map<string, { text: string; places: { adGroupName: string; campaignName: string; matchType: string; cost: number; conversions: number }[] }>();
    for (const g of groups.values()) {
      for (const k of g.keywords) {
        const key = dupKey(k.text);
        if (!key) continue;
        const e = byKey.get(key) ?? { text: k.text, places: [] };
        // KIỂU KHỚP là bằng chứng quyết định. Cùng một chữ chạy Broad ở nhóm
        // này và Phrase ở nhóm kia thì KHÔNG phải trùng lặp — chúng bắt hai
        // tập truy vấn khác nhau, và chênh lệch CPA giữa hai nhóm có thể chỉ
        // là do kiểu khớp chứ không phải do giẫm chân nhau.
        e.places.push({ adGroupName: g.adGroupName, campaignName: g.campaignName, matchType: k.matchType, cost: k.cost, conversions: k.conversions });
        byKey.set(key, e);
      }
    }
    const duplicates = [...byKey.values()]
      .filter((e) => e.places.length > 1)
      .map((e) => ({
        text: e.text,
        places: e.places.sort((a, b) => b.cost - a.cost).map((p) => ({ ...p, cost: Math.round(p.cost) })),
        totalCost: Math.round(e.places.reduce((s, p) => s + p.cost, 0)),
        /** Trùng giữa hai CHIẾN DỊCH đáng lo hơn trùng trong cùng một chiến dịch. */
        crossCampaign: new Set(e.places.map((p) => p.campaignName)).size > 1,
        /** Cùng chữ + CÙNG kiểu khớp mới là trùng thật. Khác kiểu khớp là hai
         *  tập truy vấn khác nhau, không phải một thứ chạy hai lần. */
        sameMatchType: new Set(e.places.map((p) => p.matchType)).size === 1,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    const genericCost = oversized.reduce(
      (sum, g) => sum + (g.splits.find((sp) => sp.intent === "GENERIC")?.cost ?? 0), 0);
    const oversizedCost = oversized.reduce((sum, g) => sum + g.totalCost, 0);

    return NextResponse.json({
      success: true,
      dateRange,
      duplicates,
      duplicateCrossCampaignCost: duplicates.filter((d) => d.crossCampaign).reduce((s, d) => s + d.totalCost, 0),
      // Chưa khai báo đối thủ mà nhóm "Chung" đang ôm nhiều tiền thì rất có
      // thể tên đối thủ đang nằm nhầm trong đó. Không đoán tên là gì — chỉ
      // nói ra để người dùng tự kiểm.
      genericCost: Math.round(genericCost),
      genericShare: oversizedCost > 0 ? Math.round((genericCost / oversizedCost) * 100) : 0,
      needsCompetitorTerms: competitorTerms.length === 0 && genericCost > 0,
      brandTermsUsed: brandTerms,
      competitorTermsUsed: competitorTerms,
      // Chưa khai báo thương hiệu thì mọi từ khoá thương hiệu đang bị xếp
      // nhầm vào nhóm khác — phải nói ra, đừng để người dùng tin bảng phân
      // loại đang đầy đủ.
      needsBrandTerms: brandTerms.length === 0,
      totalAdGroups: groups.size,
      oversized,
      undersized,
      truncated: rows.length >= CAP_KEYWORDS,
      cap: CAP_KEYWORDS,
    });
  } catch (error: unknown) {
    const msg = googleAdsErrorMessage(error);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
