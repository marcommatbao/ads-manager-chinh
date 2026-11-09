// ============================================================
// POST /api/google/launch/selftest-rollback?confirm=yes&company=MBC
// (Audit 30/09: trước là GET — trang lạ chuyển hướng super_admin đang đăng nhập tới URL này là tạo/xoá campaign
// thật, vì cookie SameSite=Lax vẫn đi theo điều hướng GET. Nay POST: middleware chặn khác nguồn, link không kích hoạt được.)
//
// Chứng minh nhánh dọn dẹp (lib/google-launch-rollback.ts) chạy THẬT, thay vì
// tin vào lời tự nhận "đã thêm rollback".
//
// Vì sao cần một đường riêng: nhánh đó chỉ chạy khi launch hỏng GIỮA CHỪNG —
// tức phải tạo được campaign rồi mới làm nó hỏng. Không có cách nào bấm ra tình
// huống ấy từ giao diện mà không chế một creative sai cố ý rồi cầu cho Google
// từ chối đúng pha mình muốn.
//
// Nó làm ba việc, trên tài khoản thật:
//   1. Tạo campaign budget + campaign PAUSED tên "SELFTEST-ROLLBACK-<ts>"
//   2. Mô phỏng pha sau hỏng
//   3. Gọi CHÍNH hàm rollback mà hai route launch dùng, rồi ĐỌC LẠI từ Google
//      để xác nhận campaign đã ở trạng thái REMOVED
//
// Đọc lại là phần quan trọng nhất: "gọi lệnh xoá mà không báo lỗi" khác hẳn "đã
// xoá thật" — đúng bài học của RSA-EDIT-2.
//
// An toàn: chỉ super_admin, bắt buộc ?confirm=yes, campaign luôn PAUSED nên
// không tiêu một đồng nào, và tự dọn ngay trong cùng lượt gọi (kể cả khi chính
// phép thử hỏng giữa chừng).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { ResourceNames, enums } from "google-ads-api";
import { enumName } from "@/lib/google-ads-enums";
import { getGoogleAdsCustomer, GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { rollbackGoogleLaunch } from "@/lib/google-launch-rollback";
import { log } from "@/lib/logger";
import { describeGoogleAdsError } from "@/lib/google-ads-error";
import { EU_POLITICAL_ADVERTISING_DECLARATION } from "@/lib/google-ads-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    // Đây là đường dùng bằng cách DÁN URL vào trình duyệt, nên "Unauthorized"
    // trơ trọi khiến người ta tưởng endpoint hỏng. Nói rõ nó là chuyện đăng nhập
    // của chính tab đang mở: cookie phiên là HttpOnly + SameSite=Lax, tab nào
    // chưa đăng nhập thì không gửi kèm.
    return NextResponse.json({
      error: "Chưa đăng nhập trong tab này",
      howToFix: `Mở ${process.env.APP_URL || "trang chủ tool"} đăng nhập trước, rồi dán lại URL này vào CÙNG cửa sổ trình duyệt đó (không dùng cửa sổ ẩn danh / trình duyệt khác).`,
    }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Chỉ super_admin được chạy phép thử này" }, { status: 403 });
  }
  if (req.nextUrl.searchParams.get("confirm") !== "yes") {
    return NextResponse.json({
      error: "Thiếu ?confirm=yes",
      whatItDoes:
        "Tạo 1 campaign PAUSED trên tài khoản Google thật rồi xoá ngay, để kiểm chứng nhánh rollback. Không tiêu tiền.",
    }, { status: 400 });
  }

  const company = (req.nextUrl.searchParams.get("company") ?? "MBC") as string;
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
  }

  const steps: string[] = [];
  const add = (s: string) => {
    steps.push(s);
    log.info("launch_selftest", s, { company });
  };

  const customerId = GOOGLE_CUSTOMER_IDS[company];
  const customer = getGoogleAdsCustomer(company);

  // ── Chế độ dọn rác: ?cleanup=yes ──
  // Lượt chạy hỏng có thể để lại campaign + budget thật trên tài khoản (đã xảy
  // ra: lệnh xoá sai hình dạng nên dọn 0/2). Nhánh này gom đúng những thứ do
  // phép thử sinh ra và xoá. Phạm vi bị khoá cứng theo TIỀN TỐ TÊN
  // "SELFTEST-ROLLBACK-" — đây không phải endpoint xoá campaign tuỳ ý.
  if (req.nextUrl.searchParams.get("cleanup") === "yes") {
    add("Chế độ dọn rác: tìm campaign tên SELFTEST-ROLLBACK-* chưa bị xoá");
    try {
      const rows = await customer.query(`
        SELECT campaign.resource_name, campaign.name, campaign.status, campaign.campaign_budget
        FROM campaign
        WHERE campaign.name LIKE 'SELFTEST-ROLLBACK-%'
          AND campaign.status != 'REMOVED'
      `);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (rows as any[]).map((r) => ({
        name: String(r.campaign?.name ?? ""),
        campaign: String(r.campaign?.resource_name ?? ""),
        budget: String(r.campaign?.campaign_budget ?? ""),
      })).filter((r) => r.campaign);

      if (list.length === 0) {
        // "Không tìm thấy gì" có hai nghĩa rất khác nhau: đã dọn sạch, hay câu
        // truy vấn không khớp. Liệt kê MỌI campaign của phép thử kèm trạng thái
        // (gồm cả REMOVED) để câu "tài khoản sạch" kiểm chứng được, thay vì
        // phải tin lời.
        const all = await customer.query(`
          SELECT campaign.resource_name, campaign.name, campaign.status
          FROM campaign WHERE campaign.name LIKE 'SELFTEST-ROLLBACK-%'
        `);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const history = (all as any[]).map((r) => ({
          name: String(r.campaign?.name ?? ""),
          resourceName: String(r.campaign?.resource_name ?? ""),
          status: enumName(enums.CampaignStatus, r.campaign?.status),
        }));
        add(`Không còn campaign nào chưa xoá. Toàn bộ lịch sử phép thử: ${history.length} campaign, tất cả đều ${[...new Set(history.map(h => h.status))].join("/") || "(không có)"}`);
        return NextResponse.json({
          cleaned: 0,
          message: "Không còn rác nào của phép thử.",
          allSelftestCampaigns: history,
          steps,
        });
      }

      add(`Tìm thấy ${list.length}: ${list.map((r) => r.name).join(", ")}`);
      // Campaign trước, budget sau — budget còn campaign tham chiếu thì Google
      // từ chối xoá.
      const rb = await rollbackGoogleLaunch(customer, [
        ...list.map((r) => ({ entity: "campaign", resourceName: r.campaign })),
        ...list.filter((r) => r.budget).map((r) => ({ entity: "campaign_budget", resourceName: r.budget })),
      ]);
      add(`Kết quả dọn: ${rb.summary}`);

      // Đọc lại để xác nhận, không tin vào "lệnh không báo lỗi".
      const after = await customer.query(`
        SELECT campaign.resource_name, campaign.name, campaign.status
        FROM campaign
        WHERE campaign.name LIKE 'SELFTEST-ROLLBACK-%'
          AND campaign.status != 'REMOVED'
      `);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const remaining = (after as any[]).length;
      add(`Đọc lại: còn ${remaining} campaign chưa xoá`);

      return NextResponse.json({
        cleaned: list.length - remaining,
        remaining,
        verdict: remaining === 0
          ? "Đã dọn sạch — xác nhận bằng đọc lại từ Google."
          : `Còn ${remaining} campaign chưa xoá được, cần xoá tay trên Google Ads.`,
        rollback: rb,
        steps,
      });
    } catch (err) {
      const info = describeGoogleAdsError(err);
      add(`Lỗi khi dọn: ${info.message}`);
      return NextResponse.json({ error: info.message, googleErrors: info.details, steps }, { status: 500 });
    }
  }

  // Dấu thời gian để tên không đụng nhau và dễ tìm lại trên Google Ads nếu có sót.
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const campaignName = `SELFTEST-ROLLBACK-${stamp}`;

  let campaignRN = "";
  let budgetRN = "";

  try {
    // ── 1. Tạo thật (budget + campaign PAUSED) ──
    add(`Bước 1: tạo campaign PAUSED "${campaignName}" trên tài khoản ${company} (${customerId})`);
    const tmpBudget = ResourceNames.campaignBudget(customerId, "-1");
    const tmpCampaign = ResourceNames.campaign(customerId, "-2");

    const ops = [
      {
        entity: "campaign_budget",
        operation: "create",
        resource: {
          resource_name: tmpBudget,
          name: `Budget — ${campaignName}`,
          // ₫100.000/ngày = mức tối thiểu; campaign PAUSED nên không tiêu đồng nào.
          amount_micros: 100_000 * 1_000_000,
          delivery_method: "STANDARD",
          explicitly_shared: false,
        },
      },
      {
        entity: "campaign",
        operation: "create",
        resource: {
          resource_name: tmpCampaign,
          name: campaignName,
          status: "PAUSED",
          advertising_channel_type: "SEARCH",
          // Google bắt buộc trường này khi tạo campaign — xem lib/google-ads-helpers.
          contains_eu_political_advertising: EU_POLITICAL_ADVERTISING_DECLARATION,
          campaign_budget: tmpBudget,
          maximize_conversions: {},
          network_settings: {
            target_google_search: true,
            target_search_network: false,
            target_content_network: false,
            target_partner_search_network: false,
          },
        },
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await customer.mutateResources(ops as any[]) as any;

    budgetRN = created.mutate_operation_responses?.[0]?.campaign_budget_result?.resource_name
      ?? created[0]?.campaign_budget?.resource_name
      ?? "";
    campaignRN = created.mutate_operation_responses?.[1]?.campaign_result?.resource_name
      ?? created[1]?.campaign?.resource_name
      ?? "";

    if (!campaignRN) {
      throw new Error("Google không trả về resource_name của campaign — không kiểm tiếp được");
    }
    add(`Đã tạo thật: campaign=${campaignRN} · budget=${budgetRN || "(không đọc được tên)"}`);

    // ── 2. Đọc lại để chắc nó CÓ thật trước khi xoá ──
    const before = await customer.query(`
      SELECT campaign.resource_name, campaign.name, campaign.status
      FROM campaign WHERE campaign.resource_name = '${campaignRN}'
    `);
    // Google trả trạng thái dưới dạng SỐ enum. Đổi sang tên bằng bảng enum của
    // chính thư viện, đừng đối chiếu với con số tự nhớ: lượt trước tôi kiểm
    // `=== "5"` trong khi CampaignStatus.REMOVED = 4, nên rollback chạy ĐÚNG mà
    // phép thử vẫn phán "CHƯA ĐẠT".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusBefore = enumName(enums.CampaignStatus, (before as any[])[0]?.campaign?.status);
    add(`Bước 2: đọc lại TRƯỚC khi xoá → trạng thái = ${statusBefore}`);

    // ── 3. Mô phỏng "pha sau hỏng" rồi gọi ĐÚNG hàm rollback của đường launch ──
    add("Bước 3: mô phỏng pha sau hỏng → gọi rollbackGoogleLaunch(), cùng hàm mà launch/search và launch/pmax dùng");
    const rb = await rollbackGoogleLaunch(customer, [
      { entity: "campaign", resourceName: campaignRN },
      ...(budgetRN ? [{ entity: "campaign_budget", resourceName: budgetRN }] : []),
    ]);
    add(`Kết quả dọn: ${rb.summary}`);

    // ── 4. ĐỌC LẠI — phần quyết định ──
    const after = await customer.query(`
      SELECT campaign.resource_name, campaign.name, campaign.status
      FROM campaign WHERE campaign.resource_name = '${campaignRN}'
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsAfter = after as any[];
    const statusAfter = rowsAfter.length === 0
      ? "(không còn trong kết quả truy vấn)"
      : enumName(enums.CampaignStatus, rowsAfter[0]?.campaign?.status);
    add(`Bước 4: đọc lại SAU khi xoá → trạng thái = ${statusAfter}`);

    // Google giữ campaign đã xoá ở trạng thái REMOVED, hoặc loại hẳn khỏi kết
    // quả truy vấn. Cả hai đều là "đã xoá thật".
    const passed = statusAfter === "REMOVED"
      || statusAfter === "(không còn trong kết quả truy vấn)";

    add(passed
      ? "KẾT LUẬN: ĐẠT — tạo thật rồi dọn thật, xác nhận bằng đọc lại từ Google."
      : `KẾT LUẬN: CHƯA ĐẠT — sau khi dọn Google vẫn báo "${statusAfter}".`);

    return NextResponse.json({
      passed,
      verdict: passed
        ? "ĐẠT — campaign được tạo thật rồi bị dọn thật, xác nhận bằng cách đọc lại từ Google."
        : `CHƯA ĐẠT — sau khi dọn, Google vẫn báo trạng thái "${statusAfter}". Vào Google Ads xoá tay: ${campaignName}`,
      campaignName,
      campaignResourceName: campaignRN,
      budgetResourceName: budgetRN,
      statusBefore,
      statusAfter,
      rollback: rb,
      steps,
    });
  } catch (err) {
    // google-ads-api ném GoogleAdsFailure (object), KHÔNG phải Error — dùng
    // String(err) ở đây biến nguyên nhân thật thành "[object Object]".
    const info = describeGoogleAdsError(err);
    const message = info.message;
    add(`Lỗi: ${message}`);
    if (info.details.length > 0) {
      add(`Chi tiết Google: ${info.details.map(d => `${d.code || "?"}${d.field ? ` @ ${d.field}` : ""}`).join(" · ")}`);
    }

    // Chính phép thử cũng phải tự dọn nếu nó hỏng giữa chừng — không được để lại
    // đúng thứ rác mà nó sinh ra để đi chứng minh là không còn rác.
    let cleanup = "";
    if (campaignRN || budgetRN) {
      try {
        const rb = await rollbackGoogleLaunch(customer, [
          ...(campaignRN ? [{ entity: "campaign", resourceName: campaignRN }] : []),
          ...(budgetRN ? [{ entity: "campaign_budget", resourceName: budgetRN }] : []),
        ]);
        cleanup = rb.summary;
      } catch (e) {
        cleanup = `Không dọn được: ${e instanceof Error ? e.message : String(e)}`;
      }
      add(`Dọn sau lỗi: ${cleanup}`);
    }

    return NextResponse.json({
      passed: false,
      verdict: `Phép thử hỏng: ${message}`,
      googleErrors: info.details,
      requestId: info.requestId,
      campaignName,
      cleanup,
      steps,
    }, { status: 500 });
  }
}
