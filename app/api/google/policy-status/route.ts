// ============================================================
// GET /api/google/policy-status?company=MBC[&campaignId=...]
//
// Đọc PHÁN QUYẾT THẬT của Google về chính sách: quảng cáo nào bị từ chối,
// ảnh nào bị hạn chế, và VÌ SAO.
// ------------------------------------------------------------
// Vì sao đây mới là câu trả lời thật, còn phần soi trước ở precheck chỉ là
// phỏng đoán: Google duyệt chính sách BẤT ĐỒNG BỘ. Ngay sau khi tạo, trạng
// thái luôn là "đang duyệt"; kết quả chỉ có sau vài phút tới vài giờ. Không có
// cách nào biết trước — chỉ có cách quay lại đọc.
//
// Đọc CẢ hai loại tài nguyên: quảng cáo (ad_group_ad) và tài sản (asset, gồm
// ảnh). Google từ chối riêng từng cái, và một ảnh bị từ chối không làm quảng
// cáo bị từ chối — nên chỉ đọc một loại là bỏ sót một nửa.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { resolveApprovalStatus, resolveReviewStatus, describeApproval } from "@/lib/google-ads-policy";
import { pickCompany } from "@/lib/companies"

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Trần đọc mỗi truy vấn chính sách. Trước là 200 — tài khoản này có 32
 *  campaign và cả kho ảnh cấp tài khoản, nên trần đó bị chạm thật (giao diện
 *  đang hiện cảnh báo "truy vấn bị cắt ở 200 dòng (tài sản)"), tức danh sách
 *  "không có gì bị từ chối" chưa bao giờ đầy đủ. Nâng trần thay vì lọc theo
 *  approval_status ở GAQL: không kiểm chứng được trường đó có lọc được không
 *  từ workspace này, mà đoán sai thì truy vấn hỏng và cả bảng chính sách mất. */
const POLICY_ROW_CAP = 1000;

interface PolicyRow {
  kind: "Quảng cáo" | "Tài sản";
  name: string;
  campaign: string | null;
  approval: string;
  review: string;
  level: "ok" | "warn" | "bad" | "pending";
  meaning: string;
  /** Lý do Google đưa ra — chuỗi mã chính sách, ví dụ TRADEMARKS_IN_AD_TEXT. */
  topics: string[];
  /** URL đích của quảng cáo. BẮT BUỘC phải có với lỗi DESTINATION_NOT_WORKING:
   *  báo "trang đích hỏng" mà không nói trang nào thì người đọc không sửa được
   *  gì — phải mở Google Ads dò từng quảng cáo. */
  finalUrls: string[];
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  const campaignId = req.nextUrl.searchParams.get("campaignId");

  try {
    const customer = getGoogleAdsCustomer(company);
    const campaignFilter = campaignId ? ` AND campaign.id = ${Number(campaignId)}` : "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [adRows, assetRows, linkRows] = await Promise.all([
      customer.query(`
        SELECT
          campaign.name,
          ad_group_ad.ad.id,
          ad_group_ad.ad.name,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.final_urls,
          ad_group_ad.policy_summary.approval_status,
          ad_group_ad.policy_summary.review_status,
          ad_group_ad.policy_summary.policy_topic_entries
        FROM ad_group_ad
        WHERE ad_group_ad.status != 'REMOVED'${campaignFilter}
        LIMIT ${POLICY_ROW_CAP}
      `).then((r) => ({ ok: true as const, rows: r as unknown[] }))
       .catch((e) => ({ ok: false as const, rows: [] as unknown[], err: describeGoogleAdsError(e) })),
      customer.query(`
        SELECT
          asset.id,
          asset.name,
          asset.type,
          asset.policy_summary.approval_status,
          asset.policy_summary.review_status,
          asset.policy_summary.policy_topic_entries
        FROM asset
        LIMIT ${POLICY_ROW_CAP}
      `).then((r) => ({ ok: true as const, rows: r as unknown[] }))
       .catch((e) => ({ ok: false as const, rows: [] as unknown[], err: describeGoogleAdsError(e) })),
      // Tài sản là tài nguyên CẤP TÀI KHOẢN — không lọc được theo campaign
      // trong chính truy vấn asset. Hỏi riêng campaign_asset để biết campaign
      // này thật sự dùng ảnh nào; không có bước này thì xem một campaign lại
      // hiện cả kho ảnh của cả tài khoản, toàn nhiễu.
      //
      // `campaign.id` PHẢI có trong SELECT. GAQL bắt buộc mọi trường dùng ở
      // WHERE cũng phải nằm trong SELECT — thiếu thì Google trả
      //   "The following field must be present in SELECT clause: 'campaign.id'."
      //   [query_error: 16]
      // Bản trước thiếu đúng trường này, nên truy vấn LUÔN hỏng, và màn hình
      // rơi về chế độ "không lọc được" rồi hiện toàn bộ tài sản của tài khoản:
      // người dùng thấy "4 bị từ chối / 8 đang duyệt / 86 được duyệt" và tưởng
      // đó là chiến dịch vừa tạo, trong khi nó chỉ có 17 tài sản.
      // Đo trên chiến dịch thật (id 24262144266): bản sửa trả về đúng 17 —
      // khớp với "11 ảnh · 6 sitelink" mà màn hình thành công đã báo.
      campaignId
        ? Promise.all([
            customer.query(`
              SELECT campaign.id, campaign_asset.asset, campaign_asset.field_type
              FROM campaign_asset
              WHERE campaign.id = ${Number(campaignId)}
            `),
            // Performance Max để ảnh/chữ/video ở NHÓM TÀI SẢN, không phải cấp
            // campaign — chỉ hỏi campaign_asset thì với PMax sẽ ra gần như
            // rỗng và màn hình lại báo "không có tài sản nào".
            customer.query(`
              SELECT campaign.id, asset_group_asset.asset, asset_group_asset.field_type
              FROM asset_group_asset
              WHERE campaign.id = ${Number(campaignId)}
            `).catch(() => [] as unknown[]),
          ]).then(([ca, aga]) => [
            ...(ca as Array<Record<string, unknown>>),
            ...(aga as Array<Record<string, unknown>>).map((r) => ({
              campaign_asset: { asset: (r.asset_group_asset as { asset?: string } | undefined)?.asset },
            })),
          ]).catch((err: unknown) => {
            // KHÔNG trả mảng rỗng: rỗng biến thành Set rỗng, rồi bộ lọc ở dưới
            // gạt sạch mọi tài sản khỏi kết quả → màn hình báo "không có tài
            // sản bị từ chối" trong khi có thể đang bị Google từ chối thật.
            // Chính file này đã nêu đúng nguyên tắc đó cho hai truy vấn kia:
            // "Nuốt lỗi rồi trả mảng rỗng là một lời TRẤN AN GIẢ".
            //
            // err ở đây là GoogleAdsFailure (object), KHÔNG phải Error —
            // String(err) in ra đúng "[object Object]", không ai đọc được lý
            // do thật Google từ chối truy vấn này.
            const info = describeGoogleAdsError(err);
            console.error("[policy-status] không đọc được liên kết tài sản:", info.message);
            return { __linkError: info.message } as const;
          })
        : Promise.resolve(null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // Lỗi đọc liên kết → coi như KHÔNG lọc theo campaign (hiện tất cả) và nói
    // ra, thay vì lọc bằng một tập rỗng rồi báo "không có gì".
    const linkError = linkRows && typeof linkRows === "object" && "__linkError" in linkRows
      ? String((linkRows as { __linkError: string }).__linkError)
      : null;
    const linkRowsOk = linkError ? null : linkRows;
    const linkedAssets: Set<string> | null = linkRowsOk
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? new Set((linkRowsOk as any[]).map((r) => String(r.campaign_asset?.asset ?? "")).filter(Boolean))
      : null;

    const rows: PolicyRow[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topicsOf = (entries: any): string[] =>
      Array.isArray(entries) ? entries.map((e) => String(e?.topic ?? e?.type ?? "")).filter(Boolean) : [];

    // Hỏng thì NÓI RA. Nuốt lỗi rồi trả mảng rỗng khiến màn hình hiện
    // "✅ không có gì bị từ chối" — một lời TRẤN AN GIẢ trên đúng tính năng an
    // toàn. Không đọc được và không có gì sai là hai chuyện khác hẳn nhau.
    const queryErrors: string[] = [];
    // adRows.err/assetRows.err là OBJECT {message, details, requestId} (xem
    // describeGoogleAdsError) — nhét thẳng vào template string trước đây in
    // ra "[object Object]", cùng lỗi đã sửa ở __linkError phía trên.
    if (!adRows.ok) queryErrors.push(`Không đọc được quảng cáo: ${adRows.err.message}`);
    if (!assetRows.ok) queryErrors.push(`Không đọc được tài sản: ${assetRows.err.message}`);
    if (linkError) queryErrors.push(`Không đọc được liên kết tài sản của chiến dịch (đang hiện tài sản của cả tài khoản): ${linkError}`);

    // Chạm trần = cắt cụt trong im lặng. Phải nói ra.
    const capHit = {
      ads: adRows.rows.length >= POLICY_ROW_CAP,
      assets: assetRows.rows.length >= POLICY_ROW_CAP,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of adRows.rows as any[]) {
      const ps = r.ad_group_ad?.policy_summary;
      if (!ps) continue;
      const approval = resolveApprovalStatus(ps.approval_status);
      const review = resolveReviewStatus(ps.review_status);
      const d = describeApproval(approval, review);
      // Lấy tiêu đề đầu làm tên cho dễ nhận: id quảng cáo không nói lên gì.
      const firstHeadline = r.ad_group_ad?.ad?.responsive_search_ad?.headlines?.[0]?.text;
      rows.push({
        kind: "Quảng cáo",
        name: firstHeadline ?? r.ad_group_ad?.ad?.name ?? `Ad #${r.ad_group_ad?.ad?.id ?? "?"}`,
        campaign: r.campaign?.name ?? null,
        approval, review, level: d.level, meaning: d.text,
        topics: topicsOf(ps.policy_topic_entries),
        finalUrls: Array.isArray(r.ad_group_ad?.ad?.final_urls) ? r.ad_group_ad.ad.final_urls.map(String) : [],
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of assetRows.rows as any[]) {
      const ps = r.asset?.policy_summary;
      if (!ps) continue;
      // Lọc về đúng campaign đang xem, nếu có chỉ định.
      const rn = String(r.asset?.resource_name ?? `customers/x/assets/${r.asset?.id}`);
      if (linkedAssets && !Array.from(linkedAssets).some((a) => a.endsWith(`/assets/${r.asset?.id}`))) continue;
      void rn;
      const approval = resolveApprovalStatus(ps.approval_status);
      const review = resolveReviewStatus(ps.review_status);
      const d = describeApproval(approval, review);
      rows.push({
        kind: "Tài sản",
        name: r.asset?.name ?? `Asset #${r.asset?.id ?? "?"}`,
        campaign: null,
        approval, review, level: d.level, meaning: d.text,
        topics: topicsOf(ps.policy_topic_entries),
        finalUrls: [],
      });
    }

    // Xấu lên trước: người đọc cần thấy thứ đang KHÔNG chạy, không phải thứ ổn.
    const order = { bad: 0, warn: 1, pending: 2, ok: 3 } as const;
    rows.sort((a, b) => order[a.level] - order[b.level]);

    const count = (l: PolicyRow["level"]) => rows.filter((r) => r.level === l).length;
    return NextResponse.json({
      success: true,
      company,
      summary: { total: rows.length, bad: count("bad"), warn: count("warn"), pending: count("pending"), ok: count("ok") },
      rows: rows.slice(0, 100),
      // Đọc được đến đâu — người đọc PHẢI biết trước khi tin vào chữ "không có
      // gì bị từ chối".
      queryErrors,
      partial: queryErrors.length > 0,
      capHit,
      note:
        "Đây là phán quyết THẬT của Google, đọc trực tiếp từ tài khoản. " +
        "Quảng cáo mới tạo sẽ ở trạng thái đang duyệt vài giờ — quay lại xem sau. " +
        "Quảng cáo bị từ chối chỉ khiến riêng nó không chạy; tài khoản không bị làm sao.",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Không đọc được trạng thái chính sách", detail: describeGoogleAdsError(err) },
      { status: 502 },
    );
  }
}
