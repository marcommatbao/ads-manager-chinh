// ============================================================
// GET /api/creative/diagnose-targeting?confirm=yes&campaignId=<id>
//
// Trả lời DỨT ĐIỂM câu hỏi: vì sao Meta từ chối targeting có interest/behavior,
// khiến ad set bị hạ cấp xuống Advantage+ broad và mất sạch độ tuổi + sở thích.
//
// Bằng chứng đã có (log prod 25/08/2026):
//   - Meta trả code 100, subcode 1487694, "Hạng mục bạn đã chọn không còn tồn tại"
//   - CẢ interests LẪN behaviors đều bị từ chối
//   - promoted_object CÓ mặt (pixel + OFFSITE_CONVERSIONS) → nguyên nhân mà repo
//     từng ghi lại cho đúng subcode này (thiếu promoted_object) ĐÃ BỊ LOẠI
//   - chỉ biến thể KHÔNG có flexible_spec mới qua, và nó đi kèm advantage_audience: 1
//
// Còn đúng hai khả năng, và chúng cần hai cách sửa khác hẳn nhau:
//   (A) advantage_audience: 0 không còn được phép với tài khoản/mục tiêu này
//       → phải đi đường "audience controls" của Meta, sửa cách gửi targeting
//   (B) id interest/behavior đã cũ, Meta khai tử
//       → phải làm mới nguồn id, không liên quan gì tới Advantage+
//
// Phép thử chạy MA TRẬN 4 biến thể qua `execution_options: ["validate_only"]` —
// Meta kiểm tính hợp lệ rồi trả kết quả mà KHÔNG tạo gì. Không ad set rác,
// không tốn tiền, không phải dọn.
//
//   A. chỉ độ tuổi        + advantage_audience 0
//   B. chỉ độ tuổi        + advantage_audience 1
//   C. độ tuổi + behaviors + advantage_audience 0
//   D. độ tuổi + behaviors + advantage_audience 1
//
// Đọc kết quả:
//   A hỏng            → advantage_audience: 0 bị chặn ⇒ khả năng (A)
//   A qua, C hỏng     → id behavior đã cũ            ⇒ khả năng (B)
//   C qua, D qua      → lỗi nằm ở chính id interest AI chọn, không ở cơ chế
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { log } from "@/lib/logger";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const META_BASE = META_GRAPH_BASE;

/** Behavior id tĩnh đang dùng trong lib/creative-pipeline (BEHAVIOR_MAP). */
const TEST_BEHAVIORS = [
  { id: "6022788483637", name: "Small business owners" },
  { id: "6002714895372", name: "Engaged shoppers" },
];

interface VariantResult {
  name: string;
  advantageAudience: 0 | 1;
  hasFlexibleSpec: boolean;
  ok: boolean;
  errorCode?: number;
  errorSubcode?: number;
  errorMessage?: string;
}

export async function GET(req: NextRequest) {
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
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ error: "Cần quyền chỉnh sửa" }, { status: 403 });
  }
  if (req.nextUrl.searchParams.get("confirm") !== "yes") {
    return NextResponse.json({
      error: "Thiếu ?confirm=yes",
      whatItDoes:
        "Gửi 4 biến thể targeting lên Meta ở chế độ validate_only — Meta chỉ kiểm tính hợp lệ, KHÔNG tạo ad set nào. Không tốn tiền, không để lại rác. Không cần truyền campaignId: tự lấy campaign mới nhất.",
    }, { status: 400 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const pixelId = req.nextUrl.searchParams.get("pixelId");
  if (!token || !adAccountId) {
    return NextResponse.json({ error: "META credentials chưa cấu hình" }, { status: 500 });
  }

  // campaignId: tự tìm nếu không truyền.
  //
  // Lượt chạy đầu người dùng dán nguyên chuỗi "<ID>" trong hướng dẫn. Cả 4 biến
  // thể hỏng vì "Invalid id" — chẳng liên quan gì tới targeting — mà phép thử
  // vẫn phán một kết luận chắc nịch. Bắt người dùng tự đi lấy id là tự tạo ra
  // một cách hỏng; tự tìm lấy thì không còn cách nào dán nhầm.
  let campaignId = (req.nextUrl.searchParams.get("campaignId") ?? "").trim();
  let campaignSource = "do người dùng truyền";

  if (!/^\d+$/.test(campaignId)) {
    const badInput = campaignId;
    try {
      const listRes = await fetch(
        `${META_BASE}/act_${adAccountId}/campaigns?fields=id,name,created_time&limit=1` +
        `&sort=created_time_descending&access_token=${token}`,
      );
      const listJson = (await listRes.json()) as {
        data?: Array<{ id: string; name: string }>;
        error?: { message?: string };
      };
      if (listJson.error || !listJson.data?.length) {
        return NextResponse.json({
          error: "Không tìm được campaign nào trên tài khoản để chạy phép thử",
          metaError: listJson.error?.message,
          hint: "Truyền ?campaignId=<số> của một campaign có thật.",
        }, { status: 400 });
      }
      campaignId = listJson.data[0].id;
      campaignSource = badInput
        ? `tự chọn campaign mới nhất "${listJson.data[0].name}" (bỏ qua campaignId không hợp lệ: ${badInput})`
        : `tự chọn campaign mới nhất "${listJson.data[0].name}"`;
    } catch (err) {
      return NextResponse.json({
        error: `Không lấy được danh sách campaign: ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  }

  // Campaign đang bật CBO thì KHÔNG được gửi ngân sách ở ad set — Meta trả
  // subcode 1885621 "chỉ được đặt ngân sách nhóm QC hoặc ngân sách chiến dịch",
  // và lỗi đó che mất kết quả targeting. Lượt chạy trước hỏng đúng vì thế.
  let campaignIsCbo = false;
  try {
    const cRes = await fetch(
      `${META_BASE}/${campaignId}?fields=daily_budget,lifetime_budget&access_token=${token}`,
    );
    const cJson = (await cRes.json()) as { daily_budget?: string; lifetime_budget?: string };
    campaignIsCbo = Boolean(cJson.daily_budget || cJson.lifetime_budget);
  } catch {
    /* không đọc được thì cứ gửi ngân sách như cũ */
  }

  // Một interest CÒN SỐNG, lấy từ chính công cụ tìm kiếm của Meta ngay lúc chạy.
  // Đây là mấu chốt để phân biệt "id tĩnh trong code đã chết" với "mọi
  // flexible_spec đều bị từ chối".
  let liveInterest: { id: string; name: string } | null = null;
  try {
    const iRes = await fetch(
      `${META_BASE}/search?type=adinterest&q=business&limit=1&locale=en_US&access_token=${token}`,
    );
    const iJson = (await iRes.json()) as { data?: Array<{ id: string; name: string }> };
    if (iJson.data?.length) liveInterest = { id: iJson.data[0].id, name: iJson.data[0].name };
  } catch {
    /* không lấy được thì bỏ biến thể E/F */
  }

  const baseTargeting = {
    geo_locations: { countries: ["VN"] },
    age_min: 28,
    age_max: 45,
  };

  type Spec = "none" | "behaviors" | "liveInterest";
  const variants: Array<{ name: string; advantage: 0 | 1; spec: Spec }> = [
    { name: "A. chỉ độ tuổi + advantage_audience 0", advantage: 0, spec: "none" },
    { name: "B. chỉ độ tuổi + advantage_audience 1", advantage: 1, spec: "none" },
    { name: "C. độ tuổi + behaviors TĨNH trong code + advantage_audience 0", advantage: 0, spec: "behaviors" },
    { name: "D. độ tuổi + behaviors TĨNH trong code + advantage_audience 1", advantage: 1, spec: "behaviors" },
  ];
  if (liveInterest) {
    variants.push(
      { name: `E. độ tuổi + interest SỐNG "${liveInterest.name}" + advantage_audience 0`, advantage: 0, spec: "liveInterest" },
      { name: `F. độ tuổi + interest SỐNG "${liveInterest.name}" + advantage_audience 1`, advantage: 1, spec: "liveInterest" },
    );
  }

  const results: VariantResult[] = [];

  for (const v of variants) {
    const targeting: Record<string, unknown> = {
      ...baseTargeting,
      targeting_automation: { advantage_audience: v.advantage },
    };
    if (v.spec === "behaviors") targeting.flexible_spec = [{ behaviors: TEST_BEHAVIORS }];
    if (v.spec === "liveInterest" && liveInterest) {
      targeting.flexible_spec = [{ interests: [liveInterest] }];
    }

    const params: Record<string, unknown> = {
      name: `DIAGNOSTIC-${Date.now()}-${v.advantage}-${v.spec}`,
      campaign_id: campaignId,
      status: "PAUSED",
      optimization_goal: "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      targeting,
      // Meta chỉ KIỂM, không tạo. Đây là thứ khiến phép thử này an toàn tuyệt đối.
      execution_options: ["validate_only"],
      access_token: token,
    };
    // CBO thì ngân sách nằm ở campaign; gửi thêm ở ad set là Meta chặn trước khi
    // kịp kiểm targeting.
    if (!campaignIsCbo) params.daily_budget = "200000";
    if (pixelId) {
      params.promoted_object = { pixel_id: pixelId, custom_event_type: "PURCHASE" };
    }

    try {
      const res = await fetch(`${META_BASE}/act_${adAccountId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = (await res.json()) as {
        error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string };
      };

      const entry: VariantResult = {
        name: v.name,
        advantageAudience: v.advantage,
        hasFlexibleSpec: v.spec !== "none",
        ok: !data.error,
        errorCode: data.error?.code,
        errorSubcode: data.error?.error_subcode,
        errorMessage: data.error?.error_user_msg ?? data.error?.message,
      };
      results.push(entry);
      log.info("targeting_diagnostic", `${v.name} → ${entry.ok ? "HỢP LỆ" : "TỪ CHỐI"}`, {
        code: entry.errorCode,
        subcode: entry.errorSubcode,
        message: entry.errorMessage,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: v.name, advantageAudience: v.advantage, hasFlexibleSpec: v.spec !== "none", ok: false, errorMessage: message });
      log.warn("targeting_diagnostic", `${v.name} → lỗi mạng: ${message}`);
    }
  }

  // ── Đọc ma trận thành một kết luận ──
  //
  // CHỐT: chỉ được kết luận từ những thất bại THUỘC VỀ TARGETING. Hai lượt chạy
  // trước đều phán sai vì bỏ qua chốt này — lần một cả 4 biến thể hỏng vì
  // campaign_id sai, lần hai A/B hỏng vì xung đột ngân sách CBO (subcode
  // 1885621), mà verdict vẫn tuyên "advantage_audience: 0 bị từ chối". Dùng
  // DANH SÁCH CHO PHÉP (chỉ mã lỗi targeting) thay vì danh sách loại trừ: mã lỗi
  // lạ thì mặc định coi là "không đo được", không mặc định coi là bằng chứng.
  const TARGETING_SUBCODES = new Set([1487694, 1487079, 1885183]);
  const isTargetingFailure = (r: VariantResult) =>
    !r.ok && r.errorSubcode !== undefined && TARGETING_SUBCODES.has(r.errorSubcode);
  const isOtherFailure = (r: VariantResult) => !r.ok && !isTargetingFailure(r);

  const byPrefix = (p: string) => results.find((r) => r.name.startsWith(p));
  const A = byPrefix("A"), C = byPrefix("C"), D = byPrefix("D"), E = byPrefix("E"), F = byPrefix("F");

  let verdict: string;
  let inconclusive = false;

  if (A && isOtherFailure(A)) {
    inconclusive = true;
    verdict =
      `KHÔNG KẾT LUẬN ĐƯỢC — biến thể nền (chỉ độ tuổi) hỏng vì lý do ngoài targeting: ` +
      `"${A.errorMessage}" (subcode ${A.errorSubcode}). Chưa đo được gì về Advantage+.`;
  } else if (!A) {
    inconclusive = true;
    verdict = "KHÔNG KẾT LUẬN ĐƯỢC — thiếu biến thể nền.";
  } else if (A.ok && C && D && isTargetingFailure(C) && isTargetingFailure(D)) {
    // Nền qua ở advantage_audience 0 ⇒ tắt Advantage+ KHÔNG bị chặn.
    // Behaviors hỏng ở CẢ hai chế độ ⇒ lỗi nằm ở chính id, không ở cơ chế.
    if (E && F && E.ok && F.ok) {
      verdict =
        "ĐÃ RÕ: cơ chế không có vấn đề — advantage_audience: 0 hợp lệ, và interest LẤY SỐNG từ Meta " +
        "cũng hợp lệ ở cả hai chế độ. Thứ bị Meta từ chối là các id BEHAVIOR tĩnh trong " +
        "lib/creative-pipeline (BEHAVIOR_MAP) — chúng đã bị khai tử. Hướng sửa: bỏ/làm mới bảng id " +
        "tĩnh và xác thực id trước khi launch, KHÔNG đụng tới Advantage+.";
    } else if (E && F && isTargetingFailure(E) && isTargetingFailure(F)) {
      verdict =
        "Behaviors tĩnh HỎNG và interest lấy sống từ Meta CŨNG hỏng ⇒ vấn đề không nằm ở từng id mà ở " +
        "cách tool gửi flexible_spec cho loại campaign/mục tiêu này. Hướng sửa nằm ở cấu trúc targeting.";
    } else {
      verdict =
        "advantage_audience: 0 hợp lệ (biến thể nền qua). Behaviors tĩnh bị từ chối ở cả hai chế độ ⇒ " +
        "nghi id đã chết. Chưa có biến thể interest sống để chốt — chạy lại khi Meta search trả kết quả.";
    }
  } else if (A.ok && C && C.ok) {
    verdict =
      "Cả biến thể nền lẫn behaviors đều hợp lệ ⇒ lỗi nằm ở chính id INTEREST mà AI chọn cho segment, " +
      "không ở cơ chế Advantage+ và không ở bảng behavior.";
  } else if (A && isTargetingFailure(A)) {
    verdict =
      "Ngay biến thể nền (chỉ độ tuổi, advantage_audience 0) đã bị từ chối vì targeting ⇒ tắt Advantage+ " +
      "không còn được phép. Hướng sửa: đi đường audience controls của Meta.";
  } else {
    inconclusive = true;
    verdict = "Ma trận không rơi vào mẫu nào đã lường trước — đọc từng dòng bên dưới.";
  }

  return NextResponse.json({
    note: "Chạy ở chế độ validate_only — Meta chỉ kiểm tính hợp lệ, KHÔNG tạo ad set nào.",
    campaignId,
    campaignSource,
    pixelUsed: pixelId ?? "(không gửi promoted_object)",
    campaignIsCbo,
    liveInterestUsed: liveInterest ? `${liveInterest.name} (${liveInterest.id})` : "(không lấy được)",
    inconclusive,
    verdict,
    results,
  });
}
