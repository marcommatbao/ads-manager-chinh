// ============================================================
// Google Ads — Launch Performance Max Campaign
// POST /api/google/launch/pmax
// ============================================================
// Takes PMax creative from generate-creative step
// → Creates real Google Ads: Campaign → Asset Group → Assets → Audience Signals
// ============================================================

import { brandOverride } from "@/lib/brand/store";
import { catalogFor } from "@/lib/brand/catalog";
import { NextRequest, NextResponse } from "next/server";
import { ResourceNames } from "google-ads-api";
import { runPreflightGooglePMax, preflightToLog } from "@/lib/launch-preflight";
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
import { normalizeAdTexts, GOOGLE_PMAX_LIMITS, GOOGLE_PMAX_MAX } from "@/lib/creative-limits";
import { checkPMaxImageCompleteness } from "@/lib/google-image-asset";
import { EU_POLITICAL_ADVERTISING_DECLARATION } from "@/lib/google-ads-helpers";
import { GEO_VIETNAM, DEFAULT_LANGUAGES, DEFAULT_GEO_TARGET_TYPE } from "@/lib/google-targeting";
import { checkBidding, buildBiddingResource, type BiddingConfig } from "@/lib/google-bidding";
import { planVideos } from "@/lib/google-youtube-asset";
import { checkFinalUrl } from "@/lib/google-final-url-check";
import { planSitelinkLinks } from "@/lib/google-sitelink-asset";
import { pickCompany } from "@/lib/companies"
import { companyLabel } from "@/lib/companies"

// ── Helpers (shared with search route) ──

function getTodayGoogleFormat(): string {
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

  const id = `gl_pmax_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  launches.push({ id, ...data, launchedAt: new Date().toISOString() });
  writeFileAtomicSync(filePath, JSON.stringify(launches, null, 2));
  return id;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST Handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Trần Search Themes của Google cho mỗi nhóm tài sản. */
const MAX_SEARCH_THEMES = 50;

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
      /** Ảnh đã tải lên trước bằng /api/google/image-asset.
       *  [{ resourceName, fieldType }] — gồm cả LOGO. */
      imageAssets = [],
      /** Search Themes cho nhóm tài sản (tối đa 50). Không truyền thì lấy tạm
       *  danh sách customIntent của audience signal. */
      searchThemes = [],
      conversionActions = [],
      /** Vị trí nhắm, chọn từ /api/google/geo-targets. Rỗng = cả nước. */
      locations = [],
      /** Chiến lược đấu thầu. PMax chỉ dùng được hai chiến lược chuyển đổi. */
      bidding = null,
      /** Video YouTube cho nhóm tài sản.
       *  [{ resourceName }] cho video có sẵn, hoặc [{ input: "<link>" }] để
       *  tạo mới từ link người dùng dán. Không đưa video thì Google TỰ DỰNG
       *  video từ ảnh + chữ — vẫn chạy, nhưng thường rất thô. */
      videoAssets = [],
      /** Sitelink CÓ SẴN, chọn từ /api/google/assets/library. PMax gắn ở CẤP
       *  CAMPAIGN — đã đo: nhóm tài sản TỪ CHỐI field_type SITELINK
       *  ("The error code is not in this version"). */
      sitelinkAssets = [],
      /** `true` = bật chạy ngay sau khi tạo xong. Mặc định `false` (PAUSED). */
      launchActive = false,
      /** PRESENCE (chỉ người trong vùng) hay PRESENCE_OR_INTEREST. Mặc định PRESENCE. */
      geoTargetType = DEFAULT_GEO_TARGET_TYPE,
      /** Đợt 7b — mã sản phẩm + các dòng Sổ kinh nghiệm dùng cho lượt này (chỉ để ghi sổ). */
      productKey = "",
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

    const pmax = creative.pmax;
    if (!pmax?.headlines || !pmax?.descriptions) {
      return NextResponse.json(
        { success: false, error: "Creative thiếu PMax asset data" },
        { status: 400 }
      );
    }

    // Preflight validation with creative data
    const preflight = runPreflightGooglePMax({
      company, googleCreativeId, dailyBudgetVnd, campaignName, pmax,
      imageFieldTypes: (imageAssets as Array<{ fieldType?: string }>).map((i) => i.fieldType ?? "").filter(Boolean),
    });
    if (preflight.status === "blocked") {
      return NextResponse.json(
        { success: false, error: `Preflight failed: ${preflight.errors[0]?.message ?? "validation error"}`, preflight, log: preflightToLog(preflight) },
        { status: 422 },
      );
    }

    // ── Resolve product info ──
    const catalog = catalogFor(company); // Đợt 21 A3: hồ sơ doanh nghiệp (MBC/MBI chưa lưu = catalog cũ)
    const product = catalog[creative.productId];
    // Như launch/search: không thay ngầm bằng trang chủ.
    const finalUrl = product
      ? (product.finalUrls[company] ?? product.finalUrls[product.company] ?? "")
      : (pmax.finalUrl ?? "https://www.matbao.net/");

    // ── Trang đích PHẢI mở được ─────────────────────────────────────────────
    // Cùng lý do với launch/search: Google từ chối bằng DESTINATION_NOT_WORKING
    // (loại PROHIBITED) mà không nhắc gì tới URL trong lời từ chối.
    const urlCheck = await checkFinalUrl(finalUrl);
    if (!urlCheck.ok) {
      return NextResponse.json({
        success: false,
        error: `Trang đích không dùng được: ${urlCheck.problem}`,
        finalUrlCheck: urlCheck,
        rollback: "Chưa tạo gì trên tài khoản Google — dừng trước bước đầu tiên.",
      }, { status: 422 });
    }

    // ── Google Ads Customer ──
    customer = getGoogleAdsCustomer(company);
    const customerId = GOOGLE_CUSTOMER_IDS[company];
    const budgetMicros = dailyBudgetVnd * 1_000_000;

    const pmaxBidding: BiddingConfig = bidding ?? { strategy: "MAXIMIZE_CONVERSION_VALUE" };
    const pmaxCheck = checkBidding(pmaxBidding, "PMAX", { dailyBudgetVnd });
    if (pmaxCheck.errors.length > 0) {
      return NextResponse.json(
        { success: false, error: `Cấu hình đấu thầu không hợp lệ: ${pmaxCheck.errors.join(" ")}` },
        { status: 422 },
      );
    }
    const pmaxBuilt = buildBiddingResource(pmaxBidding);

    // ═══════════════════════════════════════════
    // PHASE 1: Campaign Budget + PMax Campaign
    // ═══════════════════════════════════════════

    const budgetTempId = "-1";
    const campaignTempId = "-2";
    const budgetRN = ResourceNames.campaignBudget(customerId, budgetTempId);
    const campaignRN = ResourceNames.campaign(customerId, campaignTempId);
    /** Id tạm cho asset tên thương hiệu — phải tạo CÙNG lệnh với campaign, vì
     *  Brand Guidelines kiểm ngay lúc tạo campaign chứ không kiểm sau. */
    const bizNameAssetRN = ResourceNames.asset(customerId, "-3");

    // Tên thương hiệu và logo vuông — Brand Guidelines ĐÒI cả hai ở cấp campaign.
    const brandName: string = pmax.businessName ?? (brandOverride(company)?.brandName ?? (company === "MBI" ? "Mắt Bão Invoice" : company === "MBC" ? "Mắt Bão" : companyLabel(company)));

    // DÙNG LẠI asset tên thương hiệu nếu tài khoản đã có. Tạo mới mỗi lần
    // launch sẽ nhồi thư viện tài sản đầy những bản "Mắt Bão" giống hệt nhau,
    // và mỗi lần launch hỏng lại để lại thêm một bản mồ côi.
    let existingBizNameAsset: string | null = null;
    try {
      const found = (await customer.query(`
        SELECT asset.resource_name, asset.text_asset.text
        FROM asset
        WHERE asset.type = 'TEXT' AND asset.text_asset.text = '${brandName.replace(/'/g, "")}'
        LIMIT 1
      `)) as unknown as Array<{ asset?: { resource_name?: string } }>;
      existingBizNameAsset = found[0]?.asset?.resource_name ?? null;
    } catch {
      // Tra hỏng thì tạo mới — không đáng để cả lượt launch chết vì một phép
      // tối ưu dọn rác.
      existingBizNameAsset = null;
    }
    // Logo vuông lấy từ ảnh người dùng đã chọn. Google chỉ nhận LOGO vuông 1:1
    // ở đây — ảnh ngang/dọc không thay thế được.
    const squareLogo = (imageAssets as Array<{ resourceName: string; fieldType: string }>)
      .find((i) => i.fieldType === "LOGO");
    if (!squareLogo) {
      // Chặn TRƯỚC khi tạo gì. Không có logo vuông thì Google sẽ từ chối lệnh
      // tạo campaign — báo bằng tiếng Việt kèm việc cần làm, thay vì đẩy người
      // dùng vào câu lỗi tiếng Anh về "Brand Guidelines".
      return NextResponse.json(
        {
          success: false,
          error: "Performance Max bắt buộc có LOGO VUÔNG 1:1. Lên phần chọn ảnh, đổi loại sang \"Logo\" rồi tải lên hoặc chọn một logo vuông có sẵn trong tài khoản.",
          needsSquareLogo: true,
        },
        { status: 422 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phase1Ops: any[] = [
      {
        entity: "campaign_budget",
        operation: "create",
        resource: {
          resource_name: budgetRN,
          name: `Budget PMax — ${campaignName}`,
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
          // Chỉ định RÕ campaign này tối ưu cho hành động chuyển đổi nào.
          // PMax tự do hơn Search NHIỀU — nó tự phân bổ qua Search, Display,
          // YouTube, Gmail, Discover. Không nói rõ đuổi theo cái gì thì Google
          // tự quyết tiền chảy về đâu trên sáu kênh cùng lúc.
          // KHÔNG dùng `selective_optimization` ở đây: trường đó CHỈ áp dụng
          // cho chiến dịch Ứng dụng, và Google trả "The error code is not in
          // this version" cho Search/PMax. Mục tiêu chuyển đổi được chốt SAU
          // khi tạo, qua campaign_conversion_goal — xem lib/google-conversion-goals.
          resource_name: campaignRN,
          name: campaignName,
          status: "PAUSED",
          advertising_channel_type: "PERFORMANCE_MAX",
          // ── Brand Guidelines ─────────────────────────────────────────────
          // ĐÂY LÀ LỖI LÀM CẢ ĐƯỜNG TẠO PMAX HỎNG 100% SỐ LẦN.
          // Google bật Brand Guidelines mặc định cho PMax, và khi bật thì nó
          // ĐÒI tên thương hiệu + logo vuông phải được gắn ở CẤP CAMPAIGN
          // (campaign_asset). Route này chỉ gắn chúng vào NHÓM TÀI SẢN
          // (asset_group_asset) — chỗ khác hẳn. Nên Google từ chối ngay ở bước
          // tạo campaign:
          //   "Brand Guidelines is enabled. Performance Max campaigns with
          //    Brand Guidelines enabled require at least one business name /
          //    square logo to be linked as a CampaignAsset."
          //
          // Đo 18/09/2026: cả 28 campaign PMax trong tài khoản MBC đều có
          // brand_guidelines_enabled = true.
          //
          // GIỮ BẬT chứ không tắt, dù tắt cũng qua được. Lý do: đã đo,
          // `brand_guidelines_enabled` KHÔNG sửa được sau khi tạo
          // ("cannot be modified by 'UPDATE' operation"). Tắt là tạo ra một
          // campaign lệch hẳn với 28 cái còn lại và VĨNH VIỄN không vá được.
          brand_guidelines_enabled: true,
          // PMax TRƯỚC ĐÂY không đặt trường này nên rơi về mặc định của Google
          // là PRESENCE_OR_INTEREST — kéo cả người ở nước ngoài quan tâm tới
          // Việt Nam. Đã kiểm bằng validate_only trên campaign PMax thật của
          // cả MBC lẫn MBI: Google CHẤP NHẬN PRESENCE cho PMax.
          geo_target_type_setting: {
            positive_geo_target_type: geoTargetType,
          },
          campaign_budget: budgetRN,
          start_date: startDate
            ? startDate.replace(/-/g, "")
            : getTodayGoogleFormat(),
          // Bidding — người dùng chọn. Bản cũ luôn maximize_conversion_value
          // không tROAS. PMax chỉ nhận hai chiến lược chuyển đổi: đã đo, nó
          // TỪ CHỐI manual_cpc ("operation is not allowed for the given context").
          ...pmaxBuilt.resource,
        },
      },
      // ── Tài sản Brand Guidelines, gắn Ở CẤP CAMPAIGN ────────────────────
      // Phải nằm CÙNG lệnh mutate với campaign: Google kiểm điều kiện này
      // ngay lúc tạo campaign, nên gắn sau là muộn. Id tạm âm cho phép tham
      // chiếu campaign chưa tồn tại trong cùng một lệnh.
      ...(existingBizNameAsset ? [] : [{
        entity: "asset",
        operation: "create",
        resource: {
          resource_name: bizNameAssetRN,
          name: `${brandName} — tên thương hiệu — ${Date.now()}`,
          text_asset: { text: brandName },
        },
      }]),
      {
        entity: "campaign_asset",
        operation: "create",
        resource: {
          campaign: campaignRN,
          asset: existingBizNameAsset ?? bizNameAssetRN,
          field_type: "BUSINESS_NAME",
        },
      },
      {
        entity: "campaign_asset",
        operation: "create",
        resource: { campaign: campaignRN, asset: squareLogo.resourceName, field_type: "LOGO" },
      },
    ];

    const phase1Result = await customer.mutateResources(phase1Ops) as any;
    const campaignResourceName =
      phase1Result.mutate_operation_responses?.[1]?.campaign_result?.resource_name
      ?? phase1Result[1]?.campaign?.resource_name
      ?? `customers/${customerId}/campaigns/unknown`;

    createdForRollback.unshift({ entity: "campaign", resourceName: campaignResourceName });
    const budgetResourceName: string = phase1Result.mutate_operation_responses?.[0]?.campaign_budget_result?.resource_name
      ?? phase1Result[0]?.campaign_budget?.resource_name
      ?? "";
    // Budget xoá SAU CÙNG: còn campaign tham chiếu thì Google từ chối xoá.
    if (budgetResourceName) createdForRollback.push({ entity: "campaign_budget", resourceName: budgetResourceName });
    console.log("[launch/pmax] Phase 1 done — Campaign:", campaignResourceName);

    // ═══════════════════════════════════════════
    // PHASE 2: Vị trí (VN) + Ngôn ngữ (Việt + Anh)
    // ═══════════════════════════════════════════
    // Hằng số lấy từ lib/google-targeting. TRƯỚC BẢN NÀY tệp này gõ
    // `languageConstants/1020` — đó là tiếng BULGARIA, không phải tiếng Việt
    // (1040). Mọi campaign PMax tool từng tạo đều nhắm sai ngôn ngữ.

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
      console.log("[launch/pmax] Phase 2 done — Geo + Language");
    } catch (e) {
      // Không nuốt im lặng: campaign không có tiêu chí vị trí được Google phục
      // vụ ra toàn thế giới, mà màn hình vẫn báo tạo thành công.
      targetingError = googleAdsErrorMessage(e);
      console.error("[launch/pmax] Phase 2 HỎNG (geo/language):", targetingError);
    }

    // ═══════════════════════════════════════════
    // PHASE 3: Asset Group
    // ═══════════════════════════════════════════

    const agTempId = "-10";
    const assetGroupRN = ResourceNames.assetGroup(customerId, agTempId);

    const agResult = await customer.mutateResources([
      {
        entity: "asset_group",
        operation: "create",
        resource: {
          resource_name: assetGroupRN,
          campaign: campaignResourceName,
          name: pmax.assetGroupName ?? `${campaignName} — Asset Group`,
          final_urls: [finalUrl],
          status: "ENABLED",
        },
      },
    ]) as any;

    const assetGroupResourceName =
      agResult.mutate_operation_responses?.[0]?.asset_group_result?.resource_name
      ?? agResult[0]?.asset_group?.resource_name
      ?? assetGroupRN;

    createdForRollback.unshift({ entity: "asset_group", resourceName: assetGroupResourceName });
    console.log("[launch/pmax] Phase 3 done — Asset Group:", assetGroupResourceName);

    // ═══════════════════════════════════════════
    // PHASE 4: Create Text Assets + Link to Asset Group
    // ═══════════════════════════════════════════
    // PMax requires: Headlines (5), Long Headlines (5), Descriptions (5), Business Name (1)
    // Each asset must be created first, then linked to the asset group

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assetOps: any[] = [];
    const assetLinkOps: { fieldType: string; tempId: string }[] = [];

    let tempCounter = -100;

    // Helper: queue asset + link creation
    function queueTextAsset(text: string, fieldType: string) {
      const tid = String(tempCounter--);
      const assetRN = ResourceNames.asset(customerId, tid);

      assetOps.push({
        entity: "asset",
        operation: "create",
        resource: {
          resource_name: assetRN,
          text_asset: { text },
        },
      });

      assetLinkOps.push({ fieldType, tempId: assetRN });
    }

    // Dữ liệu lưu là mảng OBJECT {text, charCount, isValid}, KHÔNG phải mảng
    // chuỗi — ép `as string[]` rồi đem thẳng đi là gửi object vào text_asset.
    // normalizeAdTexts dùng CHUNG với preflight để phép kiểm và lệnh thật
    // không thể kiểm một đằng gửi một nẻo (đúng lỗi path2/bidding trước đây).
    const nH  = normalizeAdTexts(pmax.headlines,     GOOGLE_PMAX_LIMITS.headline,     GOOGLE_PMAX_MAX.headline);
    const nLH = normalizeAdTexts(pmax.longHeadlines, GOOGLE_PMAX_LIMITS.longHeadline, GOOGLE_PMAX_MAX.longHeadline);
    const nD  = normalizeAdTexts(pmax.descriptions,  GOOGLE_PMAX_LIMITS.description,  GOOGLE_PMAX_MAX.description);

    // Headlines — Google cho tới 15. Bản cũ cắt còn 5, vứt 10 cái đã sinh ra.
    const headlines = nH.kept;
    for (const h of headlines) queueTextAsset(h, "HEADLINE");

    const longHeadlines = nLH.kept;
    for (const lh of longHeadlines) queueTextAsset(lh, "LONG_HEADLINE");

    const descriptions = nD.kept;
    for (const d of descriptions) queueTextAsset(d, "DESCRIPTION");

    // Bỏ dòng nào thì NÓI RA trong phản hồi, đừng để người dùng đếm trên màn
    // hình 5 mô tả rồi thấy Google Ads chỉ có 4 mà không hiểu vì sao.
    const droppedTexts = [
      ...nH.tooLong.map(t => `Headline vượt ${t.length}/${t.limit} ký tự: "${t.text}"`),
      ...nLH.tooLong.map(t => `Long headline vượt ${t.length}/${t.limit} ký tự: "${t.text}"`),
      ...nD.tooLong.map(t => `Description vượt ${t.length}/${t.limit} ký tự: "${t.text}"`),
      ...nH.overflow.map(t => `Headline vượt quá ${GOOGLE_PMAX_MAX.headline} dòng tối đa: "${t}"`),
      ...nLH.overflow.map(t => `Long headline vượt quá ${GOOGLE_PMAX_MAX.longHeadline} dòng tối đa: "${t}"`),
      ...nD.overflow.map(t => `Description vượt quá ${GOOGLE_PMAX_MAX.description} dòng tối đa: "${t}"`),
    ];

    // Business Name (1)
    const bizName = pmax.businessName ?? (brandOverride(company)?.brandName ?? (company === "MBI" ? "Mắt Bão Invoice" : company === "MBC" ? "Mắt Bão" : companyLabel(company)));
    queueTextAsset(bizName, "BUSINESS_NAME");

    // Create all text assets in one batch
    if (assetOps.length > 0) {
      const assetResults = await customer.mutateResources(assetOps) as any;

      // Now link each asset to the asset group
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const linkOps: any[] = [];

      for (let i = 0; i < assetLinkOps.length; i++) {
        const { fieldType } = assetLinkOps[i];
        // Get the real resource name from the result
        const assetResourceName =
          assetResults.mutate_operation_responses?.[i]?.asset_result?.resource_name
          ?? assetResults[i]?.asset?.resource_name
          ?? assetLinkOps[i].tempId;

        linkOps.push({
          entity: "asset_group_asset",
          operation: "create",
          resource: {
            asset_group: assetGroupResourceName,
            asset: assetResourceName,
            field_type: fieldType,
          },
        });
      }

      await customer.mutateResources(linkOps);
      console.log(`[launch/pmax] Phase 4 done — ${assetOps.length} assets created + linked`);
    }

    // ── Gắn ẢNH + LOGO vào nhóm tài sản ────────────────────────────────────
    // Đây là phần QUYẾT ĐỊNH campaign có chạy được hay không. Google đòi nhóm
    // tài sản PMax có logo + ảnh ngang + ảnh vuông mới đủ điều kiện phục vụ.
    // Trước bản này, launch/pmax chỉ tạo asset CHỮ — campaign tạo ra không bao
    // giờ hiển thị được lượt nào, và Google không báo lỗi, nó chỉ lặng lẽ
    // không phục vụ.
    //
    // Ảnh hỏng KHÔNG kéo sập cả lượt launch (giống Search): ném lỗi ở đây sẽ
    // kích rollback xoá campaign đã tạo đúng. Ghi lại rồi đi tiếp.
    let imageAssetNote: string | null = null;
    const linkedImageFieldTypes: string[] = [];
    if (Array.isArray(imageAssets) && imageAssets.length > 0) {
      try {
        await customer.mutateResources(
          (imageAssets as Array<{ resourceName: string; fieldType: string }>).map((img) => ({
            entity: "asset_group_asset",
            operation: "create",
            resource: {
              asset_group: assetGroupResourceName,
              asset: img.resourceName,
              field_type: img.fieldType,
            },
          })),
        );
        linkedImageFieldTypes.push(...(imageAssets as Array<{ fieldType: string }>).map((i) => i.fieldType));
        console.log("[launch/pmax] Đã gắn", imageAssets.length, "ảnh/logo vào nhóm tài sản");
      } catch (imgErr) {
        // describeGoogleAdsError() trả về OBJECT, không phải chuỗi — nhét
        // thẳng vào template string in ra "[object Object]" (cùng lỗi đã sửa
        // ở launch/search/route.ts).
        imageAssetNote = `Nhóm tài sản đã tạo nhưng KHÔNG gắn được ảnh: ${describeGoogleAdsError(imgErr).message}. Vào Google Ads gắn tay.`;
        console.error("[launch/pmax] Gắn ảnh hỏng:", imageAssetNote);
      }
    }

    // ── Video YouTube ──────────────────────────────────────────────────────
    // Cùng nguyên tắc với ảnh: KHÔNG cho hỏng cả lượt launch. Ném lỗi ở đây sẽ
    // kích rollback xoá sạch campaign đã tạo đúng, chỉ vì một cái link.
    let videoNote: string | null = null;
    let videosLinked = 0;
    if (Array.isArray(videoAssets) && videoAssets.length > 0) {
      const vPlan = planVideos(videoAssets as Array<{ resourceName?: string; youtubeId?: string; input?: string }>);
      const notes: string[] = [];
      const toLink: string[] = [...vPlan.existing];

      // Tạo asset cho các link dán mới
      if (vPlan.newYoutubeIds.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res: any = await customer.mutateResources(
            vPlan.newYoutubeIds.map((id) => ({
              entity: "asset",
              operation: "create",
              resource: {
                name: `Video ${id} — ${Date.now()}`,
                type: "YOUTUBE_VIDEO",
                youtube_video_asset: { youtube_video_id: id },
              },
            })),
          );
          for (let i = 0; i < vPlan.newYoutubeIds.length; i++) {
            const rn = res?.mutate_operation_responses?.[i]?.asset_result?.resource_name
              ?? res?.[i]?.asset?.resource_name;
            if (rn) toLink.push(rn);
          }
        } catch (vErr) {
          // Google trả đúng một chữ "Too long." cho mã sai — vô nghĩa với
          // người dùng, nên kèm lý do thật.
          notes.push(`Không tạo được ${vPlan.newYoutubeIds.length} video từ link: ${describeGoogleAdsError(vErr).message} (Google thường trả "Too long." khi mã video sai).`);
        }
      }

      if (toLink.length > 0) {
        try {
          await customer.mutateResources(
            toLink.map((rn) => ({
              entity: "asset_group_asset",
              operation: "create",
              resource: { asset_group: assetGroupResourceName, asset: rn, field_type: "YOUTUBE_VIDEO" },
            })),
          );
          videosLinked = toLink.length;
          console.log("[launch/pmax] Đã gắn", videosLinked, "video vào nhóm tài sản");
        } catch (vErr) {
          notes.push(`KHÔNG gắn được ${toLink.length} video: ${describeGoogleAdsError(vErr).message}`);
        }
      }

      for (const sk of vPlan.skipped) notes.push(`Bỏ qua "${sk.input}": ${sk.reason}`);
      if (notes.length > 0) videoNote = notes.join(" ");
    }

    // Kiểm đủ điều kiện phục vụ. Google KHÔNG chặn lúc tạo — nó chỉ không
    // phục vụ. Không tự kiểm thì người dùng tưởng đã xong.
    const completeness = checkPMaxImageCompleteness(linkedImageFieldTypes);

    // ═══════════════════════════════════════════
    // PHASE 5: Audience Signals (Custom Intent)
    // ═══════════════════════════════════════════

    const audienceSignals = pmax.audienceSignals;
    let audienceSignalCreated = false;

    if (audienceSignals?.customIntent?.length > 0) {
      try {
        // Create Custom Audience with search intent terms
        const caTempId = String(tempCounter--);
        const customAudienceRN = ResourceNames.customAudience(customerId, caTempId);

        const caResult = await customer.mutateResources([
          {
            entity: "custom_audience",
            operation: "create",
            resource: {
              resource_name: customAudienceRN,
              name: `${campaignName} — Custom Intent`,
              type: "SEARCH",
              description: `Auto-generated for PMax campaign "${campaignName}"`,
              members: (audienceSignals.customIntent as string[]).map((term: string) => ({
                member_type: "KEYWORD",
                keyword: term,
              })),
            },
          },
        ]) as any;

        const customAudienceResourceName =
          caResult.mutate_operation_responses?.[0]?.audience_result?.resource_name
          ?? caResult[0]?.audience?.resource_name
          ?? customAudienceRN;

        // Link audience signal to asset group
        await customer.mutateResources([
          {
            entity: "asset_group_signal",
            operation: "create",
            resource: {
              asset_group: assetGroupResourceName,
              audience: {
                audiences: [{ audience: customAudienceResourceName }],
              },
            },
          },
        ]);

        audienceSignalCreated = true;
        console.log("[launch/pmax] Phase 5 done — Audience signal linked");
      } catch (e) {
        console.warn("[launch/pmax] Phase 5 warning (audience signal):", e);
        // Non-fatal — PMax can run without audience signals
      }
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
    // PHASE 5b: Search Themes
    // ═══════════════════════════════════════════
    // PMax KHÔNG có từ khoá. Thứ tương đương là Search Themes — tối đa 50 mỗi
    // nhóm tài sản — nói cho Google biết người ta gõ gì để tìm bạn. Trước đây
    // luồng này chỉ tạo Audience Signal rồi bỏ trống hoàn toàn phần Search
    // Themes, tức là bỏ đúng cái đầu vào nhắm chọn chính của PMax và để Google
    // tự mò từ trang đích.
    const themesRaw: string[] = Array.isArray(searchThemes) && searchThemes.length > 0
      ? searchThemes
      : (audienceSignals?.customIntent ?? []);

    // Bỏ trùng không phân biệt hoa thường, cắt đúng trần 50 của Google.
    const seenTheme = new Set<string>();
    const themes: string[] = [];
    for (const t of themesRaw) {
      const text = String(t ?? "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seenTheme.has(key)) continue;
      seenTheme.add(key);
      themes.push(text);
    }
    const themesDropped = Math.max(0, themes.length - MAX_SEARCH_THEMES);
    const themesToSend = themes.slice(0, MAX_SEARCH_THEMES);

    let searchThemesCreated = 0;
    if (themesToSend.length > 0) {
      try {
        await customer.mutateResources(
          themesToSend.map((text) => ({
            entity: "asset_group_signal",
            operation: "create",
            resource: { asset_group: assetGroupResourceName, search_theme: { text } },
          }))
        );
        searchThemesCreated = themesToSend.length;
        console.log("[launch/pmax] Phase 5b done —", searchThemesCreated, "search themes");
      } catch (e) {
        console.warn("[launch/pmax] Phase 5b warning (search themes):", e);
      }
    }

    // ── Sitelink ────────────────────────────────────────────────────────────
    // PMax gắn sitelink Ở CẤP CAMPAIGN, không phải nhóm tài sản — đã đo, nhóm
    // tài sản từ chối field_type này. Trần 20/campaign tính CẢ cái đã có sẵn.
    let sitelinkNote: string | null = null;
    let sitelinksAttached = 0;
    if (Array.isArray(sitelinkAssets) && sitelinkAssets.length > 0) {
      const slPlan = planSitelinkLinks(sitelinkAssets as Array<{ resourceName: string; linkText?: string }>);
      const notes: string[] = [];
      if (slPlan.links.length > 0) {
        try {
          await customer.mutateResources(
            slPlan.links.map((sl) => ({
              entity: "campaign_asset",
              operation: "create",
              resource: { campaign: campaignResourceName, asset: sl.resourceName, field_type: sl.fieldType },
            })),
          );
          sitelinksAttached = slPlan.links.length;
          console.log("[launch/pmax] Đã gắn", sitelinksAttached, "sitelink vào campaign");
        } catch (slErr) {
          notes.push(`KHÔNG gắn được ${slPlan.links.length} sitelink: ${describeGoogleAdsError(slErr).message}`);
        }
      }
      for (const sk of slPlan.skipped) notes.push(`Bỏ qua "${sk.label}": ${sk.reason}`);
      if (slPlan.warning) notes.push(slPlan.warning);
      if (notes.length > 0) sitelinkNote = notes.join(" ");
    }

    // ── BẬT CHẠY ────────────────────────────────────────────────────────────
    // PMax có HAI tầng phải cùng bật: campaign VÀ nhóm tài sản. Route này tạo
    // nhóm tài sản ở ENABLED sẵn, nên bình thường lật campaign là đủ — nhưng
    // KHÔNG dựa vào đó: đo trên campaign thật thấy nhóm tài sản có thể đang
    // PAUSED, và khi đó campaign "đang chạy" mà không phục vụ lượt nào. Đây
    // đúng lỗi đã gặp bên Meta (bật campaign xong báo "đang chạy" trong khi
    // adset/ad vẫn tắt).
    //
    // Chặn cứng như bên Search: nhắm mục tiêu hỏng thì KHÔNG bật.
    let activated = false;
    let activationError: string | null = null;
    let assetGroupsActivated = 0;

    if (launchActive && !targetingApplied) {
      activationError =
        `KHÔNG bật vì chưa đặt được vị trí/ngôn ngữ (${targetingError ?? "lý do không rõ"}). ` +
        `Campaign không có tiêu chí vị trí sẽ được Google phục vụ ra TOÀN THẾ GIỚI — bật lên là đốt ngân sách.`;
      console.error("[launch/pmax] CHẶN bật campaign:", activationError);
    } else if (launchActive) {
      try {
        // Nhóm tài sản TRƯỚC, campaign SAU: bật campaign trước rồi nhóm hỏng
        // giữa chừng sẽ để lại campaign đang chạy mà không phục vụ được.
        const ags = (await customer.query(`
          SELECT campaign.id, asset_group.resource_name, asset_group.status
          FROM asset_group WHERE campaign.id = ${Number(String(campaignResourceName).split("/").pop())}
        `)) as unknown as Array<{ asset_group?: { resource_name?: string; status?: number | string } }>;

        const notEnabled = ags.filter((a) => String(a.asset_group?.status) !== "2" && a.asset_group?.status !== "ENABLED");
        if (notEnabled.length > 0) {
          await customer.mutateResources(notEnabled.map((a) => ({
            entity: "asset_group",
            operation: "update",
            resource: { resource_name: a.asset_group!.resource_name, status: "ENABLED" },
            update_mask: { paths: ["status"] },
          })));
          assetGroupsActivated = notEnabled.length;
        }

        await customer.campaigns.update([{ resource_name: campaignResourceName, status: "ENABLED" }]);
        activated = true;
        console.log("[launch/pmax] Đã BẬT campaign:", campaignResourceName, `(+${assetGroupsActivated} nhóm tài sản)`);
      } catch (actErr) {
        activationError = describeGoogleAdsError(actErr).message;
        console.error("[launch/pmax] Bật campaign hỏng:", activationError);
      }
    }

    // ── Thật sự phục vụ được chưa? ──────────────────────────────────────────
    // Bật xong KHÔNG có nghĩa là chạy. Google cho biết lý do qua
    // `primary_status_reasons` — đo được các giá trị như CAMPAIGN_PAUSED,
    // ASSET_GROUP_PAUSED, ASSET_GROUP_DISAPPROVED. Đọc và nói ra, thay vì để
    // người dùng thấy "đang chạy" rồi vài ngày sau mới phát hiện 0 lượt hiển thị.
    let servingReasons: string[] = [];
    try {
      const rows = (await customer.query(`
        SELECT campaign.id, asset_group.name, asset_group.primary_status,
               asset_group.primary_status_reasons
        FROM asset_group WHERE campaign.id = ${Number(String(campaignResourceName).split("/").pop())}
      `)) as unknown as Array<{ asset_group?: { name?: string; primary_status_reasons?: string[] } }>;
      const seen = new Set<string>();
      for (const r of rows) for (const reason of r.asset_group?.primary_status_reasons ?? []) seen.add(String(reason));
      servingReasons = [...seen];
    } catch {
      // Đọc hỏng thì để rỗng — KHÔNG bịa ra "mọi thứ ổn".
      servingReasons = [];
    }

    const finalStatus = activated ? "ENABLED" : "PAUSED";

    // ═══════════════════════════════════════════
    // SAVE RESULT
    // ═══════════════════════════════════════════

    const launchId = saveLaunch({
      googleCreativeId,
      company,
      campaignName,
      campaignResourceName,
      assetGroupResourceName,
      status: finalStatus,
      type: "PMAX",
      dailyBudget: dailyBudgetVnd,
      productId: creative.productId,
      assetsCreated: {
        headlines: headlines.length,
        longHeadlines: longHeadlines.length,
        descriptions: descriptions.length,
        businessName: 1,
      },
      audienceSignalCreated,
    });

    updateCreativeStatus(googleCreativeId, "LAUNCHED");

    return NextResponse.json({
      success: true,
      launchId,
      campaignResourceName,
      assetGroupResourceName,
      status: finalStatus,
      launchActive: Boolean(launchActive),
      activated,
      activationError,
      assetGroupsActivated,
      servingReasons,
      sitelinkNote,
      sitelinksAttached,
      assetsCreated: {
        headlines: headlines.length,
        longHeadlines: longHeadlines.length,
        descriptions: descriptions.length,
        businessName: 1,
        total: headlines.length + longHeadlines.length + descriptions.length + 1,
      },
      audienceSignalCreated,
      bidding: { strategy: pmaxBidding.strategy, summary: pmaxBuilt.summary },
      videosLinked,
      videoNote,
      brandGuidelines: { enabled: true, brandName, logoLinked: true },
      biddingWarnings: pmaxCheck.warnings,
      // Nhắm mục tiêu PHẢI trả về màn hình — trước đây hỏng chỉ ghi console.warn.
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
      imagesLinked: linkedImageFieldTypes.length,
      imageAssetNote,
      // Đủ điều kiện phục vụ hay chưa — đây là câu duy nhất quyết định campaign
      // có chạy được hay không, nên nó phải nằm ngay trong thông điệp chính chứ
      // không nấp dưới một trường phụ.
      serviceable: completeness.ok,
      missingImageTypes: completeness.missing,
      searchThemesCreated,
      droppedTexts,
      conversionGoalReport,
      // Cắt bớt thì NÓI RA. Im lặng bỏ 12 chủ đề rồi báo thành công là để
      // người dùng tin nhắm chọn rộng hơn thực tế.
      searchThemesDropped: themesDropped,
      message: completeness.ok
        ? "PMax campaign đã tạo ở trạng thái PAUSED, có đủ logo + ảnh ngang + ảnh vuông. Vào Google Ads review rồi bật."
        : `PMax campaign đã tạo ở trạng thái PAUSED nhưng CHƯA ĐỦ ĐIỀU KIỆN PHỤC VỤ — thiếu ${completeness.missing.map(m => m.label).join(", ")}. Google sẽ KHÔNG hiển thị lượt nào cho tới khi bổ sung.`,
      googleAdsUrl: `https://ads.google.com/aw/campaigns?__e=${customerId}`,
      imageGuidance: pmax.imageGuidance,
    });
  } catch (error: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    console.error("[launch/pmax] Error:", err?.message ?? err);

    // Dọn phần đã ghi thật trước khi lỗi — không có bước này thì mỗi lần launch
    // hỏng để lại một PMax campaign PAUSED rỗng + budget mồ côi trên tài khoản.
    let rollbackNote = "";
    try {
      const rb = customer ? await rollbackGoogleLaunch(customer, createdForRollback) : { attempted: false, summary: "" };
      if (rb.attempted) {
        rollbackNote = rb.summary;
        console.warn("[launch/pmax] rollback:", rb.summary);
      }
    } catch (rbErr) {
      rollbackNote = `Không dọn được phần đã tạo dở: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`;
      console.warn("[launch/pmax]", rollbackNote);
    }

    const gInfo = describeGoogleAdsError(error);

    return NextResponse.json(
      {
        success: false,
        error: gInfo.message || err?.message || "PMax launch failed",
        details: gInfo.details.length > 0
          ? gInfo.details
          : (err?.errors ?? err?.response?.data?.error?.details ?? []),
        code: err?.code ?? "PMAX_LAUNCH_FAILED",
        requestId: gInfo.requestId,
        // Chủ đề chính sách + đúng chữ bị gắn cờ — xem chú thích ở launch/search.
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
