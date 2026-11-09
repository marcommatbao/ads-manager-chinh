// ============================================================
// GET /api/google/search-terms?company=MBC&days=30
//
// Powers the "Search Terms" section of the Google Automation tab, whose
// two bulk actions (add as keyword / add as negative) post the rows this
// route returns to /api/google/keywords/add and .../negative. The route
// was never implemented, so both lists stayed empty and both bulk buttons
// were unreachable.
//
// Real GAQL against search_term_view, same query shape already proven in
// app/api/improvements/keywords (including its fallback for the
// segments.keyword.ad_group_criterion field, which is not available on
// every account).
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { daysBackVN } from "@/lib/case/dates";
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Only suggest a negative once a term has genuinely wasted money — a term
// with 2 clicks and no conversion is not yet evidence of anything.
const NEGATIVE_MIN_CLICKS = 10;
const NEGATIVE_MIN_COST = 300_000; // ₫

interface SearchTermItem {
  searchTerm: string;
  campaignName: string;
  campaignId: string;
  adGroupId: string;
  clicks: number;
  conversions: number;
  cost: number;
  ctr: string;
}

// Ngày theo giờ VN — bản cũ dùng toISOString() (UTC) nên 0h–7h sáng lùi mất một ngày.
function gaqlDates(daysBack: number): { from: string; to: string } {
  return daysBackVN(daysBack)
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const companyParam = (request.nextUrl.searchParams.get("company") ?? "MBC").toUpperCase();
  if (!isCompany(companyParam)) {
    return NextResponse.json({ success: false, error: "Công ty không có ở bản cài này" }, { status: 400 });
  }
  const company = companyParam as string;
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }

  const days = Math.min(90, Math.max(7, Number(request.nextUrl.searchParams.get("days")) || 30));
  const dates = gaqlDates(days);

  try {
    const customer = getGoogleAdsCustomer(company);

    const [termRows, existingKeywordRows] = await Promise.all([
      customer.query(`
        SELECT
          search_term_view.search_term,
          campaign.id,
          campaign.name,
          ad_group.id,
          metrics.cost_micros,
          metrics.conversions,
          metrics.clicks,
          metrics.impressions
        FROM search_term_view
        WHERE segments.date BETWEEN '${dates.from}' AND '${dates.to}'
          AND campaign.status = 'ENABLED'
          AND ad_group.status = 'ENABLED'
          AND metrics.clicks > 0
        LIMIT 5000
      `) as Promise<Row[]>,

      // Terms already covered by a keyword must not be suggested again.
      customer.query(`
        SELECT ad_group_criterion.keyword.text
        FROM keyword_view
        WHERE campaign.status = 'ENABLED'
          AND ad_group.status = 'ENABLED'
          AND ad_group_criterion.status = 'ENABLED'
        LIMIT 5000
      `) as Promise<Row[]>,
    ]);

    const existing = new Set(
      existingKeywordRows
        .map((r) => (r.ad_group_criterion?.keyword?.text ?? "").trim().toLowerCase())
        .filter(Boolean),
    );

    const terms: SearchTermItem[] = termRows.map((r) => {
      const clicks = Number(r.metrics?.clicks ?? 0);
      const impressions = Number(r.metrics?.impressions ?? 0);
      return {
        searchTerm: r.search_term_view?.search_term ?? "",
        campaignName: r.campaign?.name ?? "",
        campaignId: String(r.campaign?.id ?? ""),
        adGroupId: String(r.ad_group?.id ?? ""),
        clicks,
        conversions: Number(r.metrics?.conversions ?? 0),
        cost: Number(r.metrics?.cost_micros ?? 0) / 1_000_000,
        ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : "0.00",
      };
    }).filter((t) => t.searchTerm && t.campaignId && t.adGroupId);

    // Converted, but no keyword covers it yet → worth adding.
    const suggestAdd = terms
      .filter((t) => t.conversions > 0 && !existing.has(t.searchTerm.trim().toLowerCase()))
      .sort((a, b) => b.conversions - a.conversions);

    // ── Bán kính sát thương của một từ khoá phủ định ────────────────────
    // Giao diện ghi từ khoá phủ định ở dạng KHỚP CỤM, CẤP CHIẾN DỊCH. Nghĩa là
    // chặn "tên miền" không chỉ chặn đúng cụm đó — nó chặn MỌI truy vấn có
    // chứa cụm đó: "mua tên miền", "đăng ký tên miền", "tên miền giá rẻ"...
    // tức toàn bộ danh mục sản phẩm chính. Trên dữ liệu thật 03/09/2026,
    // "tên miền" (52 nhấp, ₫671.757, 0 chuyển đổi) đứng đầu bảng đáng chặn —
    // bấm chặn là tắt cả nhóm sản phẩm lõi.
    //
    // Nên với mỗi cụm đáng chặn, đếm xem chặn khớp cụm sẽ nuốt theo bao nhiêu
    // cụm KHÁC và bao nhiêu chuyển đổi. Đếm trên TOÀN BỘ `terms` (cả cụm đã ra
    // đơn lẫn chưa), không chỉ trên hai danh sách hiển thị — nếu chỉ đếm trên
    // danh sách hiển thị thì đúng những cụm đang ra tiền mà ĐÃ có từ khoá phủ
    // sẽ bị bỏ sót, và đó lại là nhóm quan trọng nhất.
    //
    // So khớp BỎ DẤU. Google chặn khớp cụm còn chặn cả BIẾN THỂ GẦN — sai
    // chính tả, thiếu dấu. Dữ liệu thật có đủ cả "kiểm tra tên miền" và
    // "kiem tra ten mien" như hai cụm riêng; so chuỗi nguyên văn thì tính bán
    // kính cho cụm không dấu sẽ BỎ SÓT toàn bộ biến thể có dấu. Đo thiếu là
    // hướng sai nguy hiểm: một cụm đáng lẽ phải chặn khớp chính xác lại được
    // xếp vào "chặn ngay" với khớp cụm, rồi nuốt mất cụm đang ra đơn.
    //
    // Bỏ dấu chỉ làm bán kính RỘNG ra ⇒ chỉ đẩy thêm cụm sang khớp chính xác.
    // Sai theo hướng thận trọng, không sai theo hướng mất tiền.
    const stripTone = (x: string) =>
      x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();

    function blastRadiusOf(term: string): { terms: number; conversions: number; cost: number } {
      const needle = stripTone(term.toLowerCase());
      if (!needle) return { terms: 0, conversions: 0, cost: 0 };
      let n = 0, conv = 0, cost = 0;
      for (const t of terms) {
        const other = stripTone(t.searchTerm.toLowerCase());
        if (other === needle || !other.includes(needle)) continue;
        n += 1; conv += t.conversions; cost += t.cost;
      }
      return { terms: n, conversions: conv, cost };
    }

    // Burned clicks/budget with zero conversions → worth blocking.
    const suggestNegative = terms
      .filter(
        (t) =>
          t.conversions === 0 &&
          (t.clicks >= NEGATIVE_MIN_CLICKS || t.cost >= NEGATIVE_MIN_COST),
      )
      .sort((a, b) => b.cost - a.cost)
      .map((t) => ({ ...t, blast: blastRadiusOf(t.searchTerm) }));

    // Mốc so sánh CPA — lấy từ CHÍNH tập dữ liệu này (mọi cụm tìm kiếm của
    // campaign Search đang bật, cùng cửa sổ 30 ngày), không phải một con số
    // đặt tay. Không có mốc thì "CPA ₫520.525" chỉ là một con số trần trụi:
    // người đọc không biết nó đắt hay rẻ so với chính tài khoản mình, nên
    // danh sách sắp theo số chuyển đổi có thể đẩy lên đầu những cụm đắt gấp
    // nhiều lần mức tài khoản đang chịu.
    //
    // CỐ Ý không mượn số trung bình ở bảng campaign phía trên trang: bảng đó
    // chạy theo kỳ người dùng chọn (có thể 7N/90N) và tính trên toàn campaign,
    // còn khối này luôn cố định 30 ngày và tính trên cụm tìm kiếm. Trộn hai
    // cửa sổ khác nhau vào một phép so sánh là lỗi đã từng xảy ra ở PMax
    // Insights — nhãn phải nói rõ đây là mốc của cụm tìm kiếm 30 ngày.
    const benchmarkCost = terms.reduce((n, t) => n + t.cost, 0);
    const benchmarkConversions = terms.reduce((n, t) => n + t.conversions, 0);
    const benchmarkCpa = benchmarkConversions > 0 ? benchmarkCost / benchmarkConversions : null;

    // Cùng một cụm có thể nằm ở CẢ HAI danh sách: search_term_view trả về theo
    // (cụm × nhóm quảng cáo), nên "kiểm tra tên miền" ra 20 đơn ở nhóm này và
    // 0 đơn ở nhóm kia là chuyện bình thường. Nhưng đặt cạnh nhau trên màn hình
    // mà không nói thì trông như tool tự mâu thuẫn — và người dùng dễ chặn ở
    // chỗ nó đang ra tiền.
    const addSet = new Set(suggestAdd.map((t) => t.searchTerm.trim().toLowerCase()));
    const conflicting = Array.from(
      new Set(
        suggestNegative
          .map((t) => t.searchTerm.trim().toLowerCase())
          .filter((k) => addSet.has(k)),
      ),
    );

    // LIMIT 5000 cắt cụt trong IM LẶNG. Chạm trần nghĩa là danh sách "đã có từ
    // khoá phủ" bị thiếu ⇒ tool sẽ gợi ý thêm những từ khoá ĐANG CHẠY. Phải nói
    // ra, không thì người dùng tin vào một danh sách không đầy đủ.
    const capHit = {
      searchTerms: termRows.length >= 5000,
      existingKeywords: existingKeywordRows.length >= 5000,
    };

    return NextResponse.json({
      success: true,
      company,
      period: dates,
      data: {
        suggestAdd,
        suggestNegative,
        totalTerms: terms.length,
        conflicting,
        capHit,
        existingKeywordCount: existing.size,
        /** Mốc so sánh: CPA trung bình của TOÀN BỘ cụm tìm kiếm trong cùng cửa
         *  sổ 30 ngày. `cpa: null` = kỳ này chưa có chuyển đổi nào ⇒ không có
         *  mốc, phía giao diện phải nói "chưa xếp hạng được" chứ không được
         *  bịa ra một thứ hạng. */
        benchmark: {
          cost: benchmarkCost,
          conversions: benchmarkConversions,
          cpa: benchmarkCpa,
          window: "30 ngày",
        },
        thresholds: { negativeMinClicks: NEGATIVE_MIN_CLICKS, negativeMinCost: NEGATIVE_MIN_COST },
      },
    });
  } catch (err) {
    const message = googleAdsErrorMessage(err);
    console.error("[google/search-terms]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
