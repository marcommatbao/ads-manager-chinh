// ============================================================
// GET /api/creative/diagnose-text-limits?confirm=yes&pageId=<id>
//
// Facebook có THẬT SỰ từ chối text vượt 125/40/30 ký tự không?
//
// lib/creative-limits.ts khẳng định có: "an over-limit headline/description only
// surfaced as a rejection from the real Facebook API at launch time". Dựa vào
// khẳng định đó, preflight đặt CREATIVE_OVER_CHAR_LIMIT ở mức "error" và CHẶN
// launch. Người dùng bị chặn liên tục vì nó.
//
// Nhưng đó đúng là loại khẳng định chưa kiểm đã sai hai lần hôm nay (subcode
// 1487694 "do thiếu promoted_object", và "id behavior tĩnh đã verified"). Nếu
// 125/40/30 chỉ là mức KHUYẾN NGHỊ hiển thị của Ads Manager — Facebook vẫn đăng,
// chỉ cắt chữ kèm "Xem thêm" — thì tool đang chặn người dùng vì một giới hạn
// không tồn tại.
//
// Phép thử: gửi ad creative với text CỐ Ý vượt hạn qua
// `execution_options: ["validate_only"]`. Meta kiểm rồi trả kết quả mà KHÔNG tạo
// gì. Không rác, không tốn tiền.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { log } from "@/lib/logger";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

const META_BASE = META_GRAPH_BASE;

interface Variant {
  name: string;
  headline: string;
  primaryText: string;
  description: string;
}

function repeat(base: string, len: number): string {
  return base.repeat(Math.ceil(len / base.length)).slice(0, len);
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({
      error: "Chưa đăng nhập trong tab này",
      howToFix: `Mở ${process.env.APP_URL || "trang chủ tool"} đăng nhập trước, rồi dán lại URL này vào CÙNG cửa sổ đó.`,
    }, { status: 401 });
  }
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ error: "Cần quyền chỉnh sửa" }, { status: 403 });
  }
  if (req.nextUrl.searchParams.get("confirm") !== "yes") {
    return NextResponse.json({
      error: "Thiếu ?confirm=yes",
      whatItDoes: "Gửi vài ad creative có text vượt hạn lên Meta ở chế độ validate_only — Meta chỉ KIỂM, không tạo gì.",
    }, { status: 400 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) {
    return NextResponse.json({ error: "META credentials chưa cấu hình" }, { status: 500 });
  }

  // pageId bắt buộc cho object_story_spec. Không truyền thì tự lấy trang đầu tiên.
  let pageId = req.nextUrl.searchParams.get("pageId") ?? "";
  if (!/^\d+$/.test(pageId)) {
    try {
      const r = await fetch(`${META_BASE}/me/accounts?fields=id,name&limit=1&access_token=${token}`);
      const j = (await r.json()) as { data?: Array<{ id: string }> };
      pageId = j.data?.[0]?.id ?? "";
    } catch { /* để rỗng, sẽ báo lỗi rõ bên dưới */ }
  }
  if (!pageId) {
    return NextResponse.json({
      error: "Không lấy được Page ID",
      hint: "Truyền ?pageId=<số> của Facebook Page đang chạy quảng cáo.",
    }, { status: 400 });
  }

  const variants: Variant[] = [
    { name: "A. TRONG hạn (40/125/30)", headline: repeat("Tên miền ", 38), primaryText: repeat("Đăng ký tên miền giá tốt. ", 120), description: repeat("Ưu đãi ", 28) },
    { name: "B. primaryText VƯỢT (154/125)", headline: repeat("Tên miền ", 38), primaryText: repeat("Đăng ký tên miền giá tốt. ", 154), description: repeat("Ưu đãi ", 28) },
    { name: "C. headline VƯỢT (45/40)", headline: repeat("Tên miền giá rẻ ", 45), primaryText: repeat("Đăng ký tên miền giá tốt. ", 120), description: repeat("Ưu đãi ", 28) },
    { name: "D. description VƯỢT (33/30)", headline: repeat("Tên miền ", 38), primaryText: repeat("Đăng ký tên miền giá tốt. ", 120), description: repeat("Ưu đãi ", 33) },
  ];

  const results: Array<{ name: string; lengths: Record<string, number>; ok: boolean; errorCode?: number; errorSubcode?: number; errorMessage?: string }> = [];

  for (const v of variants) {
    const params = {
      name: `DIAGNOSTIC-TEXT-${Date.now()}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          link: "https://matbao.net",
          message: v.primaryText,
          name: v.headline,
          description: v.description,
          call_to_action: { type: "LEARN_MORE", value: { link: "https://matbao.net" } },
        },
      },
      execution_options: ["validate_only"],
      access_token: token,
    };

    try {
      const res = await fetch(`${META_BASE}/act_${adAccountId}/adcreatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = (await res.json()) as { error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string } };
      const entry = {
        name: v.name,
        lengths: { headline: v.headline.length, primaryText: v.primaryText.length, description: v.description.length },
        ok: !data.error,
        errorCode: data.error?.code,
        errorSubcode: data.error?.error_subcode,
        errorMessage: data.error?.error_user_msg ?? data.error?.message,
      };
      results.push(entry);
      log.info("text_limit_diagnostic", `${v.name} → ${entry.ok ? "CHẤP NHẬN" : "TỪ CHỐI"}`, {
        code: entry.errorCode, subcode: entry.errorSubcode, message: entry.errorMessage,
      });
    } catch (err) {
      results.push({
        name: v.name,
        lengths: { headline: v.headline.length, primaryText: v.primaryText.length, description: v.description.length },
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const [A, B, C, D] = results;
  let verdict: string;
  if (A && !A.ok) {
    verdict = `KHÔNG KẾT LUẬN ĐƯỢC — ngay biến thể TRONG hạn cũng bị từ chối ("${A.errorMessage}"), tức lỗi nằm ở chỗ khác chứ không phải độ dài.`;
  } else if (B?.ok && C?.ok && D?.ok) {
    verdict =
      "Facebook CHẤP NHẬN cả ba biến thể vượt hạn ⇒ 125/40/30 chỉ là mức KHUYẾN NGHỊ hiển thị, " +
      "không phải giới hạn cứng. Tool đang CHẶN launch vì một giới hạn không tồn tại — nên hạ " +
      "CREATIVE_OVER_CHAR_LIMIT từ 'error' xuống cảnh báo.";
  } else if (!B?.ok && !C?.ok && !D?.ok) {
    verdict = "Facebook TỪ CHỐI cả ba ⇒ giới hạn là CỨNG, việc chặn launch hiện tại là đúng. Phải sửa ở khâu sinh nội dung.";
  } else {
    verdict =
      "Kết quả HỖN HỢP — có trường bị từ chối, có trường không. Đọc từng dòng: chỉ chặn launch cho đúng " +
      "những trường Meta thật sự từ chối, các trường còn lại hạ xuống cảnh báo.";
  }

  return NextResponse.json({
    note: "validate_only — Meta chỉ kiểm tính hợp lệ, KHÔNG tạo creative nào.",
    pageId,
    verdict,
    results,
  });
}
