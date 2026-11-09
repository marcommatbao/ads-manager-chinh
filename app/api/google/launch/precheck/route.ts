// ============================================================
// POST /api/google/launch/precheck
//
// Hỏi Google "cái này có hợp lệ không?" mà KHÔNG tạo gì cả.
// ------------------------------------------------------------
// Google Ads API có `validate_only: true` trên lệnh mutate: Google kiểm toàn bộ
// yêu cầu bằng đúng bộ luật của lệnh thật rồi trả lỗi, nhưng KHÔNG ghi bất cứ
// thứ gì lên tài khoản. Đây là cùng một kỹ thuật đã dùng với Meta
// (`execution_options: ["validate_only"]`) và đã bác bỏ được ba khẳng định sai
// trong repo này.
//
// Vì sao phải gom TẤT CẢ vào MỘT lệnh mutate:
//   Đường launch thật chạy 5 pha nối tiếp — pha sau cần resource_name có thật
//   của pha trước. Ở chế độ validate_only KHÔNG có resource_name nào được trả
//   về, nên chạy từng pha thì chỉ kiểm được pha 1 (ngân sách + campaign) và bỏ
//   sót đúng thứ đáng lo nhất: NỘI DUNG QUẢNG CÁO.
//   Google cho phép tham chiếu chéo bằng "resource name tạm" (id âm) trong CÙNG
//   một lệnh mutate. Nên ở đây dựng cả chuỗi ngân sách → campaign → nhóm quảng
//   cáo → từ khoá → mẫu RSA bằng id tạm và gửi một lượt. Google kiểm hết.
//
// Không tạo gì ⇒ không có gì phải dọn, không tốn tiền, không để lại rác trên
// tài khoản. Chạy bao nhiêu lần cũng được.
// ============================================================

import { brandOverride } from "@/lib/brand/store";
import { catalogFor } from "@/lib/brand/catalog";
import { NextRequest, NextResponse } from "next/server";
import { ResourceNames } from "google-ads-api";
import { runPreflightGoogleSearch, preflightToLog } from "@/lib/launch-preflight";
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { getProductCatalog } from "@/lib/google-creative-engine";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { checkAdTextPolicy } from "@/lib/google-ads-policy";
import { checkFinalUrl } from "@/lib/google-final-url-check";
import { planKeywords } from "@/lib/google-keyword-limits";
import { EU_POLITICAL_ADVERTISING_DECLARATION, sanitizeDisplayPath } from "@/lib/google-ads-helpers";
import { checkPMaxImageCompleteness } from "@/lib/google-image-asset";
import { GEO_VIETNAM, DEFAULT_LANGUAGES, DEFAULT_GEO_TARGET_TYPE } from "@/lib/google-targeting";
import { buildBiddingResource, DEFAULT_AD_GROUP_CPC_VND, type BiddingConfig } from "@/lib/google-bidding";
import fs from "fs";
import path from "path";
import { pickCompany } from "@/lib/companies"
import { companyDisplayPath } from "@/lib/companies"

// Hằng số lấy từ lib/google-targeting — tệp này TỪNG tự gõ lại
// `languageConstants/1020` ("tiếng Bulgaria") thay vì 1040 (tiếng Việt), đúng
// bằng con số sai mà launch/search và launch/pmax đang dùng. Nên phép "Kiểm
// trước" kiểm trúng cấu hình sai rồi báo ĐẠT — sai giống hệt nhau thì hai bên
// khớp nhau, chỉ có người dùng là chịu thiệt.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function loadCreative(id: string): Record<string, unknown> | null {
  const filePath = path.join(process.cwd(), "data", "google-creatives.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    const creatives = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>[];
    return creatives.find((c) => c.id === id) ?? null;
  } catch {
    return null;
  }
}

function todayGoogleFormat(): string {
  return new Date().toISOString().split("T")[0].replace(/-/g, "");
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền khởi chạy campaign" }, { status: 403 });
  }

  try {
    const {
      company = "MBC",
      googleCreativeId,
      dailyBudgetVnd = 500000,
      campaignName,
      conversionActions = [],
      imageAssets = [],
      /** SEARCH hay PMAX. Trước bản này precheck LUÔN dựng một campaign SEARCH,
       *  kể cả khi người dùng đang tạo PMax — nghĩa là chữ "HỢP LỆ" không nói
       *  gì về cái sắp tạo. Cùng loại sai sót với vụ chiến lược giá: phép kiểm
       *  chỉ có giá trị khi nó dựng ĐÚNG lệnh sắp gửi. */
      campaignType = "SEARCH",
      /** Vị trí + kiểu nhắm người dùng đang chọn. Phải nhận ở đây, nếu không
       *  phép kiểm dựng campaign "cả nước / PRESENCE" trong khi cái sắp tạo là
       *  "TP.HCM / PRESENCE" — lại kiểm một campaign khác. */
      locations = [],
      geoTargetType = DEFAULT_GEO_TARGET_TYPE,
      /** Chiến lược đấu thầu đang chọn — phải kiểm ĐÚNG cái sắp tạo. */
      bidding = null,
    } = await req.json();

    const pickedLocations = Array.isArray(locations)
      ? [...new Set((locations as string[]).filter((l) => typeof l === "string" && l.startsWith("geoTargetConstants/")))]
      : [];
    const locationsToCheck = pickedLocations.length > 0 ? pickedLocations : [GEO_VIETNAM];

    if (!canAccessCompany(user, pickCompany(company))) {
      return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
    }
    if (!googleCreativeId || !campaignName) {
      return NextResponse.json({ success: false, error: "Thiếu googleCreativeId hoặc campaignName" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creative = loadCreative(googleCreativeId) as any;
    if (!creative) return NextResponse.json({ success: false, error: "Creative không tồn tại" }, { status: 404 });

    const ct = String(campaignType).toUpperCase();
    const isPMax = ct === "PMAX";
    // "Cả hai" tạo CẢ Search lẫn PMax, nhưng một lệnh mutate chỉ dựng được một
    // campaign. Kiểm Search rồi im lặng coi như xong là để chữ "HỢP LỆ" bao
    // luôn cái chưa hề được kiểm — đúng loại lời hứa suông phép kiểm này sinh
    // ra để chặn. Kiểm Search và NÓI RÕ phần PMax chưa kiểm.
    const bothUnchecked = ct === "BOTH";
    const rsa = creative.rsa;
    const keywords = creative.keywords;
    const pmax = creative.pmax;

    if (isPMax) {
      if (!pmax?.headlines?.length) {
        return NextResponse.json({ success: false, error: "Creative thiếu dữ liệu PMax" }, { status: 400 });
      }
    } else if (!rsa?.headlines || !keywords?.keywords) {
      return NextResponse.json({ success: false, error: "Creative thiếu RSA hoặc Keywords" }, { status: 400 });
    }

    // Chốt của chính app chạy TRƯỚC — hỏng ở đây thì khỏi phiền Google.
    // Chốt của app chỉ có bản cho Search — với PMax thì bỏ qua, và NÓI RA là
    // đã bỏ qua thay vì trả một `preflight` rỗng trông như đã kiểm.
    const preflight = isPMax
      ? null
      : runPreflightGoogleSearch({ company, googleCreativeId, dailyBudgetVnd, campaignName, rsa, keywords });

    const catalog = catalogFor(company); // Đợt 21 A3: hồ sơ doanh nghiệp (MBC/MBI chưa lưu = catalog cũ)
    const product = catalog[creative.productId];
    const finalUrl = product
      ? (product.finalUrls[company] ?? product.finalUrls[product.company] ?? "https://matbao.net")
      : "https://matbao.net";

    // ── Mở thử trang đích, chạy SONG SONG với phần dựng lệnh ──
    //
    // VÌ SAO Ở ĐÂY: đo hai tài khoản ngày 21/09/2026, trong 103 lý do Google
    // từ chối thì 94 (91%) là chuyện trang đích — DESTINATION_NOT_WORKING 83,
    // DESTINATION_MISMATCH 10, DESTINATION_EXPERIENCE 1. KHÔNG một lỗi nào về
    // câu chữ. Mà `validate_only` bên dưới không hề mở trang đích, nên trước
    // bản này "Kiểm trước" báo HỢP LỆ cho đúng cái sẽ bị Google gạt nhiều nhất.
    //
    // Lời từ chối của Google cũng không nhắc gì tới URL — chỉ nói "policy
    // topics of type PROHIBITED", nên người đọc đi sửa câu chữ, sai hướng.
    //
    // KHÔNG await ngay: để lượt HTTP này chạy cùng lúc với phần dựng lệnh và
    // lượt gửi Google, rồi gộp kết quả. Mục đích là MỘT lần bấm thấy hết vấn
    // đề — chặn sớm rồi trả về luôn thì người dùng sửa xong URL mới biết còn
    // lỗi cấu hình, phải bấm thêm lượt nữa.
    const urlCheckPromise = checkFinalUrl(finalUrl);

    const customer = getGoogleAdsCustomer(company);
    const customerId = GOOGLE_CUSTOMER_IDS[company];

    // Phải LẤY ĐÚNG chiến lược giá của launch thật. Bản đầu của phép kiểm này
    // dùng `manual_cpc` trong khi launch thật dùng `maximize_conversions` —
    // tức nó kiểm một cấu hình KHÁC với cấu hình sắp tạo, và chữ "HỢP LỆ" trở
    // thành lời hứa suông đúng ở chỗ đáng lo nhất (Google có luật riêng cho
    // từng chiến lược giá). Phép kiểm chỉ có giá trị khi nó soi ĐÚNG lệnh thật.
    // Dựng từ ĐÚNG lựa chọn của người dùng. Rơi về mặc định giống hệt route
    // launch khi chưa chọn gì, để hai bên không lệch nhau.
    const searchBidding: BiddingConfig = bidding ?? {
      strategy: "MAXIMIZE_CONVERSIONS",
      targetCpaVnd: keywords?.biddingRecommendation?.targetCPA ?? null,
    };
    const pmaxBidding: BiddingConfig = bidding ?? { strategy: "MAXIMIZE_CONVERSION_VALUE" };
    const builtSearch = buildBiddingResource(searchBidding);
    const builtPMax = buildBiddingResource(pmaxBidding);

    // ── Id tạm: âm, duy nhất trong cùng một lệnh mutate ──
    const budgetRN = ResourceNames.campaignBudget(customerId, "-1");
    const campaignRN = ResourceNames.campaign(customerId, "-2");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = [
      {
        entity: "campaign_budget",
        operation: "create",
        resource: {
          resource_name: budgetRN,
          name: `${campaignName} — Budget (precheck)`,
          amount_micros: dailyBudgetVnd * 1_000_000,
          delivery_method: "STANDARD",
          // PMax BẮT BUỘC ngân sách riêng (không dùng chung) — Google từ chối
          // nếu explicitly_shared = true. Search thì không bắt.
          explicitly_shared: false,
        },
      },
    ];

    let headlines: Array<{ text: string }> = [];
    let descriptions: Array<{ text: string }> = [];
    let droppedHeadlines: string[] = [];
    let allHeadlines: Array<{ text: string; isValid?: boolean }> = [];
    let path1 = "", path2 = "";
    let kwSample: Array<{ keyword: string; matchType?: string }> = [];
    let biddingLabel = "";

    if (isPMax) {
      // ── PMax ──────────────────────────────────────────────────────────────
      // Khác Search ở gần như mọi thứ: kênh, chiến lược giá, cấu trúc tài sản.
      // Dựng đúng những gì launch/pmax sẽ gửi.
      // PHẢI khớp launch/pmax: nó dùng maximize_conversion_value (tối đa GIÁ
      // TRỊ chuyển đổi), không phải maximize_conversions (tối đa SỐ chuyển
      // đổi). Google có luật riêng cho từng chiến lược giá — kiểm nhầm chiến
      // lược thì chữ "HỢP LỆ" lại thành lời hứa suông, đúng cái lỗi phép kiểm
      // này sinh ra để chặn.
      biddingLabel = builtPMax.summary;
      ops.push({
        entity: "campaign",
        operation: "create",
        resource: {
          resource_name: campaignRN,
          name: campaignName,
          contains_eu_political_advertising: EU_POLITICAL_ADVERTISING_DECLARATION,
          advertising_channel_type: "PERFORMANCE_MAX",
          status: "PAUSED",
          campaign_budget: budgetRN,
          start_date: todayGoogleFormat(),
          ...builtPMax.resource,
          // `selective_optimization` CHỈ dùng cho chiến dịch Ứng dụng — Google
          // từ chối với Search/PMax ("The error code is not in this version").
          // Mục tiêu chuyển đổi nay chốt SAU khi tạo, qua campaign_conversion_goal,
          // nên phép kiểm này KHÔNG kiểm được phần đó (xem `unchecked` bên dưới).
        },
      });
      ops.push(
        ...locationsToCheck.map((geo) => ({
          entity: "campaign_criterion",
          operation: "create",
          resource: { campaign: campaignRN, location: { geo_target_constant: geo } },
        })),
      );
      // launch/pmax đặt CẢ vị trí lẫn NGÔN NGỮ. Thiếu tiêu chí ngôn ngữ ở phép
      // kiểm là kiểm một campaign khác với campaign sắp tạo — đúng loại lỗ
      // hổng phép kiểm này sinh ra để bịt.
      ops.push(
        ...DEFAULT_LANGUAGES.map((lang) => ({
          entity: "campaign_criterion",
          operation: "create",
          resource: { campaign: campaignRN, language: { language_constant: lang } },
        })),
      );

      allHeadlines = ((pmax.headlines ?? []) as string[]).map((t) => ({ text: t }));
      headlines = allHeadlines.slice(0, 5);
      descriptions = ((pmax.descriptions ?? []) as string[]).slice(0, 5).map((t) => ({ text: t }));
    } else {
      // ── Search ────────────────────────────────────────────────────────────
      biddingLabel = builtSearch.summary;

      const adGroupRN = ResourceNames.adGroup(customerId, "-3");
      ops.push({
        entity: "campaign",
        operation: "create",
        resource: {
          resource_name: campaignRN,
          name: campaignName,
          contains_eu_political_advertising: EU_POLITICAL_ADVERTISING_DECLARATION,
          advertising_channel_type: "SEARCH",
          status: "PAUSED",
          campaign_budget: budgetRN,
          start_date: todayGoogleFormat(),
          ...builtSearch.resource,
          // `selective_optimization` CHỈ dùng cho chiến dịch Ứng dụng — Google
          // từ chối với Search/PMax ("The error code is not in this version").
          // Mục tiêu chuyển đổi nay chốt SAU khi tạo, qua campaign_conversion_goal,
          // nên phép kiểm này KHÔNG kiểm được phần đó (xem `unchecked` bên dưới).
          network_settings: {
            target_google_search: true,
            target_search_network: true,
            target_content_network: false,
            target_partner_search_network: false,
          },
          // Phải khớp launch/search, nếu không thì kiểm một campaign khác với
          // campaign sắp tạo — đúng loại lỗ hổng phép kiểm này sinh ra để bịt.
          geo_target_type_setting: { positive_geo_target_type: geoTargetType },
        },
      });
      ops.push(
        ...locationsToCheck.map((geo) => ({
          entity: "campaign_criterion",
          operation: "create",
          resource: { campaign: campaignRN, location: { geo_target_constant: geo } },
        })),
      );
      // Nhánh Search TRƯỚC ĐÂY chỉ kiểm vị trí, bỏ hẳn ngôn ngữ — tức kiểm một
      // campaign KHÁC với campaign sắp tạo. Phép kiểm chỉ đáng tin khi nó dựng
      // đúng thứ mà bước tạo thật sẽ dựng.
      ops.push(
        ...DEFAULT_LANGUAGES.map((lang) => ({
          entity: "campaign_criterion",
          operation: "create",
          resource: { campaign: campaignRN, language: { language_constant: lang } },
        })),
      );
      ops.push({
        entity: "ad_group",
        operation: "create",
        resource: {
          resource_name: adGroupRN,
          name: `${campaignName} — Precheck Group`,
          campaign: campaignRN,
          status: "ENABLED",
          type: "SEARCH_STANDARD",
          // Khớp launch/search: Manual CPC đặt giá thầu ở CẤP NHÓM.
          cpc_bid_micros: builtSearch.adGroupCpcMicros ?? DEFAULT_AD_GROUP_CPC_VND * 1_000_000,
        },
      });

      kwSample = (keywords.keywords as Array<{ keyword: string; matchType?: string }>).slice(0, 30);
      for (const kw of kwSample) {
        ops.push({
          entity: "ad_group_criterion",
          operation: "create",
          resource: {
            ad_group: adGroupRN,
            status: "ENABLED",
            keyword: { text: kw.keyword, match_type: kw.matchType || "BROAD" },
          },
        });
      }

      allHeadlines = (rsa.headlines ?? []) as Array<{ text: string; isValid?: boolean }>;
      headlines = allHeadlines.filter((h) => h.isValid !== false).slice(0, 15).map((h) => ({ text: h.text }));
      descriptions = ((rsa.descriptions ?? []) as Array<{ text: string; isValid?: boolean }>)
        .filter((d) => d.isValid !== false).slice(0, 4).map((d) => ({ text: d.text }));
      droppedHeadlines = allHeadlines.filter((h) => h.isValid === false).map((h) => `${h.text} (${h.text.length} ký tự)`);

      path1 = sanitizeDisplayPath(product?.name);
      path2 = sanitizeDisplayPath(brandOverride(company)?.displayPath || (company === "MBI" ? "matbao in" : company === "MBC" ? "matbao net" : companyDisplayPath(company)));

      ops.push({
        entity: "ad_group_ad",
        operation: "create",
        resource: {
          ad_group: adGroupRN,
          status: "ENABLED",
          ad: {
            responsive_search_ad: { headlines, descriptions, path1, path2 },
            final_urls: [finalUrl],
          },
        },
      });
    }

    const finalUrlCheck = await urlCheckPromise;

    // Soi trần độ dài TOÀN BỘ từ khoá, không chỉ 30 cái gửi Google.
    //
    // VÌ SAO: phép kiểm chỉ gửi `kwSample` = 30 từ khoá đầu (giữ lệnh mutate ở
    // mức gửi được). Từ khoá thứ 31 trở đi vượt trần thì Google KHÔNG thấy,
    // phép kiểm báo HỢP LỆ, rồi lượt tạo thật chết vì đúng cái đó.
    //
    // Phép này là so chuỗi tại chỗ, không gọi API, nên soi hết bao nhiêu cũng
    // không tốn gì — không có lý do gì phải cắt.
    const kwLimitPlan = planKeywords(
      (keywords?.keywords ?? []) as Array<{ keyword: string; matchType?: string }>
    );

    // ── Soi chính sách nội dung TRƯỚC ──
    // Chạy offline theo các luật biên tập của Google mà máy kiểm được. Đây là
    // PHỎNG ĐOÁN, không phải phán quyết: validate_only bên dưới kiểm CẤU HÌNH,
    // còn chính sách nội dung thì Google chỉ duyệt sau khi quảng cáo tạo thật.
    const policy = checkAdTextPolicy({
      headlines: headlines.map((h: { text: string }) => h.text),
      descriptions: descriptions.map((d: { text: string }) => d.text),
      finalUrl,
    });

    // ── Gửi Google kiểm, KHÔNG tạo ──
    try {
      await customer.mutateResources(ops, { validate_only: true });
    } catch (err) {
      const detail = describeGoogleAdsError(err);
      return NextResponse.json({
        success: true,
        verdict: "TỪ CHỐI",
        campaignType: isPMax ? "Performance Max" : "Search",
        unchecked: bothUnchecked ? "Performance Max" : null,
        notCheckable: (Array.isArray(conversionActions) && conversionActions.length > 0)
          ? "Mục tiêu chuyển đổi — chỉ đặt được SAU khi chiến dịch tồn tại (campaign_conversion_goal), nên phép kiểm này không chạm tới. Sau khi Launch, đối chiếu mục Goals của chiến dịch trong Google Ads."
          : null,
        createdAnything: false,
        summary:
          "Google TỪ CHỐI cấu hình này. Không có gì được tạo trên tài khoản — sửa theo lỗi bên dưới rồi kiểm lại.",
        googleErrors: detail,
        finalUrlCheck,
        rejectedKeywords: kwLimitPlan.rejected,
        checked: {
          budgetVnd: dailyBudgetVnd,
          keywordsChecked: kwSample.length,
          keywordsTotal: (keywords.keywords as unknown[]).length,
          headlines: headlines.length,
          headlinesTotal: allHeadlines.length,
          droppedHeadlines,
          descriptions: descriptions.length,
          finalUrl,
          bidding: biddingLabel,
          conversionActions: Array.isArray(conversionActions) ? conversionActions.length : 0,
          displayPath: isPMax ? "(PMax không dùng)" : ([path1, path2].filter(Boolean).join("/") || "(không dùng)"),
          campaignType: isPMax ? "Performance Max" : "Search",
        },
        policy,
        preflight,
        log: preflight ? preflightToLog(preflight) : null,
      });
    }

    // Google chấp nhận CẤU HÌNH, nhưng cấu hình đúng mà trang đích chết thì
    // quảng cáo vẫn bị từ chối sau khi tạo. Để nguyên chữ "HỢP LỆ" ở đây là
    // đưa ra đúng lời hứa sai mà cả tính năng này sinh ra để tránh.
    const urlBlocks = !finalUrlCheck.ok;
    // Bỏ hết từ khoá thì lượt tạo thật sẽ bị chặn (422) — báo TỪ CHỐI ngay ở
    // đây, đừng để "HỢP LỆ" rồi bấm tạo mới biết.
    const kwBlocks = kwLimitPlan.allRejected;

    return NextResponse.json({
      success: true,
      verdict: (urlBlocks || kwBlocks) ? "TỪ CHỐI" : "HỢP LỆ",
      campaignType: isPMax ? "Performance Max" : "Search",
      /** Chọn "Cả hai" thì phần PMax CHƯA được kiểm — nói ra, không nấp. */
      unchecked: bothUnchecked ? "Performance Max" : null,
      createdAnything: false,
      summary: kwBlocks
        ? `Không từ khoá nào dùng được — cả ${kwLimitPlan.rejected.length} từ khoá đều vượt trần của Google (tối đa 10 từ, 80 ký tự). Sửa danh sách từ khoá rồi kiểm lại.`
        : urlBlocks
        ? `Google chấp nhận cấu hình, NHƯNG trang đích không dùng được: ${finalUrlCheck.problem} ` +
          "Tạo chiến dịch với trang đích này thì Google sẽ từ chối quảng cáo (DESTINATION_NOT_WORKING) — " +
          "sửa đường dẫn rồi kiểm lại. Không có gì được tạo trên tài khoản."
        : isPMax
        ? "Google chấp nhận cấu hình Performance Max: ngân sách riêng, campaign, khai báo TTPA, vị trí Việt Nam. " +
          "Không có gì được tạo trên tài khoản. Bấm Launch thật thì campaign sẽ được tạo ở trạng thái TẠM DỪNG."
        :
        "Google chấp nhận toàn bộ cấu hình: ngân sách, campaign, khai báo TTPA, nhóm quảng cáo, từ khoá và mẫu quảng cáo RSA. " +
        "Không có gì được tạo trên tài khoản. Bấm Launch thật thì campaign sẽ được tạo ở trạng thái TẠM DỪNG.",
        // Nói rõ giới hạn: hợp lệ về CẤU HÌNH không đồng nghĩa quảng cáo sẽ được
        // duyệt hiển thị. Google soi chính sách nội dung một lần nữa sau khi ad
        // được tạo thật, và kết quả đó chỉ biết ở bước duyệt.
      caveat:
        "Đây là kiểm CẤU HÌNH. Google vẫn duyệt chính sách nội dung lần nữa sau khi quảng cáo được tạo thật — " +
        "quảng cáo bị từ chối thì chỉ riêng quảng cáo đó không chạy, tài khoản không bị làm sao.",
      checked: {
        budgetVnd: dailyBudgetVnd,
        keywordsChecked: kwSample.length,
        keywordsTotal: (keywords.keywords as unknown[]).length,
        headlines: headlines.length,
        headlinesTotal: allHeadlines.length,
        droppedHeadlines,
        descriptions: descriptions.length,
        finalUrl,
        bidding: biddingLabel,
        conversionActions: Array.isArray(conversionActions) ? conversionActions.length : 0,
        displayPath: isPMax ? "(PMax không dùng)" : ([path1, path2].filter(Boolean).join("/") || "(không dùng)"),
        campaignType: isPMax ? "Performance Max" : "Search",
        pmaxImages: isPMax
          ? checkPMaxImageCompleteness((imageAssets as Array<{ fieldType: string }>).map(i => i.fieldType))
          : null,
      },
      policy,
      finalUrlCheck,
      // Từ khoá vượt trần SẼ bị bỏ lúc tạo thật. Nói trước ở đây, đừng để
      // người dùng tạo xong mới phát hiện thiếu.
      rejectedKeywords: kwLimitPlan.rejected,
      preflight,
      log: preflight ? preflightToLog(preflight) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Không chạy được phép kiểm", detail: describeGoogleAdsError(err) },
      { status: 500 },
    );
  }
}
