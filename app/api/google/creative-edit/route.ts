// ============================================================
// PATCH /api/google/creative-edit
// { creativeId, section: "rsa" | "pmax", field, index, text }
//
// Sửa tay một tiêu đề / mô tả đã sinh, cho cả RSA lẫn PMax.
// ------------------------------------------------------------
// VÌ SAO PHẢI LƯU XUỐNG ĐĨA, không chỉ sửa trên màn hình:
// đường launch nạp creative từ `data/google-creatives.json` THEO ID. Sửa mỗi
// state của trình duyệt thì Google vẫn nhận bản gốc — người dùng thấy chữ mới
// mà quảng cáo lên chữ cũ, không có gì báo.
//
// `charCount`/`isValid` được TÍNH LẠI TẠI ĐÂY, không tin số do client gửi:
// đó là hai trường quyết định tiêu đề có bị bỏ khi launch hay không.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import fs from "fs";
import path from "path";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

/** Giới hạn cứng của Google. RSA và PMax khác nhau nên tách bảng, không dùng
 *  chung một con số cho cả hai. */
const LIMITS = {
  rsa:  { headlines: 30, descriptions: 90 },
  pmax: { headlines: 30, longHeadlines: 90, descriptions: 90 },
} as const;

/** Số dòng hợp lệ tối thiểu Google đòi, theo từng loại. */
const MINIMUMS: Record<string, Record<string, number>> = {
  rsa:  { headlines: 3, descriptions: 2 },
  pmax: { headlines: 3, longHeadlines: 1, descriptions: 2 },
};

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền chỉnh sửa" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    creativeId?: string;
    /** "rsa" (mặc định, giữ tương thích với client cũ) hoặc "pmax". */
    section?: "rsa" | "pmax";
    field?: string; index?: number; text?: string;
  };
  const { creativeId, field, index, text } = body;
  const section = body.section === "pmax" ? "pmax" : "rsa";

  if (!creativeId || !field || typeof index !== "number" || typeof text !== "string") {
    return NextResponse.json({ success: false, error: "Thiếu creativeId / field / index / text" }, { status: 400 });
  }
  const limitTable = LIMITS[section] as Record<string, number>;
  if (!(field in limitTable)) {
    return NextResponse.json(
      { success: false, error: `field không hợp lệ cho ${section}: phải là ${Object.keys(limitTable).join(" / ")}` },
      { status: 400 });
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
    const rsa = (list[idx] as any)[section];
    if (!rsa || !Array.isArray(rsa[field])) {
      return NextResponse.json({ success: false, error: `Creative không có ${field}` }, { status: 400 });
    }
    if (index < 0 || index >= rsa[field].length) {
      return NextResponse.json({ success: false, error: "index nằm ngoài danh sách" }, { status: 400 });
    }

    const clean = text.trim();
    const limit = limitTable[field];
    rsa[field][index] = {
      ...rsa[field][index],
      text: clean,
      charCount: clean.length,
      // Tính lại tại server. Client gửi isValid gì cũng bỏ qua — đây là trường
      // quyết định dòng này có được đưa lên Google hay bị bỏ.
      isValid: clean.length > 0 && clean.length <= limit,
    };

    writeFileAtomicSync(filePath, JSON.stringify(list, null, 2));

    const validCount = rsa[field].filter((x: { isValid?: boolean }) => x.isValid !== false).length;
    return NextResponse.json({
      success: true,
      item: rsa[field][index],
      limit,
      validCount,
      total: rsa[field].length,
      // Google đòi TỐI THIỂU 3 tiêu đề và 2 mô tả. Dưới ngưỡng đó thì quảng cáo
      // không tạo được — nói ngay lúc sửa, đừng để phát hiện lúc launch.
      belowMinimum: validCount < (MINIMUMS[section][field] ?? 0),
      minimum: MINIMUMS[section][field] ?? 0,
      section,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Không lưu được") },
      { status: 500 },
    );
  }
}
