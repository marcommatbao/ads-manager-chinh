// ============================================================
// GET  /api/policy-radar/action-plan  — đọc kế hoạch đã lưu (không gọi AI)
// POST /api/policy-radar/action-plan  — dựng lại (CÓ gọi Gemini, tốn token)
// ------------------------------------------------------------
// Tách GET/POST là cố ý: mở trang phải KHÔNG BAO GIỜ tự đốt token. GET chỉ đọc
// file đã lưu và nói cho UI biết kế hoạch có còn khớp với danh sách hiện tại
// không; muốn dựng lại thì phải có người bấm.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getAllItems } from "@/lib/policy-radar/store";
import {
  buildActionPlan,
  readSavedPlan,
  selectOpenItems,
  fingerprintItems,
} from "@/lib/policy-radar/action-plan";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await getAllItems();
  const open = selectOpenItems(items);
  const plan = await readSavedPlan();

  return NextResponse.json({
    success: true,
    plan,
    openCount: open.length,
    /** true = có mục mới/đã đổi trạng thái kể từ lúc dựng kế hoạch. UI phải nói
     *  ra, nếu không người đọc tưởng danh sách việc đang phản ánh hiện tại. */
    stale: plan ? plan.itemsFingerprint !== fingerprintItems(open) : false,
    /** Chưa từng dựng lần nào — khác hẳn "đã dựng và không có việc gì". */
    neverBuilt: plan === null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Dựng kế hoạch tốn token → chặn ở quyền sửa, không mở cho mọi người xem trang.
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json(
      { error: "Chỉ tài khoản có quyền chỉnh sửa mới được dựng lại kế hoạch (thao tác này gọi AI)" },
      { status: 403 },
    );
  }

  let force = false;
  try {
    const body = (await req.json()) as { force?: boolean };
    force = body?.force === true;
  } catch {
    /* không có body cũng được */
  }

  const items = await getAllItems();
  const { plan, reused } = await buildActionPlan(items, { force });

  return NextResponse.json({
    success: plan.error === null,
    plan,
    /** true = trả bản đã lưu, KHÔNG gọi AI lần này (bấm lại quá nhanh). */
    reused,
    error: plan.error,
  });
}
