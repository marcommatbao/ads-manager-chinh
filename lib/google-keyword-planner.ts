// ============================================================
// Google Keyword Planner — lượng tìm kiếm THẬT
// ------------------------------------------------------------
// Trước file này, bộ từ khoá của tool hoàn toàn do Gemini suy luận: nhãn
// HIGH/MED/LOW là "mức độ ý định mua" AI TỰ CHẤM, không phải lượng tìm kiếm.
// Không ai biết thật sự có bao nhiêu người gõ những cụm đó.
//
// `KeywordPlanIdeaService` là dữ liệu của CHÍNH Google, miễn phí, dùng đúng tài
// khoản Google Ads đã kết nối. Chạy quảng cáo trên Google thì đây là con số có
// thẩm quyền nhất.
//
// GIỚI HẠN PHẢI NÓI TRƯỚC: tài khoản chi tiêu thấp thì Google trả KHOẢNG
// ("1K–10K") thay vì số chính xác. Chỗ nào Google không trả số, file này để
// `null` chứ KHÔNG suy ra một con số cho đẹp bảng.
// ============================================================

import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { log } from "@/lib/logger";

/** Việt Nam. https://developers.google.com/google-ads/api/reference/data/geotargets */
const GEO_VIETNAM = "geoTargetConstants/2704";
/** Tiếng Việt. */
const LANG_VIETNAMESE = "languageConstants/1040";

/**
 * Chuẩn hoá một từ khoá để ghép hai chiều.
 *
 * Google bỏ dấu câu và gộp khoảng trắng thừa khi xử lý từ khoá, nên
 * "đăng ký tên miền .vn" và "đăng ký tên miền vn" là MỘT. So chuỗi thô sẽ
 * trượt toàn bộ.
 */
function normalizeKeyword(k: string): string {
  return k
    .toLowerCase()
    .replace(/[[\]"~+]/g, "")   // ký hiệu match type nếu lỡ dính vào
    .replace(/[.,/#!$%^&*;:{}=\-_`()?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface KeywordMetric {
  keyword: string;
  /** Lượt tìm trung bình mỗi tháng. `null` = Google không trả số cho từ này. */
  avgMonthlySearches: number | null;
  /** LOW | MEDIUM | HIGH — độ cạnh tranh QUẢNG CÁO, không phải độ khó SEO. */
  competition: string | null;
  /** 0–100. Google chỉ trả khi có đủ dữ liệu. */
  competitionIndex: number | null;
  /** Giá thầu đầu trang, đơn vị đồng. Đây là mức người khác đang trả. */
  topOfPageBidLowVnd: number | null;
  topOfPageBidHighVnd: number | null;
}

export interface KeywordPlannerResult {
  /** Từ khoá NGƯỜI DÙNG/AI đưa vào, kèm số đo được. */
  requested: KeywordMetric[];
  /** Google gợi ý thêm — thứ AI bỏ sót. Đã loại trùng với `requested`. */
  suggestions: KeywordMetric[];
  /** Có giá trị = KHÔNG đo được; đừng đọc mảng rỗng thành "không ai tìm". */
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMetric(keyword: string, m: any): KeywordMetric {
  const micros = (v: unknown) => {
    const n = Number(v ?? 0);
    return n > 0 ? Math.round(n / 1_000_000) : null;
  };
  const avg = m?.avg_monthly_searches;
  return {
    keyword,
    // 0 và "không có dữ liệu" là hai chuyện khác nhau. Google trả 0 nghĩa là
    // gần như không ai tìm; trả null/undefined nghĩa là nó KHÔNG BIẾT.
    avgMonthlySearches: avg === null || avg === undefined ? null : Number(avg),
    competition: m?.competition ? String(m.competition) : null,
    competitionIndex: m?.competition_index === null || m?.competition_index === undefined
      ? null : Number(m.competition_index),
    topOfPageBidLowVnd: micros(m?.low_top_of_page_bid_micros),
    topOfPageBidHighVnd: micros(m?.high_top_of_page_bid_micros),
  };
}

/**
 * Đo lượng tìm kiếm thật cho một danh sách từ khoá, và xin Google gợi ý thêm.
 *
 * MỘT lượt gọi API cho cả hai việc: `generateKeywordIdeas` với `keyword_seed`
 * trả về chính các từ đã hỏi CỘNG các từ liên quan. Gọi hai lần là lãng phí.
 */
export async function measureKeywords(
  company: string,
  keywords: string[],
  opts?: { maxSuggestions?: number },
): Promise<KeywordPlannerResult> {
  const empty: KeywordPlannerResult = { requested: [], suggestions: [], error: null };
  const seeds = Array.from(new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)));
  if (seeds.length === 0) return empty;

  try {
    const customer = getGoogleAdsCustomer(company);
    // Google giới hạn 20 từ khoá gốc mỗi lượt gọi.
    const seedSlice = seeds.slice(0, 20);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await (customer as any).keywordPlanIdeas.generateKeywordIdeas({
      customer_id: GOOGLE_CUSTOMER_IDS[company],
      language: LANG_VIETNAMESE,
      geo_target_constants: [GEO_VIETNAM],
      // Chỉ Google Search — không trộn Search Partners, vì con số dùng để quyết
      // định từ khoá cho campaign Search.
      keyword_plan_network: "GOOGLE_SEARCH",
      keyword_seed: { keywords: seedSlice },
    });

    // Tên trường là `keyword_idea_metrics`, KHÔNG phải `idea_metrics`.
    // Đo thật 27/08/2026: viết sai tên khiến MỌI từ khoá hiện "0/tháng" và
    // "Google không có dữ liệu" — trong khi Google vẫn trả về 25 gợi ý, tức lời
    // gọi hoàn toàn thành công. Kiểm tên trường bằng chính proto của thư viện:
    //   Object.keys(services.GenerateKeywordIdeaResult.prototype)
    //   → text, keyword_idea_metrics, keyword_annotations, close_variants
    const rows: Array<{ text?: string; keyword_idea_metrics?: unknown }> =
      res?.results ?? res?.[0]?.results ?? (Array.isArray(res) ? res : []);

    const requested: KeywordMetric[] = [];
    const suggestions: KeywordMetric[] = [];
    const seen = new Map<string, KeywordMetric>();

    for (const r of rows) {
      const text = String(r?.text ?? "").trim();
      if (!text) continue;
      const metric = toMetric(text, r.keyword_idea_metrics);
      seen.set(normalizeKeyword(text), metric);
    }

    // Ghép theo dạng ĐÃ CHUẨN HOÁ, không so chuỗi thô.
    //
    // Google chuẩn hoá từ khoá trước khi trả về: gửi "đăng ký tên miền .vn" thì
    // nó trả "đăng ký tên miền vn" — mất dấu chấm. So chuỗi thô nên không khớp
    // dòng nào, và cả 14 từ khoá bị báo "Google không có dữ liệu" oan.
    const matchedKeys = new Set<string>();
    for (const s of seedSlice) {
      const key = normalizeKeyword(s);
      const hit = seen.get(key);
      if (hit) {
        matchedKeys.add(key);
        // Giữ NGUYÊN VĂN từ khoá người dùng đang dùng, chỉ mượn số của Google —
        // đổi chữ dưới chân họ thì bảng không còn khớp với campaign nữa.
        requested.push({ ...hit, keyword: s });
      } else {
        requested.push({
          keyword: s, avgMonthlySearches: null, competition: null,
          competitionIndex: null, topOfPageBidLowVnd: null, topOfPageBidHighVnd: null,
        });
      }
    }

    for (const [key, metric] of seen) {
      if (!matchedKeys.has(key)) suggestions.push(metric);
    }

    suggestions.sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));

    log.info("keyword_planner", `Đo ${requested.length} từ khoá, Google gợi ý thêm ${suggestions.length}`, {
      company, seeds: seedSlice.length,
      withVolume: requested.filter((r) => r.avgMonthlySearches !== null).length,
    });

    return {
      requested,
      suggestions: suggestions.slice(0, opts?.maxSuggestions ?? 25),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("keyword_planner", `Không đo được lượng tìm kiếm: ${message}`, { company });
    // Trả LỖI, không trả mảng rỗng: rỗng bị đọc thành "không từ khoá nào có
    // người tìm", một câu hoàn toàn khác.
    return { ...empty, error: message };
  }
}
