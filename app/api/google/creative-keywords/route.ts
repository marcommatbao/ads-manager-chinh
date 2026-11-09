// ============================================================
// PATCH /api/google/creative-keywords
// { creativeId, action: "add" | "remove" | "setMatchType", ... }
//
// Sửa bộ từ khoá của một creative đã sinh.
// ------------------------------------------------------------
// Bộ từ khoá do Gemini sinh ra là ĐIỂM XUẤT PHÁT, không phải kết luận. Người
// chạy quảng cáo biết những thứ AI không biết: từ nào đã từng đốt tiền, từ nào
// đối thủ đang giữ, sản phẩm nào sắp ngừng bán.
//
// Lưu XUỐNG ĐĨA vì launch nạp creative từ file theo ID — sửa mỗi state trình
// duyệt thì campaign vẫn dùng bộ cũ.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { normalizeKeywordKey } from "@/lib/google-keyword-variants";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import fs from "fs";
import path from "path";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;
type MatchType = (typeof MATCH_TYPES)[number];

interface KeywordItem {
  keyword: string;
  matchType: MatchType;
  intentLevel?: string;
  note?: string;
  /** Người dùng tự thêm — phân biệt với từ khoá AI sinh, để sau này còn biết
   *  bộ nào thật sự đang chạy khi đánh giá lại. */
  addedBy?: "user";
}

/** Trùng = cùng chữ VÀ cùng loại khớp. Cùng chữ khác loại khớp là hai từ khoá
 *  KHÁC NHAU với Google — đó chính là thang match type. */
// So theo DẠNG ĐÃ BỎ DẤU. Bản cũ chỉ `toLowerCase()`, nên "vps giá rẻ",
// "vps giá rẽ" và "vps gia re" là ba khoá khác nhau và thêm được cả ba — tức
// ba từ khoá của cùng một tài khoản tranh nhau một lượt hiển thị, còn báo cáo
// thì bị chia nhỏ. Google đã tự khớp biến thể chính tả với PHRASE/BROAD, nên
// gõ đúng dấu một lần là đủ.
const keyOf = (k: { keyword: string; matchType: string }) =>
  `${normalizeKeywordKey(k.keyword)}::${k.matchType}`;

/** Trùng bất kể loại khớp — dùng để báo cho người dùng biết họ đang thêm một
 *  biến thể của cụm đã có, chứ không phải một từ khoá mới. */
const sameTermDifferentMatch = (items: Array<{ keyword: string; matchType: string }>, text: string) =>
  items.find((k) => normalizeKeywordKey(k.keyword) === normalizeKeywordKey(text));

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    creativeId?: string;
    action?: "add" | "remove" | "setMatchType";
    keyword?: string;
    matchType?: string;
    index?: number;
  };
  const { creativeId, action } = body;
  if (!creativeId || !action) {
    return NextResponse.json({ success: false, error: "Thiếu creativeId hoặc action" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "data", "google-creatives.json");
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ success: false, error: "Chưa có creative nào được lưu" }, { status: 404 });
  }

  try {
    const list = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Array<Record<string, unknown>>;
    const idx = list.findIndex((c) => c.id === creativeId);
    if (idx === -1) return NextResponse.json({ success: false, error: "Creative không tồn tại" }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kwBlock = (list[idx] as any).keywords;
    if (!kwBlock || !Array.isArray(kwBlock.keywords)) {
      return NextResponse.json({ success: false, error: "Creative không có bộ từ khoá" }, { status: 400 });
    }
    const items = kwBlock.keywords as KeywordItem[];

    if (action === "add") {
      const text = (body.keyword ?? "").trim();
      const mt = (body.matchType ?? "PHRASE").toUpperCase() as MatchType;
      if (!text) return NextResponse.json({ success: false, error: "Từ khoá rỗng" }, { status: 400 });
      if (!MATCH_TYPES.includes(mt)) {
        return NextResponse.json({ success: false, error: "matchType phải là EXACT, PHRASE hoặc BROAD" }, { status: 400 });
      }
      const candidate = { keyword: text, matchType: mt };
      if (items.some((k) => keyOf(k) === keyOf(candidate))) {
        // Nói rõ BẢN ĐANG CÓ là gì — người dùng gõ "vps gia re" mà báo
        // ' "vps gia re" đã có ' sẽ khó hiểu, vì trên màn hình họ thấy
        // "vps giá rẻ".
        const dup = sameTermDifferentMatch(items, text);
        const same = dup && dup.keyword.trim().toLowerCase() === text.toLowerCase();
        return NextResponse.json({
          success: false,
          error: same
            ? `"${text}" (${mt}) đã có trong danh sách`
            : `Đã có "${dup?.keyword}" (${mt}) — "${text}" chỉ là cách viết khác của cùng một cụm. Thêm cả hai là tự đấu giá với chính mình; Google đã tự khớp biến thể chính tả.`,
        }, { status: 409 });
      }
      items.push({ ...candidate, intentLevel: "—", note: "Thêm tay", addedBy: "user" });
    }

    if (action === "remove") {
      if (typeof body.index !== "number" || body.index < 0 || body.index >= items.length) {
        return NextResponse.json({ success: false, error: "index nằm ngoài danh sách" }, { status: 400 });
      }
      items.splice(body.index, 1);
    }

    if (action === "setMatchType") {
      const mt = (body.matchType ?? "").toUpperCase() as MatchType;
      if (typeof body.index !== "number" || body.index < 0 || body.index >= items.length) {
        return NextResponse.json({ success: false, error: "index nằm ngoài danh sách" }, { status: 400 });
      }
      if (!MATCH_TYPES.includes(mt)) {
        return NextResponse.json({ success: false, error: "matchType phải là EXACT, PHRASE hoặc BROAD" }, { status: 400 });
      }
      const moved = { ...items[body.index], matchType: mt };
      // Đổi loại khớp thành trùng với dòng khác thì chặn: hai dòng y hệt nhau
      // trong cùng ad group bị Google từ chối lúc tạo.
      if (items.some((k, i) => i !== body.index && keyOf(k) === keyOf(moved))) {
        return NextResponse.json(
          { success: false, error: `"${moved.keyword}" đã có sẵn ở loại khớp ${mt}` },
          { status: 409 },
        );
      }
      items[body.index] = moved;
    }

    writeFileAtomicSync(filePath, JSON.stringify(list, null, 2));

    const byType = MATCH_TYPES.reduce<Record<string, number>>((acc, t) => {
      acc[t] = items.filter((k) => k.matchType === t).length;
      return acc;
    }, {});
    const broadPct = items.length > 0 ? Math.round((byType.BROAD / items.length) * 100) : 0;

    return NextResponse.json({
      success: true,
      keywords: items,
      stats: { total: items.length, byType, broadPct },
      // Luật của chính prompt: BROAD tối đa 20%. Vượt là tiền chảy sang những
      // truy vấn không liên quan — nói ra thay vì để phát hiện qua báo cáo cuối tháng.
      warning: broadPct > 20
        ? `BROAD đang chiếm ${broadPct}% (khuyến nghị tối đa 20%). Loại khớp rộng dễ hiện cho truy vấn không liên quan.`
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Không lưu được") },
      { status: 500 },
    );
  }
}
