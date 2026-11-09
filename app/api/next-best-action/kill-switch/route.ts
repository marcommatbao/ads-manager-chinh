// ============================================================
// GET/POST /api/next-best-action/kill-switch
// ============================================================
// P8 — công tắc tắt khẩn cấp cho NBA auto-apply.
//
// Vì sao là route riêng chứ không nhét vào POST /api/next-best-action: đây là
// thứ người ta tìm khi đang hoảng. Nó phải có địa chỉ riêng, gọi được bằng một
// lệnh curl, không phải một `action` lẫn giữa seen/dismiss/snooze.
//
// TẮT thì KHÔNG cần quyền cao. Ai cũng phải dừng được một hệ thống đang tự
// tiêu tiền — chặn nhầm một lượt tăng ngân sách rẻ hơn nhiều so với việc người
// thấy bất thường mà không có quyền dừng. BẬT LẠI mới đòi quyền.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { readKillSwitch, setKillSwitch } from "@/lib/nba/kill-switch";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = readKillSwitch();
  return NextResponse.json({
    success: true,
    state: r.state,
    readable: r.readable,
    // Đọc hỏng nghĩa là auto-apply ĐANG bị chặn (fail-closed) — phải nói ra,
    // không để giao diện hiện "đang chạy bình thường".
    error: r.error ?? null,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { stopAll?: boolean; stoppedReasonCodes?: string[]; reason?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: "Body không phải JSON" }, { status: 400 }); }

  const turningOff = body.stopAll === true || (body.stoppedReasonCodes?.length ?? 0) > 0;
  // Chỉ việc BẬT LẠI mới cần quyền — xem ghi chú ở đầu tệp.
  if (!turningOff && !hasPermission(user.role, "can_edit")) {
    return NextResponse.json(
      { success: false, error: "Không có quyền bật lại auto-apply. Việc TẮT thì ai cũng làm được." },
      { status: 403 },
    );
  }
  if (!body.reason?.trim()) {
    return NextResponse.json(
      { success: false, error: "Phải ghi lý do — một công tắc không có vết sẽ có người bật lại mà không biết vì sao nó từng bị tắt." },
      { status: 400 },
    );
  }

  const state = setKillSwitch({
    stopAll: body.stopAll,
    stoppedReasonCodes: body.stoppedReasonCodes,
    updatedBy: user.email || user.name || user.id,
    reason: body.reason.trim(),
  });
  return NextResponse.json({
    success: true,
    state,
    message: state.stopAll
      ? "ĐÃ TẮT toàn bộ auto-apply. Có hiệu lực ngay lượt chạy tiếp theo, không cần deploy."
      : state.stoppedReasonCodes.length
        ? `Đã tắt riêng: ${state.stoppedReasonCodes.join(", ")}.`
        : "Đã bật lại auto-apply.",
  });
}
