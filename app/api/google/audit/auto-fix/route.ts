// ============================================================
// POST /api/google/audit/auto-fix
// Real Google Ads mutations for audit check fixes
// ============================================================
// HAI BƯỚC: gọi lần đầu (không có `confirm`) chỉ TRẢ VỀ BẢN XEM TRƯỚC —
// liệt kê đúng từng thứ sẽ bị đổi. Chỉ khi gọi lại với `confirm: true`
// mới thực sự ghi vào tài khoản. Trước đây một cú bấm "⚡ Auto-Fix" là
// thẳng tay thêm tới 25 từ khoá phủ định hoặc cắt 20% giá thầu của 30 từ
// khoá, không xem trước, không xác nhận, không hoàn tác.

import { enums } from "google-ads-api";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { getGoogleAdsCustomer } from "@/lib/google-ads-client";
import { enumName } from "@/lib/google-ads-enums";
import { checkRecentCampaignMutation, recordCampaignMutation } from "@/lib/mutation-guard";
import { applyDeviceBidModifier } from "@/lib/google-device-bid";
import { AUDIT_GUIDES } from "@/lib/google-audit-guide";

import { googleAdsErrorMessage } from "@/lib/google-ads-error";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client"
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
/** Ngưỡng "đã tiêu đáng kể" cho một search term trong 30 ngày.
 *
 *  micros: 1 đồng = 1.000.000 micros. Bản cũ đặt 200_000_000 và mô tả là
 *  "₫200K" — thực tế đó là ₫200, sai 1.000 lần. Con số ghi trong thông báo
 *  gửi người dùng khi đó KHÔNG khớp với con số thật sự được kiểm. */
const WASTE_THRESHOLD_VND = 200_000;
const WASTE_THRESHOLD_MICROS = WASTE_THRESHOLD_VND * 1_000_000;

/** Trần số dòng cho từng nhánh — khai báo để thông báo nói đúng phần đã xét. */
const CAP_WASTE_TERMS = 100;
const CAP_QS_KEYWORDS = 50;

/** Sàn giá thầu sau khi cắt, tránh cắt xuống mức không còn hiển thị. */
// SỬA ĐƠN VỊ: 1 đồng = 1.000.000 micros, nên ₫1.000 là 1_000_000_000 micros.
// Hằng số cũ ghi `1_000_000 // ₫1.000` thực ra là sàn ₫1 — nghĩa là cái chốt
// "bỏ qua từ khoá vì cắt tiếp sẽ xuống dưới sàn" bên dưới chưa từng chặn được
// gì: giá thầu phải tụt xuống dưới MỘT ĐỒNG mới kích hoạt. Nay chốt đúng
// ₫1.000 như chú thích vẫn luôn hứa.
const MIN_CPC_MICROS = 1_000_000_000; // ₫1.000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GaqlRow = Record<string, any>;

interface PreviewItem {
  label: string;
  detail: string;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền auto-fix" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { company, checkName, checkId, confirm } = body as {
      company: string;
      checkName: string;
      /** Định danh ổn định của tiêu chí. Việc phân nhánh CŨ dựa vào
       *  `checkName.includes("Budget")` — đổi một chữ ở tiêu đề hiển thị là
       *  rơi thẳng xuống nhánh mặc định mà không ai biết. */
      checkId?: string;
      confirm?: boolean;
    };

    if (!company || (!isCompany(company))) {
      return NextResponse.json({ success: false, error: "Invalid company" }, { status: 400 });
    }
    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ success: false, error: "Không có quyền truy cập công ty này" }, { status: 403 });
    }

    const customerId = GOOGLE_CUSTOMER_IDS[company];
    if (!customerId) {
      return NextResponse.json({ success: false, error: friendlyError("Google Ads customer ID not configured") }, { status: 500 });
    }

    const customer = getGoogleAdsCustomer(company);
    const isConfirmed = confirm === true;
    const warnings: string[] = [];

    // ── 1. SEARCH TERM WASTE ──────────────────────────────────
    // Ưu tiên id; giữ so tên làm phương án dự phòng cho client cũ.
    const is = (id: string, ...nameHints: string[]) =>
      checkId ? checkId === id : nameHints.some((h) => checkName.includes(h));

    if (is("search_term_waste", "Search Term Waste")) {
      // `search_term_view.status = 'ADDED'` nghĩa là truy vấn ĐÃ ĐƯỢC thêm
      // làm TỪ KHOÁ đang chạy. Bản cũ lọc đúng nhóm đó rồi thêm chúng vào
      // danh sách PHỦ ĐỊNH — mà phủ định luôn thắng từ khoá dương, nên thao
      // tác "tối ưu" này sẽ TẮT chính những từ khoá mình đang cố ý chạy.
      // Nhóm cần chặn là 'NONE': truy vấn lọt vào nhưng chưa từng được nhắm
      // và cũng chưa bị loại.
      //
      // Điều kiện 0 chuyển đổi cũng phải nằm TRONG GAQL. Bản cũ lấy 25 dòng
      // đắt nhất rồi mới lọc conversion bằng JS: nếu 25 truy vấn đắt nhất đều
      // có chuyển đổi, kết quả là "Không tìm thấy Search Term lãng phí" —
      // trong khi những truy vấn rẻ hơn, 0 chuyển đổi vẫn đang đốt tiền.
      // Lấy campaign bằng `campaign.resource_name`, KHÔNG phải
      // `search_term_view.campaign`: resource search_term_view chỉ có đúng 4
      // trường (ad_group, resource_name, search_term, status) theo danh mục
      // kiểu của SDK. Tên sai khiến GAQL từ chối cả câu → Auto-Fix "Search
      // Term lãng phí" hỏng 100% và trả lỗi 500 cho người bấm.
      const rows = (await customer.query(`
        SELECT
          search_term_view.search_term,
          campaign.resource_name,
          metrics.cost_micros,
          metrics.conversions
        FROM search_term_view
        WHERE search_term_view.status = 'NONE'
          AND metrics.cost_micros > ${WASTE_THRESHOLD_MICROS}
          AND metrics.conversions = 0
          AND segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
        LIMIT ${CAP_WASTE_TERMS}
      `)) as unknown as GaqlRow[];

      if (rows.length === 0) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "nothing-to-do",
          actionTaken: `Không có truy vấn nào chi hơn ${WASTE_THRESHOLD_VND.toLocaleString("vi-VN")}₫ mà không ra chuyển đổi trong 30 ngày (chỉ xét những truy vấn chưa được nhắm và chưa bị chặn). Tài khoản đang lọc tốt.`,
          warnings,
        });
      }

      // Không thêm trùng: đọc phủ định đang có của đúng những campaign này.
      const campaignResources = [...new Set(rows.map((r) => String(r.campaign?.resource_name ?? "")).filter(Boolean))];
      const existingNegatives = new Set<string>();
      try {
        const negRows = (await customer.query(`
          SELECT campaign_criterion.campaign, campaign_criterion.keyword.text
          FROM campaign_criterion
          WHERE campaign_criterion.type = 'KEYWORD'
            AND campaign_criterion.negative = TRUE
            AND campaign.id IN (${campaignResources.map((r) => r.split("/").pop()).filter(Boolean).join(",")})
        `)) as unknown as GaqlRow[];
        for (const n of negRows) {
          const camp = String(n.campaign_criterion?.campaign ?? "");
          const text = String(n.campaign_criterion?.keyword?.text ?? "").toLowerCase().trim();
          if (camp && text) existingNegatives.add(`${camp}||${text}`);
        }
      } catch (e) {
        // Đọc hỏng thì NÓI RA rồi vẫn cho làm — nhưng người dùng phải biết là
        // danh sách xem trước có thể chứa từ đã bị chặn sẵn.
        warnings.push(
          `Không đọc được danh sách phủ định hiện có (${googleAdsErrorMessage(e)}) — bản xem trước có thể chứa từ đã bị chặn từ trước.`
        );
      }

      const toAdd: { campaign: string; text: string; cost: number }[] = [];
      for (const row of rows) {
        const campaign = String(row.campaign?.resource_name ?? "");
        const text = String(row.search_term_view?.search_term ?? "").trim();
        if (!campaign || !text) continue;
        if (existingNegatives.has(`${campaign}||${text.toLowerCase()}`)) continue;
        toAdd.push({ campaign, text, cost: Number(row.metrics?.cost_micros ?? 0) / 1_000_000 });
      }

      if (toAdd.length === 0) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "nothing-to-do",
          actionTaken: `Tìm thấy ${rows.length} truy vấn lãng phí nhưng TẤT CẢ đã nằm trong danh sách phủ định từ trước. Không cần thêm gì.`,
          warnings,
        });
      }

      const campaignCount = new Set(toAdd.map((t) => t.campaign)).size;
      const preview: PreviewItem[] = toAdd.map((t) => ({
        label: `"${t.text}"`,
        detail: `đã tiêu ${Math.round(t.cost).toLocaleString("vi-VN")}₫ / 0 chuyển đổi → chặn dạng PHRASE`,
      }));

      if (!isConfirmed) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "preview",
          actionTaken: `Sẽ thêm ${toAdd.length} từ khoá phủ định (PHRASE) vào ${campaignCount} chiến dịch. Xem danh sách bên dưới rồi xác nhận.`,
          preview,
          truncated: rows.length >= CAP_WASTE_TERMS,
          warnings,
        });
      }

      await customer.campaignCriteria.create(
        toAdd.map((t) => ({
          campaign: t.campaign,
          negative: true,
          keyword: { text: t.text, match_type: "PHRASE" as const },
        }))
      );

      // CỐ Ý không ghi vào lib/mutation-guard: phần đầu file đó nói rõ sổ
      // này chỉ dành cho va chạm ở CẤP CAMPAIGN (hai hệ thống cùng ghi đè một
      // con số ngân sách/giá thầu). Thêm một từ khoá phủ định không va chạm
      // kiểu đó, và nhét vào sẽ bơm nhiễu vào tín hiệu của NBA.

      return NextResponse.json({
        success: true,
        kind: "MUTATION",
        mode: "applied",
        actionTaken: `Đã thêm ${toAdd.length} từ khoá phủ định (PHRASE) vào ${campaignCount} chiến dịch.`,
        preview,
        truncated: rows.length >= CAP_WASTE_TERMS,
        warnings,
      });
    }

    // ── 2. QUALITY SCORE DISTRIBUTION ────────────────────────
    else if (is("quality_score", "Quality Score")) {
      // Sắp theo CHI PHÍ giảm dần: bản cũ không có ORDER BY, nên 30 từ khoá
      // được cắt giá thầu là 30 từ khoá bất kỳ Google trả về trước, chứ không
      // phải 30 từ đang tốn tiền nhất.
      const rows = (await customer.query(`
        SELECT
          ad_group_criterion.resource_name,
          ad_group_criterion.keyword.text,
          ad_group_criterion.cpc_bid_micros,
          ad_group_criterion.quality_info.quality_score,
          campaign.id,
          campaign.name,
          metrics.cost_micros
        FROM keyword_view
        WHERE ad_group_criterion.status = 'ENABLED'
          AND campaign.status = 'ENABLED'
          AND ad_group_criterion.cpc_bid_micros > 0
          AND ad_group_criterion.quality_info.quality_score > 0
          AND ad_group_criterion.quality_info.quality_score <= 3
          AND segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC
        LIMIT ${CAP_QS_KEYWORDS}
      `)) as unknown as GaqlRow[];

      if (rows.length === 0) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "nothing-to-do",
          actionTaken: "Không có từ khoá nào đang bật, có chi phí, và Quality Score ≤ 3. Không cần can thiệp.",
          warnings,
        });
      }

      // Chống bấm lặp: cắt 20% mỗi lần bấm sẽ thành 0,8^n. Bản cũ không có
      // chốt nào — bấm 4 lần là giá thầu còn 41% mà giao diện vẫn báo
      // "đã giảm 20%" mỗi lần.
      const conflictCampaigns = new Set<string>();
      for (const cid of new Set(rows.map((r) => String(r.campaign?.id ?? "")).filter(Boolean))) {
        const recent = checkRecentCampaignMutation(cid, company, "audit_fix");
        if (recent.hasConflict && recent.note) conflictCampaigns.add(recent.note);
      }
      warnings.push(...conflictCampaigns);

      const ops: { resource_name: string; cpc_bid_micros: number }[] = [];
      const preview: PreviewItem[] = [];
      const skipped: string[] = [];
      for (const row of rows) {
        const rn = row.ad_group_criterion?.resource_name as string | undefined;
        const oldBid = Number(row.ad_group_criterion?.cpc_bid_micros ?? 0);
        if (!rn || oldBid <= 0) continue;
        const newBid = Math.round(oldBid * 0.8);
        const text = String(row.ad_group_criterion?.keyword?.text ?? "?");
        if (newBid < MIN_CPC_MICROS) {
          skipped.push(text);
          continue;
        }
        ops.push({ resource_name: rn, cpc_bid_micros: newBid });
        preview.push({
          label: `"${text}"`,
          detail: `QS ${row.ad_group_criterion?.quality_info?.quality_score} · giá thầu ${Math.round(oldBid / 1_000_000).toLocaleString("vi-VN")}₫ → ${Math.round(newBid / 1_000_000).toLocaleString("vi-VN")}₫`,
        });
      }

      if (skipped.length > 0) {
        warnings.push(`Bỏ qua ${skipped.length} từ khoá vì cắt tiếp sẽ xuống dưới sàn ${(MIN_CPC_MICROS / 1_000_000).toLocaleString("vi-VN")}₫ (có thể đã bị cắt ở lần chạy trước): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}`);
      }
      if (ops.length === 0) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "nothing-to-do",
          actionTaken: "Tất cả từ khoá QS thấp đều đã ở gần sàn giá thầu — cắt thêm sẽ mất hiển thị. Nên sửa Ad Relevance / trang đích thay vì hạ giá thầu tiếp.",
          warnings,
        });
      }

      if (!isConfirmed) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "preview",
          actionTaken: `Sẽ giảm 20% Max CPC cho ${ops.length} từ khoá có Quality Score ≤ 3 (xét ${rows.length} từ khoá tốn tiền nhất).`,
          preview,
          truncated: rows.length >= CAP_QS_KEYWORDS,
          warnings,
        });
      }

      // Giá thầu ở đây là cấp TỪ KHOÁ, không phải cấp campaign — ngoài phạm vi
      // của lib/mutation-guard đúng như phần đầu file đó mô tả. Chốt chống bấm
      // lặp của nhánh này là sàn MIN_CPC_MICROS ở trên, không phải sổ lịch sử.
      await customer.adGroupCriteria.update(ops);

      return NextResponse.json({
        success: true,
        kind: "MUTATION",
        mode: "applied",
        actionTaken: `Đã giảm 20% Max CPC cho ${ops.length} từ khoá có Quality Score ≤ 3.`,
        preview,
        truncated: rows.length >= CAP_QS_KEYWORDS,
        warnings,
      });
    }

    // ── 3. DEVICE BID ADJUSTMENTS ─────────────────────────────
    // Chỉ campaign Manual CPC mới đặt hệ số thiết bị — Smart Bidding tự quản
    // lý theo thiết bị và Google khuyến nghị không đặt hệ số tay ở đó.
    // Hệ số suy từ tỷ lệ CPA-mobile/CPA-desktop thật của từng campaign.
    //
    // Việc GHI hệ số đi qua lib/google-device-bid.ts. Bản cũ ghi vào
    // `campaign.device_bid_modifiers` — một trường KHÔNG TỒN TẠI trên
    // resource Campaign; protobuf lặng lẽ bỏ trường lạ, field mask thành
    // rỗng, và Google từ chối lệnh. Tức là nhánh này CHƯA BAO GIỜ chạy được.
    else if (is("device_bid", "Device Bid")) {
      const rows = (await customer.query(`
        SELECT campaign.resource_name, campaign.id, campaign.name, campaign.bidding_strategy_type,
               segments.device, metrics.cost_micros, metrics.conversions
        FROM campaign
        WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS
          AND segments.device IN ('MOBILE', 'DESKTOP')
      `)) as unknown as GaqlRow[];

      interface DeviceAgg { id: string; name: string; cost: Record<string, number>; conv: Record<string, number> }
      const byCampaign = new Map<string, DeviceAgg>();
      for (const row of rows) {
        const biddingType = enumName(enums.BiddingStrategyType, row.campaign?.bidding_strategy_type);
        if (biddingType !== "MANUAL_CPC") continue;
        const resourceName: string = row.campaign?.resource_name ?? "";
        if (!resourceName) continue;
        const device = enumName(enums.Device, row.segments?.device);
        const entry: DeviceAgg = byCampaign.get(resourceName) ?? {
          id: String(row.campaign?.id ?? ""),
          name: row.campaign?.name ?? "",
          cost: {},
          conv: {},
        };
        entry.cost[device] = (entry.cost[device] ?? 0) + Number(row.metrics?.cost_micros ?? 0);
        entry.conv[device] = (entry.conv[device] ?? 0) + Number(row.metrics?.conversions ?? 0);
        byCampaign.set(resourceName, entry);
      }

      const planned: { id: string; name: string; modifier: number; ratio: number }[] = [];
      for (const [, { id, name, cost, conv }] of byCampaign) {
        const cpaMobile = (conv["MOBILE"] ?? 0) > 0 ? cost["MOBILE"] / conv["MOBILE"] : 0;
        const cpaDesktop = (conv["DESKTOP"] ?? 0) > 0 ? cost["DESKTOP"] / conv["DESKTOP"] : 0;
        if (cpaMobile === 0 || cpaDesktop === 0) continue;
        const ratio = cpaMobile / cpaDesktop;
        if (ratio <= 1) continue;

        const recent = checkRecentCampaignMutation(id, company, "audit_fix");
        if (recent.hasConflict && recent.note) warnings.push(`"${name}": ${recent.note}`);

        // Giảm dần tuyến tính, cố ý thận trọng (Google không công bố công
        // thức nào để bám theo): sàn -50%, ratio ≤ 1 thì không đụng.
        const modifier = Math.round(Math.max(0.5, Math.min(1, 1 - (ratio - 1) * 0.3)) * 100) / 100;
        planned.push({ id, name, modifier, ratio });
      }

      if (planned.length === 0) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "nothing-to-do",
          actionTaken: "Không có campaign Manual CPC nào cần điều chỉnh hệ số thiết bị (CPA Mobile/Desktop đã cân bằng, thiếu dữ liệu chuyển đổi, hoặc các campaign đang dùng Smart Bidding tự quản lý theo thiết bị).",
          warnings,
        });
      }

      const preview: PreviewItem[] = planned.map((p) => ({
        label: p.name || p.id,
        detail: `CPA Mobile gấp ${p.ratio.toFixed(1)}× Desktop → hệ số giá thầu Mobile ${Math.round((p.modifier - 1) * 100)}%`,
      }));

      if (!isConfirmed) {
        return NextResponse.json({
          success: true,
          kind: "MUTATION",
          mode: "preview",
          actionTaken: `Sẽ đặt hệ số giá thầu Mobile cho ${planned.length} campaign Manual CPC.`,
          preview,
          truncated: false,
          warnings,
        });
      }

      const okNames: string[] = [];
      const failNotes: string[] = [];
      for (const p of planned) {
        const res = await applyDeviceBidModifier(customer, {
          customerId,
          campaignId: p.id,
          device: "MOBILE",
          bidModifier: p.modifier,
        });
        if (!res.applied) {
          failNotes.push(`"${p.name}": ${res.error}`);
          continue;
        }
        okNames.push(p.name);
        recordCampaignMutation({
          source: { type: "audit_fix", auditDomain: "device_bid" },
          event: "adset.bid_strategy_change",
          company,
          campaignId: p.id,
          campaignName: p.name,
          rationale: "Google Audit Auto-Fix: CPA Mobile cao hơn Desktop, giảm bid Mobile theo tỷ lệ thực tế.",
        });
      }

      // Hỏng thì nói hỏng. Không gộp thất bại vào một câu báo thành công.
      if (okNames.length === 0) {
        return NextResponse.json(
          { success: false, error: `Không đặt được hệ số thiết bị cho campaign nào. ${failNotes.join(" · ")}` },
          { status: 502 }
        );
      }
      if (failNotes.length > 0) warnings.push(`Thất bại ở ${failNotes.length} campaign: ${failNotes.join(" · ")}`);

      return NextResponse.json({
        success: true,
        kind: "MUTATION",
        mode: "applied",
        actionTaken: `Đã đặt hệ số giá thầu Mobile cho ${okNames.length}/${planned.length} campaign Manual CPC. CPA Mobile dự kiến đổi sau 7–14 ngày.`,
        preview,
        truncated: false,
        warnings,
      });
    }

    // ── CÁC TIÊU CHÍ CHỈ CÓ LỜI KHUYÊN ───────────────────────
    // Những nhánh dưới đây KHÔNG đụng vào tài khoản. Bản cũ vẫn trả
    // `success: true, message: "Thao tác thành công"` và giao diện vẽ chúng
    // trong khung xanh kèm dấu ✅ — nghĩa là bấm "Auto-Fix" trên 11/14 tiêu
    // chí sẽ hiện ra một thông báo thành công cho việc chưa từng xảy ra.
    // `kind: "ADVISORY"` để giao diện vẽ đúng bản chất: hướng dẫn, không phải
    // hành động.
    const guide = checkId ? AUDIT_GUIDES[checkId] : undefined;
    const advisory = (text: string) =>
      NextResponse.json({
        success: true,
        kind: "ADVISORY",
        mode: "advice",
        actionTaken: text,
        guide: guide ?? null,
        warnings,
      });

    if (is("budget_utilization", "Budget")) {
      const rows = (await customer.query(`
        SELECT campaign.name, metrics.cost_micros, campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS
      `)) as unknown as GaqlRow[];

      const underSpent = rows.filter((row) => {
        const budget30d = Number(row.campaign_budget?.amount_micros ?? 0) * 30;
        const spend = Number(row.metrics?.cost_micros ?? 0);
        return budget30d > 0 && spend < budget30d * 0.3;
      });

      if (underSpent.length === 0) {
        return advisory("Tất cả chiến dịch đang tiêu trên 30% ngân sách định mức. Không cần can thiệp.");
      }
      const names = underSpent.slice(0, 3).map((r) => String(r.campaign?.name ?? "?")).join(", ");
      return advisory(
        `Phát hiện ${underSpent.length} chiến dịch chi dưới 30% ngân sách (ví dụ: ${names}). Đây là CHẨN ĐOÁN, chưa thay đổi gì.`
      );
    }

    // Các tiêu chí còn lại: không mutate, chỉ đưa hướng dẫn.
    if (guide) {
      return advisory(`"${checkName}" cần xử lý thủ công trong Google Ads. Không có thay đổi nào được thực hiện — các bước cụ thể ở dưới.`);
    }

    return advisory(
      `Tiêu chí "${checkName}" chưa có bước sửa tự động và cũng chưa có hướng dẫn soạn sẵn. Cần xử lý thủ công trong Google Ads. Không có thay đổi nào được thực hiện.`
    );
  } catch (error: unknown) {
    const msg = googleAdsErrorMessage(error);
    console.error("[auto-fix] Error:", msg);
    return NextResponse.json({ success: false, error: friendlyError(msg) }, { status: 500 });
  }
}
