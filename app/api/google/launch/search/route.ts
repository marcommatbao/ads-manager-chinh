// ============================================================
// Google Ads — Launch Search Campaign
// POST /api/google/launch/search
// ============================================================
// Takes creative + keywords from generate-creative step
// → Creates real Google Ads: Campaign → Ad Groups → Keywords → RSA
// ============================================================

import { brandOverride } from "@/lib/brand/store";
import { catalogFor } from "@/lib/brand/catalog";
import { NextRequest, NextResponse } from "next/server";
import { ResourceNames } from "google-ads-api";
import { runPreflightGoogleSearch, preflightToLog } from "@/lib/launch-preflight";
import {
  getGoogleAdsCustomer,
  GOOGLE_CUSTOMER_IDS,
} from "@/lib/google-ads-client";
import { getProductCatalog } from "@/lib/google-creative-engine";
import { applyCampaignConversionGoals } from "@/lib/google-conversion-goals";
import { getCurrentUser } from "@/lib/auth";
import { cleanIds, recordPlaybookUsage } from "@/lib/playbook/usage";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { rollbackGoogleLaunch } from "@/lib/google-launch-rollback";
import { describeGoogleAdsError, googleAdsErrorMessage } from "@/lib/google-ads-error";
import { EU_POLITICAL_ADVERTISING_DECLARATION, sanitizeDisplayPath } from "@/lib/google-ads-helpers";
import { planSearchImageLinks } from "@/lib/google-image-asset";
import { checkFinalUrl } from "@/lib/google-final-url-check";
import { planKeywords } from "@/lib/google-keyword-limits";
import { planSitelinkLinks } from "@/lib/google-sitelink-asset";
import { GEO_VIETNAM, DEFAULT_LANGUAGES, DEFAULT_GEO_TARGET_TYPE } from "@/lib/google-targeting";
import { checkBidding, buildBiddingResource, DEFAULT_AD_GROUP_CPC_VND, type BiddingConfig } from "@/lib/google-bidding";
import { pickCompany } from "@/lib/companies"
import { companyDisplayPath } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

// ── Helpers ──

function getTodayGoogleFormat(): string {
  // Google Ads uses YYYYMMDD format for dates
  return new Date().toISOString().split("T")[0].replace(/-/g, "");
}

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

function updateCreativeStatus(id: string, status: string) {
  const filePath = path.join(process.cwd(), "data", "google-creatives.json");
  if (!fs.existsSync(filePath)) return;
  try {
    const creatives = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>[];
    const idx = creatives.findIndex((c) => c.id === id);
    if (idx >= 0) {
      creatives[idx].status = status;
      creatives[idx].launchedAt = new Date().toISOString();
      writeFileAtomicSync(filePath, JSON.stringify(creatives, null, 2));
    }
  } catch { /* ignore */ }
}

function saveLaunch(data: Record<string, unknown>): string {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const filePath = path.join(dataDir, "google-launches.json");
  let launches: Record<string, unknown>[] = [];
  if (fs.existsSync(filePath)) {
    try { launches = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { launches = []; }
  }

  const id = `gl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  launches.push({ id, ...data, launchedAt: new Date().toISOString() });
  writeFileAtomicSync(filePath, JSON.stringify(launches, null, 2));
  return id;
}

// Map AI pin suggestion → Google Ads pinned_field enum
function getPinPosition(
  headlineIndex: number,
  pinSuggestions: Record<string, number[]> | undefined
): string | null {
  if (!pinSuggestions) return null;
  if (pinSuggestions.position1?.includes(headlineIndex)) return "HEADLINE_1";
  if (pinSuggestions.position2?.includes(headlineIndex)) return "HEADLINE_2";
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST Handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền khởi chạy campaign" }, { status: 403 });
  }

  // Khai báo NGOÀI try: khối catch cần chúng để dọn phần đã ghi thật lên Google.
  // Thứ tự trong mảng = thứ tự xoá (con trước, cha sau).
  let customer: ReturnType<typeof getGoogleAdsCustomer> | null = null;
  const createdForRollback: Array<{ entity: string; resourceName: string }> = [];

  try {
    const {
      company = "MBC",
      googleCreativeId,
      dailyBudgetVnd = 500000,
      campaignName,
      startDate,
      /** Resource name của hành động chuyển đổi muốn tối ưu. Rỗng = để Google
       *  tự dùng TOÀN BỘ hành động đang bật ở cấp tài khoản (hành vi cũ). */
      conversionActions = [],
      /** Ảnh đã tải lên trước bằng /api/google/image-asset.
       *  [{ resourceName, fieldType }] — fieldType là MARKETING_IMAGE (1.91:1)
       *  hoặc SQUARE_MARKETING_IMAGE (1:1). */
      imageAssets = [],
      /** Sitelink CÓ SẴN trong tài khoản, chọn từ /api/google/assets/library.
       *  [{ resourceName, linkText }] — không dựng sitelink mới ở đây, dựng
       *  mới cho mỗi campaign chỉ sinh bản trùng trong thư viện tài sản. */
      sitelinkAssets = [],
      /** `true` = bật chạy ngay sau khi tạo xong. Mặc định `false` (PAUSED).
       *  Việc BẬT làm ở cuối cùng, sau khi đã đặt mục tiêu chuyển đổi và gắn
       *  tài sản — bật sớm là để campaign tiêu tiền trước khi nó biết đang
       *  đuổi theo cái gì. */
      launchActive = false,
      /** Vị trí nhắm, dạng ["geoTargetConstants/9040373", ...] chọn từ
       *  /api/google/geo-targets. Rỗng = cả nước Việt Nam (như trước). */
      locations = [],
      /** Tham số UTM gắn vào MỌI đường dẫn của chiến dịch.
       *  Dùng `final_url_suffix` của Google thay vì nhét thẳng vào URL: Google
       *  tự ghép nó vào mọi link (quảng cáo, sitelink, tiện ích), nên không
       *  phải sửa từng chỗ và không lo quên. Chấp nhận cả chỗ giữ chỗ động
       *  như {keyword} — đã kiểm, Google nhận.
       *  Rỗng = không gắn gì (hành vi cũ). */
      finalUrlSuffix = "",
      /** Ghi đè trang đích của sản phẩm. Rỗng = dùng URL trong danh mục.
       *  Cần vì danh mục chỉ có MỘT link mỗi sản phẩm, trong khi một chiến
       *  dịch có thể muốn đẩy về trang bảng giá, trang khuyến mãi… */
      finalUrlOverride = "",
      /** Chiến lược đấu thầu. Không truyền thì giữ hành vi cũ: Tối đa chuyển
       *  đổi, và nếu bản nghiên cứu từ khoá có đề xuất Target CPA thì dùng nó. */
      bidding = null,
      /** PRESENCE (chỉ người trong vùng) hay PRESENCE_OR_INTEREST (thêm người
       *  ngoài vùng quan tâm tới vùng đó). Mặc định PRESENCE. */
      geoTargetType = DEFAULT_GEO_TARGET_TYPE,
      /** Đợt 7b — mã sản phẩm + các dòng Sổ kinh nghiệm dùng cho lượt này (chỉ để ghi sổ). */
      productKey = "",
      /** Đợt 7b — từ phủ định thêm từ Sổ kinh nghiệm ở màn tạo. Route đọc phủ định từ
       *  creative đã lưu, mà màn tạo không ghi được phủ định xuống đó → gửi kèm ở đây. */
      extraNegativeKeywords = [],
      playbookEntryIds = [],
      playbookOverriddenAvoidIds = [],
    } = await req.json();

    // Each company has its own Google Ads customer account — gate before
    // creating any real campaign against it (same pattern as the
    // Meta launch/budget/status mutation routes).
    if (!canAccessCompany(user, pickCompany(company))) {
      return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
    }

    // ── Validate ──
    if (!googleCreativeId || !campaignName) {
      return NextResponse.json(
        { success: false, error: "Missing required: googleCreativeId, campaignName" },
        { status: 400 }
      );
    }

    // ── Load creative data ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creative = loadCreative(googleCreativeId) as any;
    if (!creative) {
      return NextResponse.json(
        { success: false, error: "Creative không tồn tại" },
        { status: 404 }
      );
    }

    const rsa = creative.rsa;
    const keywords = creative.keywords;

    if (!rsa?.headlines || !keywords?.keywords) {
      return NextResponse.json(
        { success: false, error: "Creative thiếu RSA hoặc Keywords data" },
        { status: 400 }
      );
    }

    // Preflight validation with creative data
    const preflight = runPreflightGoogleSearch({ company, googleCreativeId, dailyBudgetVnd, campaignName, rsa, keywords });
    if (preflight.status === "blocked") {
      return NextResponse.json(
        { success: false, error: `Preflight failed: ${preflight.errors[0]?.message ?? "validation error"}`, preflight, log: preflightToLog(preflight) },
        { status: 422 },
      );
    }

    // ── Resolve product info ──
    const catalog = catalogFor(company); // Đợt 21 A3: hồ sơ doanh nghiệp (MBC/MBI chưa lưu = catalog cũ)
    const product = catalog[creative.productId];
    // KHÔNG thay bằng trang chủ khi sản phẩm thiếu URL. Thay ngầm là che mất
    // đúng vấn đề: quảng cáo vẫn tạo được nhưng trỏ sai chỗ, tiền vẫn mất mà
    // số liệu thì hỏng. Để rỗng cho phép kiểm bên dưới chặn kèm giải thích.
    const catalogUrl = product
      ? (product.finalUrls[company] ?? product.finalUrls[product.company] ?? "")
      : "https://www.matbao.net/";
    const finalUrl = String(finalUrlOverride).trim() || catalogUrl;

    // ── Trang đích PHẢI mở được ─────────────────────────────────────────────
    // Google cho trình thu thập vào thử; vào không được thì từ chối quảng cáo
    // với chủ đề DESTINATION_NOT_WORKING, loại PROHIBITED (cấm hẳn). Mà lời
    // từ chối KHÔNG nhắc gì tới URL — nó chỉ nói "policy topics of type
    // PROHIBITED", nên người dùng đi sửa câu chữ, sai hướng hoàn toàn.
    //
    // Chặn ở đây, TRƯỚC khi tạo bất cứ thứ gì trên tài khoản: một lượt HTTP
    // rẻ hơn nhiều so với tạo campaign rồi bị Google gạt rồi phải rollback.
    const urlCheck = await checkFinalUrl(finalUrl);
    if (!urlCheck.ok) {
      return NextResponse.json({
        success: false,
        error: `Trang đích không dùng được: ${urlCheck.problem}`,
        finalUrlCheck: urlCheck,
        // Không có gì được tạo nên không có gì phải dọn — nói rõ để người dùng
        // khỏi lo tài khoản còn rác.
        rollback: "Chưa tạo gì trên tài khoản Google — dừng trước bước đầu tiên.",
      }, { status: 422 });
    }

    // ── Google Ads Customer ──
    customer = getGoogleAdsCustomer(company);
    const customerId = GOOGLE_CUSTOMER_IDS[company];
    const budgetMicros = dailyBudgetVnd * 1_000_000; // VND → micros

    // ── Chiến lược đấu thầu ────────────────────────────────────────────────
    // Bản cũ LUÔN dùng maximize_conversions và lặng lẽ lấy
    // `keywords.biddingRecommendation.targetCPA` áp thẳng làm target_cpa_micros
    // — tức AI đặt giá thầu mục tiêu trong khi giao diện gọi đó là "gợi ý", và
    // người dùng không có nút nào sửa hay tắt.
    //
    // Nay người dùng chọn. Không chọn thì GIỮ NGUYÊN hành vi cũ (gồm cả việc
    // dùng đề xuất của AI) để lần tạo cũ không đổi kết quả — nhưng giao diện
    // đã hiện rõ con số đó là gì.
    const biddingConfig: BiddingConfig = bidding ?? {
      strategy: "MAXIMIZE_CONVERSIONS",
      targetCpaVnd: keywords.biddingRecommendation?.targetCPA ?? null,
    };

    const biddingCheck = checkBidding(biddingConfig, "SEARCH", { dailyBudgetVnd });
    if (biddingCheck.errors.length > 0) {
      // Chặn TRƯỚC khi tạo gì: Google nhận cả target_cpa = 0 mà không báo lỗi
      // (đã đo), nên để lọt là tạo ra campaign cấu hình vô nghĩa trên tài khoản.
      return NextResponse.json(
        { success: false, error: `Cấu hình đấu thầu không hợp lệ: ${biddingCheck.errors.join(" ")}` },
        { status: 422 },
      );
    }
    const built = buildBiddingResource(biddingConfig);

    // ═══════════════════════════════════════════
    // PHASE 1: Create Campaign + Budget (atomic)
    // ═══════════════════════════════════════════

    const budgetTempId = "-1";
    const campaignTempId = "-2";
    const budgetRN = ResourceNames.campaignBudget(customerId, budgetTempId);
    const campaignRN = ResourceNames.campaign(customerId, campaignTempId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phase1Ops: any[] = [
      {
        entity: "campaign_budget",
        operation: "create",
        resource: {
          resource_name: budgetRN,
          name: `Budget — ${campaignName}`,
          amount_micros: budgetMicros,
          delivery_method: "STANDARD",
          explicitly_shared: false,
        },
      },
      {
        entity: "campaign",
        operation: "create",
        resource: {
          // Google bắt buộc trường này khi tạo campaign — xem lib/google-ads-helpers.
          contains_eu_political_advertising: EU_POLITICAL_ADVERTISING_DECLARATION,
          resource_name: campaignRN,
          name: campaignName,
          status: "PAUSED", // Luôn PAUSED — user review rồi mới bật
          advertising_channel_type: "SEARCH",
          campaign_budget: budgetRN,
          start_date: startDate
            ? startDate.replace(/-/g, "")
            : getTodayGoogleFormat(),
          // Bidding — dựng từ lựa chọn của người dùng, xem lib/google-bidding.
          ...built.resource,
          // UTM. TRƯỚC BẢN NÀY chiến dịch tool tạo ra KHÔNG có tham số nào —
          // trong khi các chiến dịch đang chạy của tài khoản đều có. Thiếu UTM
          // thì GA4 không phân biệt được lưu lượng từ chiến dịch nào, và mọi
          // báo cáo quy kết doanh thu đều lệch.
          ...(String(finalUrlSuffix).trim()
            ? { final_url_suffix: String(finalUrlSuffix).trim().replace(/^\?/, "") }
            : {}),
          // Chỉ định RÕ campaign này tối ưu cho hành động chuyển đổi nào.
          //
          // Không có trường này thì `maximize_conversions` đuổi theo TOÀN BỘ
          // hành động đang bật ở cấp tài khoản — đơn hàng, xem trang liên hệ,
          // gọi điện, tất cả trộn làm một. Tức để Google tự quyết tiền chảy về
          // đâu, và con số "conversions" trong báo cáo không nói lên điều gì cụ
          // thể. Đây cũng là gốc của chuyện Facebook và Google không so CPL
          // trực tiếp được (xem /api/dashboard/unified).
          // KHÔNG dùng `selective_optimization` ở đây: trường đó CHỈ áp dụng
          // cho chiến dịch Ứng dụng, và Google trả "The error code is not in
          // this version" cho Search/PMax. Mục tiêu chuyển đổi được chốt SAU
          // khi tạo, qua campaign_conversion_goal — xem lib/google-conversion-goals.
          // Networks
          network_settings: {
            target_google_search: true,
            target_search_network: true,
            target_content_network: false,
            target_partner_search_network: false,
          },
          // Kiểu nhắm vị trí. PRESENCE = chỉ người ĐANG Ở trong vùng đã chọn.
          // Trước đây là PRESENCE_OR_INTEREST (mặc định của Google), kéo cả
          // người ở nước ngoài tìm "hosting Việt Nam" vào tệp — đó là lý do
          // quen thuộc của chuyện "sao quảng cáo hiện ở nước ngoài".
          // Quyết định nghiệp vụ 18/09/2026: chỉ bán trong nước.
          geo_target_type_setting: {
            positive_geo_target_type: geoTargetType,
          },
        },
      },
    ];

    const phase1Result = await customer.mutateResources(phase1Ops) as any;
    const budgetResourceName: string = phase1Result.mutate_operation_responses?.[0]?.campaign_budget_result?.resource_name
      ?? phase1Result[0]?.campaign_budget?.resource_name
      ?? "";
    if (budgetResourceName) createdForRollback.push({ entity: "campaign_budget", resourceName: budgetResourceName });
    const campaignResourceName = phase1Result.mutate_operation_responses?.[1]?.campaign_result?.resource_name
      ?? phase1Result[1]?.campaign?.resource_name
      ?? `customers/${customerId}/campaigns/unknown`;

    createdForRollback.unshift({ entity: "campaign", resourceName: campaignResourceName });
    console.log("[launch/search] Phase 1 done — Campaign:", campaignResourceName);

    // ═══════════════════════════════════════════
    // PHASE 2: Vị trí (VN) + Ngôn ngữ (Việt + Anh)
    // ═══════════════════════════════════════════
    // Hằng số lấy từ lib/google-targeting — TRƯỚC BẢN NÀY tệp này tự gõ
    // `languageConstants/1020` kèm chú thích "Vietnamese", nhưng 1020 là
    // tiếng BULGARIA. Tiếng Việt là 1040. Mọi campaign tool từng tạo đều nhắm
    // sai ngôn ngữ nên gần như không hiển thị được lượt nào.

    let targetingApplied = false;
    let targetingError: string | null = null;

    // Vị trí người dùng chọn; rỗng thì về mặc định cả nước.
    //
    // Khử trùng ở đây KHÔNG phải để tránh lỗi: đo bằng validate_only ngày
    // 18/09/2026 thì Google VẪN NHẬN lô có vị trí lặp (khác Sitelink — chỗ đó
    // lặp là rớt cả lô). Khử trùng để không tạo ra hai tiêu chí y hệt nhau
    // trong campaign, vốn chỉ làm rối bảng Vị trí trên Google Ads.
    const pickedLocations = Array.isArray(locations)
      ? [...new Set((locations as string[]).filter((l) => typeof l === "string" && l.startsWith("geoTargetConstants/")))]
      : [];
    const locationsToUse = pickedLocations.length > 0 ? pickedLocations : [GEO_VIETNAM];

    // Kiểu tường minh: suy kiểu tự động lấy theo phần tử ĐẦU (location) rồi
    // báo lỗi ở các phần tử language — hai loại tiêu chí có hình dạng khác nhau.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetingOps: any[] = [
      ...locationsToUse.map((geo) => ({
        entity: "campaign_criterion",
        operation: "create",
        resource: {
          campaign: campaignResourceName,
          location: { geo_target_constant: geo },
        },
      })),
      ...DEFAULT_LANGUAGES.map((lang) => ({
        entity: "campaign_criterion",
        operation: "create",
        resource: {
          campaign: campaignResourceName,
          language: { language_constant: lang },
        },
      })),
    ];

    try {
      await customer.mutateResources(targetingOps);
      targetingApplied = true;
      console.log("[launch/search] Phase 2 done — Geo + Language set");
    } catch (e) {
      // KHÔNG còn nuốt im lặng. Campaign KHÔNG có tiêu chí vị trí nghĩa là
      // Google phục vụ TOÀN THẾ GIỚI — với ngân sách ngày và nút "Chạy Ngay",
      // đây là cách đốt tiền nhanh nhất mà màn hình vẫn báo thành công.
      // Ghi lại để trả về cho người dùng, không chỉ ghi vào log không ai đọc.
      targetingError = googleAdsErrorMessage(e);
      console.error("[launch/search] Phase 2 HỎNG (geo/language):", targetingError);
    }

    // ── Tiện ích hình ảnh ──────────────────────────────────────────────────
    // Gắn ở cấp CAMPAIGN chứ không phải ad group: ảnh dùng chung cho mọi nhóm,
    // gắn từng nhóm chỉ nhân bản cùng một liên kết.
    //
    // KHÔNG cho hỏng cả lượt launch: ảnh là tiện ích tăng thêm, campaign vẫn
    // chạy được khi thiếu. Hỏng thì ghi lại và đi tiếp — dừng ở đây sẽ kích
    // rollback xoá sạch campaign đã tạo đúng, chỉ vì một cái ảnh.
    let imageAssetNote: string | null = null;
    let imagesAttached = 0;
    if (Array.isArray(imageAssets) && imageAssets.length > 0) {
      // Đổi loại liên kết sang AD_IMAGE và loại ảnh Search không nhận. Bản cũ
      // gửi thẳng fieldType của PMax (MARKETING_IMAGE…) nên Google từ chối
      // 100% số lần — xem chú thích trong lib/google-image-asset.ts.
      const plan = planSearchImageLinks(imageAssets as Array<{ resourceName: string; fieldType?: string; ratioLabel?: string; name?: string }>);
      const notes: string[] = [];

      if (plan.links.length > 0) {
        try {
          await customer.mutateResources(
            plan.links.map((img) => ({
              entity: "campaign_asset",
              operation: "create",
              resource: {
                campaign: campaignResourceName,
                asset: img.resourceName,
                field_type: img.fieldType,
              },
            })),
          );
          imagesAttached = plan.links.length;
          console.log("[launch/search] Đã gắn", imagesAttached, "ảnh vào campaign");
        } catch (imgErr) {
          // describeGoogleAdsError() trả về OBJECT {message, details, requestId},
          // không phải chuỗi — nhét thẳng vào template string trước đây in ra
          // đúng "[object Object]", không ai đọc được lý do thật Google từ chối.
          notes.push(`KHÔNG gắn được ${plan.links.length} ảnh: ${describeGoogleAdsError(imgErr).message}. Vào Google Ads gắn tay ở mục Tài sản.`);
          console.error("[launch/search] Gắn ảnh hỏng:", notes[notes.length - 1]);
        }
      }

      for (const s of plan.skipped) notes.push(`Bỏ qua "${s.label}": ${s.reason}`);
      if (notes.length > 0) imageAssetNote = `Campaign đã tạo. ${notes.join(" ")}`;
    }

    // ── Sitelink ────────────────────────────────────────────────────────────
    // Cùng nguyên tắc với ảnh: KHÔNG cho hỏng cả lượt launch. Sitelink là tiện
    // ích, thiếu thì campaign vẫn chạy — ném lỗi ở đây sẽ kích rollback xoá
    // sạch campaign đã tạo đúng.
    let sitelinkNote: string | null = null;
    let sitelinksAttached = 0;
    if (Array.isArray(sitelinkAssets) && sitelinkAssets.length > 0) {
      const slPlan = planSitelinkLinks(sitelinkAssets as Array<{ resourceName: string; linkText?: string }>);
      const notes: string[] = [];

      if (slPlan.links.length > 0) {
        try {
          await customer.mutateResources(
            slPlan.links.map((s) => ({
              entity: "campaign_asset",
              operation: "create",
              resource: { campaign: campaignResourceName, asset: s.resourceName, field_type: s.fieldType },
            })),
          );
          sitelinksAttached = slPlan.links.length;
          console.log("[launch/search] Đã gắn", sitelinksAttached, "sitelink vào campaign");
        } catch (slErr) {
          notes.push(`KHÔNG gắn được ${slPlan.links.length} sitelink: ${describeGoogleAdsError(slErr).message}.`);
          console.error("[launch/search] Gắn sitelink hỏng:", notes[notes.length - 1]);
        }
      }

      for (const s of slPlan.skipped) notes.push(`Bỏ qua "${s.label}": ${s.reason}`);
      if (slPlan.warning) notes.push(slPlan.warning);
      if (notes.length > 0) sitelinkNote = notes.join(" ");
    }

    // ═══════════════════════════════════════════
    // PHASE 3: Ad Groups + Keywords + RSA Ads
    // ═══════════════════════════════════════════

    // Loại từ khoá vượt trần TRƯỚC khi gửi. Lệnh đi theo LÔ nên một từ khoá
    // dài quá làm Google gạt cả lô — mất luôn campaign. Ca thật 22/09/2026:
    // "Keyword text has too many words. (mutate_operations[10]...)".
    //
    // BỎ chứ không CHẶN, giống cách repo này xử tiêu đề dài quá 30 ký tự.
    // Nhưng bỏ HẾT thì phải chặn: campaign Search không có từ khoá thì không
    // hiển thị được cho ai, tạo ra chỉ để nằm chết.
    const kwPlan = planKeywords(
      (keywords.keywords ?? []) as Array<{ keyword: string; matchType?: string }>
    );
    if (kwPlan.allRejected) {
      return NextResponse.json({
        success: false,
        error: `Không từ khoá nào dùng được — cả ${kwPlan.rejected.length} từ khoá đều vượt trần của Google.`,
        rejectedKeywords: kwPlan.rejected,
        rollback: "Chưa tạo gì trên tài khoản Google — dừng trước bước đầu tiên.",
      }, { status: 422 });
    }
    keywords.keywords = kwPlan.usable;

    const adGroupSuggestions = keywords.adGroupSuggestions ?? [
      { name: `${campaignName} — All Keywords`, theme: "Default", keywords: keywords.keywords.map((k: { keyword: string }) => k.keyword) },
    ];

    const adGroupResults: { name: string; keywordCount: number }[] = [];

    for (let gi = 0; gi < adGroupSuggestions.length; gi++) {
      const group = adGroupSuggestions[gi];
      const agTempId = String(-(10 + gi));
      const agRN = ResourceNames.adGroup(customerId, agTempId);

      // 3a. Create Ad Group
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agOps: any[] = [
        {
          entity: "ad_group",
          operation: "create",
          resource: {
            resource_name: agRN,
            name: group.name,
            campaign: campaignResourceName,
            status: "ENABLED",
            type: "SEARCH_STANDARD",
            // CPC thủ công sống ở CẤP NHÓM, không phải cấp campaign — chọn
            // Manual CPC mà quên đặt ở đây thì giá thầu vẫn là số ghim cứng cũ.
            cpc_bid_micros: built.adGroupCpcMicros ?? DEFAULT_AD_GROUP_CPC_VND * 1_000_000,
          },
        },
      ];

      const agResult = await customer.mutateResources(agOps) as any;
      const adGroupResourceName = agResult.mutate_operation_responses?.[0]?.ad_group_result?.resource_name
        ?? agResult[0]?.ad_group?.resource_name
        ?? agRN;
      // Ad group phải bị xoá TRƯỚC campaign → đưa lên đầu hàng đợi dọn.
      createdForRollback.unshift({ entity: "ad_group", resourceName: adGroupResourceName });

      // 3b. Add keywords to the ad group
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kwOps: any[] = [];

      // Positive keywords
      const groupKwTexts = (group.keywords as string[]) ?? [];
      const matchedKws = keywords.keywords.filter((kw: { keyword: string }) =>
        groupKwTexts.some((gk: string) =>
          kw.keyword.toLowerCase().includes(gk.toLowerCase()) ||
          gk.toLowerCase().includes(kw.keyword.toLowerCase())
        )
      );
      // Fallback: if no matches, add all
      const kwsToAdd = matchedKws.length > 0 ? matchedKws : keywords.keywords;

      for (const kw of kwsToAdd) {
        kwOps.push({
          entity: "ad_group_criterion",
          operation: "create",
          resource: {
            ad_group: adGroupResourceName,
            status: "ENABLED",
            keyword: {
              text: kw.keyword,
              match_type: kw.matchType || "BROAD",
            },
          },
        });
      }

      // Từ khoá phủ định KHÔNG còn gắn ở đây nữa — xem khối "Từ khoá phủ định"
      // sau vòng lặp nhóm quảng cáo. Gắn trong vòng lặp này nghĩa là mỗi nhóm
      // nhận một bản sao đầy đủ (~60 cụm × N nhóm), trong khi cấp campaign chỉ
      // cần gắn một lần và áp cho toàn chiến dịch. Đã đo: Google chấp nhận cả
      // hai cấp, nên đây là chọn cách gọn hơn chứ không phải sửa lỗi.

      if (kwOps.length > 0) {
        await customer.mutateResources(kwOps);
      }

      // 3c. Create RSA Ad in this ad group
      const validHeadlines = (rsa.headlines ?? [])
        .filter((h: { isValid: boolean }) => h.isValid !== false)
        .slice(0, 15);

      const headlines = validHeadlines.map((h: { text: string; id: number }, idx: number) => {
        const pin = getPinPosition(h.id ?? idx + 1, rsa.pinSuggestions);
        return pin
          ? { text: h.text, pinned_field: pin }
          : { text: h.text };
      });

      const descriptions = (rsa.descriptions ?? [])
        .filter((d: { isValid: boolean }) => d.isValid !== false)
        .slice(0, 4)
        .map((d: { text: string }) => ({ text: d.text }));

      // Đường dẫn hiển thị: xem chú thích ở sanitizeDisplayPath. Bản cũ giữ
      // lại DẤU CÁCH và DẤU TIẾNG VIỆT ở path1, còn path2 đặt cứng "matbao.net"
      // — dấu chấm khiến Google từ chối cả lệnh tạo quảng cáo.
      const productPath = sanitizeDisplayPath(product?.name);

      await customer.mutateResources([
        {
          entity: "ad_group_ad",
          operation: "create",
          resource: {
            ad_group: adGroupResourceName,
            status: "ENABLED",
            ad: {
              responsive_search_ad: {
                headlines,
                descriptions,
                path1: productPath,
                path2: sanitizeDisplayPath(brandOverride(company)?.displayPath || (company === "MBI" ? "matbao in" : company === "MBC" ? "matbao net" : companyDisplayPath(company))),
              },
              final_urls: [finalUrl],
            },
          },
        },
      ]);

      adGroupResults.push({
        name: group.name,
        keywordCount: kwsToAdd.length,
      });

      console.log(`[launch/search] Phase 3 — Ad Group "${group.name}" done (${kwsToAdd.length} kw)`);
    }

    // ═══════════════════════════════════════════
    // SAVE RESULT
    // ═══════════════════════════════════════════

    // ── Từ khoá phủ định (cấp chiến dịch) ───────────────────────────────────
    // TRƯỚC BẢN NÀY phần này KHÔNG BAO GIỜ CHẠY: schema yêu cầu Gemini trả về
    // không có trường `negativeKeywords`, nên `keywords.negativeKeywords` luôn
    // undefined và vòng lặp cũ là no-op. Mọi chiến dịch Search ra đời với ĐÚNG
    // SỐ KHÔNG từ khoá phủ định — xem lib/google-negative-keywords.
    //
    // Không cho hỏng cả lượt launch: campaign đã tạo xong rồi, thiếu từ phủ
    // định thì vẫn chạy (chỉ tốn hơn), ném lỗi ở đây sẽ kích rollback xoá sạch.
    let negativeNote: string | null = null;
    let negativesAdded = 0;
    const negList = [...((keywords.negativeKeywords ?? []) as Array<{ keyword: string; matchType?: string }>)];
    if (Array.isArray(extraNegativeKeywords)) {
      const seen = new Set(negList.map((n) => String(n.keyword).trim().toLowerCase()));
      for (const raw of (extraNegativeKeywords as unknown[]).slice(0, 50)) {
        const kw = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
        if (kw && !seen.has(kw.toLowerCase())) { seen.add(kw.toLowerCase()); negList.push({ keyword: kw, matchType: "PHRASE" }); }
      }
    }
    if (negList.length > 0) {
      try {
        await customer.mutateResources(negList.map((nk) => ({
          entity: "campaign_criterion",
          operation: "create",
          resource: {
            campaign: campaignResourceName,
            negative: true,
            keyword: { text: nk.keyword, match_type: nk.matchType || "PHRASE" },
          },
        })));
        negativesAdded = negList.length;
        console.log("[launch/search] Đã thêm", negativesAdded, "từ khoá phủ định");
      } catch (negErr) {
        negativeNote = `KHÔNG thêm được ${negList.length} từ khoá phủ định: ${describeGoogleAdsError(negErr).message}. Campaign vẫn chạy nhưng sẽ tốn tiền vào lượt tìm không liên quan — vào Google Ads thêm tay.`;
        console.error("[launch/search] Thêm từ phủ định hỏng:", negativeNote);
      }
    } else {
      negativeNote = "Chiến dịch này KHÔNG có từ khoá phủ định nào. Với match type BROAD/PHRASE, tiền dễ chảy vào lượt tìm không liên quan (tuyển dụng, miễn phí, tự làm…).";
    }

    // ═══════════════════════════════════════════
    // Chốt mục tiêu chuyển đổi (sau khi đã có chiến dịch)
    // ═══════════════════════════════════════════
    // Mục tiêu chỉ tồn tại khi chiến dịch đã được tạo, nên không gộp vào lệnh
    // tạo được — và cũng vì thế phép "Kiểm trước" không kiểm được bước này.
    // Hỏng ở đây KHÔNG huỷ lần tạo: chiến dịch đang PAUSED, người dùng chỉnh
    // tay trong Google Ads được. Nhưng phải BÁO RA, vì chạy sai mục tiêu là
    // sai chỗ tốn tiền nhất mà lại không có dấu hiệu gì.
    let conversionGoalReport = null;
    if (Array.isArray(conversionActions) && conversionActions.length > 0) {
      const cid = String(campaignResourceName).split("/").pop() ?? "";
      conversionGoalReport = await applyCampaignConversionGoals(customer, {
        campaignId: cid,
        conversionActionResourceNames: conversionActions as string[],
      });
    }

    await recordPlaybookUsage({
      by: user?.email ?? "", company: String(company), platform: "google",
      productKey: typeof productKey === "string" ? productKey.slice(0, 60) : "",
      campaignId: String(campaignResourceName).split("/").pop() ?? "", campaignName: String(campaignName),
      entryIds: cleanIds(playbookEntryIds), overriddenAvoidIds: cleanIds(playbookOverriddenAvoidIds),
    });

    // ═══════════════════════════════════════════
    // BẬT CHẠY (chỉ khi người dùng chọn "Tạo & Chạy Ngay")
    // ═══════════════════════════════════════════
    // Làm ở ĐÂY, cuối cùng, có lý do: ad group và quảng cáo đã ENABLED sẵn từ
    // lúc tạo, nên campaign chuyển sang ENABLED là tiền bắt đầu chảy ngay. Đặt
    // bước này TRƯỚC khi chốt mục tiêu chuyển đổi thì có một khoảng campaign
    // đang chạy mà chưa biết nó đuổi theo cái gì — đúng chỗ tốn tiền nhất mà
    // không để lại dấu vết gì.
    //
    // Hỏng ở bước bật KHÔNG huỷ lần tạo: campaign vẫn còn nguyên và đang
    // PAUSED, bật tay trong Google Ads là xong. Nhưng phải nói ra, không thì
    // người dùng bấm "Chạy Ngay" rồi tưởng nó đang chạy.
    let activated = false;
    let activationError: string | null = null;

    // CHẶN CỨNG: nhắm mục tiêu hỏng thì KHÔNG bật, dù người dùng đã bấm
    // "Chạy Ngay". Campaign không có tiêu chí vị trí được Google phục vụ ra
    // TOÀN THẾ GIỚI — bật nó lên là đốt ngân sách ngày vào lưu lượng không bao
    // giờ mua gì. Đây là ca duy nhất trong route này mà việc KHÔNG làm theo
    // lệnh người dùng là đúng; bù lại phải nói thẳng vì sao.
    if (launchActive && !targetingApplied) {
      activationError =
        `KHÔNG bật vì chưa đặt được vị trí/ngôn ngữ (${targetingError ?? "lý do không rõ"}). ` +
        `Campaign không có tiêu chí vị trí sẽ được Google phục vụ ra TOÀN THẾ GIỚI — bật lên là đốt ngân sách. ` +
        `Vào Google Ads đặt vị trí Việt Nam trước, rồi hãy bật.`;
      console.error("[launch/search] CHẶN bật campaign:", activationError);
    } else if (launchActive) {
      try {
        await customer.campaigns.update([{ resource_name: campaignResourceName, status: "ENABLED" }]);
        activated = true;
        console.log("[launch/search] Đã BẬT campaign:", campaignResourceName);
      } catch (actErr) {
        activationError = describeGoogleAdsError(actErr).message;
        console.error("[launch/search] Bật campaign hỏng:", activationError);
      }
    }

    const finalStatus = activated ? "ENABLED" : "PAUSED";

    // Lưu SAU khi đã chốt trạng thái thật, không lưu "PAUSED" rồi mới đi bật —
    // sổ ghi lệch với thực tế còn tệ hơn không ghi.
    const launchId = saveLaunch({
      googleCreativeId,
      company,
      campaignName,
      campaignResourceName,
      adGroups: adGroupResults,
      status: finalStatus,
      dailyBudget: dailyBudgetVnd,
      productId: creative.productId,
    });

    // Update creative status
    updateCreativeStatus(googleCreativeId, "LAUNCHED");

    return NextResponse.json({
      success: true,
      launchId,
      campaignResourceName,
      status: finalStatus,
      launchActive: Boolean(launchActive),
      activated,
      activationError,
      // Nhắm mục tiêu PHẢI trả về màn hình. Trước bản này bước đặt vị trí/ngôn
      // ngữ hỏng chỉ ghi console.warn rồi đi tiếp — người dùng không có cách
      // nào biết campaign của mình có được nhắm vị trí hay không.
      targetingApplied,
      targetingError,
      targeting: targetingApplied
        ? {
            // Trả về ĐÚNG mã đã gửi, không phải câu chữ dựng sẵn — người dùng
            // đối chiếu được với Google Ads, và nếu sai thì sai lộ ra ngay.
            locations: locationsToUse,
            locationCount: locationsToUse.length,
            wholeCountry: locationsToUse.length === 1 && locationsToUse[0] === GEO_VIETNAM,
            languages: ["Tiếng Việt", "Tiếng Anh"],
          }
        : null,
      bidding: { strategy: biddingConfig.strategy, summary: built.summary },
      // Từ khoá bị loại vì vượt trần Google. PHẢI trả về ở cả lượt THÀNH CÔNG:
      // bỏ âm thầm thì người dùng tưởng đã lên đủ 40 từ khoá, thực tế 38.
      rejectedKeywords: kwPlan.rejected,
      finalUrl,
      finalUrlSuffix: String(finalUrlSuffix).trim() || null,
      negativesAdded,
      negativeNote,
      biddingWarnings: biddingCheck.warnings,
      conversionGoalReport,
      adGroupsCount: adGroupResults.length,
      adGroups: adGroupResults,
      // Ảnh hỏng KHÔNG được im lặng: campaign vẫn tạo, nhưng người dùng phải
      // biết để vào gắn tay, không thì tưởng đã có tiện ích hình ảnh.
      imageAssetNote,
      imagesAttached,
      sitelinkNote,
      sitelinksAttached,
      message: activationError
        ? `Campaign đã tạo nhưng KHÔNG bật được: ${activationError} — nó đang PAUSED, bật tay trong Google Ads.`
        : activated
          ? `🚀 Campaign ĐANG CHẠY. Đã gắn ${imagesAttached} ảnh, ${sitelinksAttached} sitelink. Tiền bắt đầu tiêu từ bây giờ.`
          : imageAssetNote || sitelinkNote
            ? `Campaign đã tạo ở trạng thái PAUSED. Đã gắn ${imagesAttached} ảnh, ${sitelinksAttached} sitelink — phần còn lại xem ghi chú bên dưới.`
            : "Campaign đã tạo thành công ở trạng thái PAUSED. Vào Google Ads để review và bật.",
      googleAdsUrl: `https://ads.google.com/aw/campaigns?__e=${customerId}`,
    });
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    console.error("[launch/search] Error:", err?.message ?? err);

    // Dọn phần đã ghi thật trước khi lỗi — nếu không, mỗi lần launch hỏng để
    // lại một campaign PAUSED rỗng + budget mồ côi nằm vĩnh viễn trên tài khoản.
    let rollbackNote = "";
    try {
      const rb = customer ? await rollbackGoogleLaunch(customer, createdForRollback) : { attempted: false, summary: "" };
      if (rb.attempted) {
        rollbackNote = rb.summary;
        console.warn("[launch/search] rollback:", rb.summary);
      }
    } catch (rbErr) {
      // Dọn hỏng không được che lỗi gốc.
      rollbackNote = `Không dọn được phần đã tạo dở: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`;
      console.warn("[launch/search]", rollbackNote);
    }

    // Extract Google Ads API error details
    // google-ads-api ném GoogleAdsFailure (object) chứ không phải Error, nên
    // `err?.message` thường rỗng và người dùng chỉ nhận được "Launch failed" —
    // không biết Google từ chối vì trường nào.
    const gInfo = describeGoogleAdsError(err);

    // Ghi NGUYÊN VĂN lỗi Google khi dính chính sách. App chặn IP nên không tự
    // bấm thử được — log này là đường duy nhất để đọc đúng hình dạng Google
    // trả về khi người dùng gặp lỗi thật, thay vì đoán.
    if (/policy/i.test(gInfo.message) || gInfo.policyTopics.length > 0) {
      try {
        console.error("[launch/search] POLICY RAW:", JSON.stringify(
          (err?.errors ?? err?.failure?.errors ?? err), null, 2).slice(0, 4000));
      } catch {
        console.error("[launch/search] POLICY RAW: không tuần tự hoá được", err);
      }
    }
    const errorDetails = gInfo.details.length > 0
      ? gInfo.details
      : (err?.errors ?? err?.response?.data?.error?.details ?? []);
    const errorMessage = gInfo.message || err?.message || "Launch failed";

    return NextResponse.json(
      {
        success: false,
        error: friendlyError(errorMessage),
        details: errorDetails,
        code: err?.code ?? "LAUNCH_FAILED",
        requestId: gInfo.requestId,
        // Chủ đề chính sách + ĐÚNG CHỮ bị gắn cờ. Không có phần này thì lời
        // từ chối của Google là "policy topics of type PROHIBITED" — không nói
        // chủ đề nào, không nói dòng nào phải sửa, người dùng không làm gì được.
        policyTopics: gInfo.policyTopics.length > 0 ? gInfo.policyTopics : undefined,
        // ĐƯỜNG DỰ PHÒNG: nếu Google trả chi tiết theo hình dạng khác với
        // policy_finding_details, bộ bóc ở trên sẽ ra rỗng và người dùng lại
        // nhận đúng câu lỗi không hành động được gì. Gửi kèm phần details THÔ
        // để màn hình luôn có cái để hiện. Thà xấu còn hơn không có.
        rawErrorDetails: gInfo.policyTopics.length === 0
          ? (() => {
              try {
                const list = (err?.errors ?? err?.failure?.errors ?? []) as Array<Record<string, unknown>>;
                const withDetails = list.filter((e) => e?.details).map((e) => e.details);
                return withDetails.length > 0 ? JSON.parse(JSON.stringify(withDetails)) : undefined;
              } catch { return undefined; }
            })()
          : undefined,
        rollback: rollbackNote || undefined,
      },
      { status: 500 }
    );
  }
}
