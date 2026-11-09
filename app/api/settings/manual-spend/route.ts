// GET  /api/settings/manual-spend?year=YYYY — chi phí kênh ngoài API đã khai
// PUT  /api/settings/manual-spend            — ghi đè một ô (tháng, công ty, kênh)
//
// Kênh không có API (TikTok, Zalo…) không thể tự lấy chi phí, mà thiếu nó thì
// tổng chi phí trên KPI Tổng Quan và báo cáo Telegram bị hụt mà không ai biết.
// Đây là đường nhập tay duy nhất; số nhập ở đây luôn được hiển thị tách bạch
// khỏi số đo được (xem lib/finance/manual-spend.ts).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { writeAuditEntry } from "@/lib/settings/audit";
import {
  manualChannelLabel, ManualSpendInputError,
  readManualSpend,
  upsertManualSpend,
  type ManualChannel,
  type ManualCompany,
} from "@/lib/finance/manual-spend";
import { isCompany } from "@/lib/companies/registry";
import { friendlyError } from "@/lib/not-configured";
import { adChannels } from "@/lib/settings/ad-channels";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const year = req.nextUrl.searchParams.get("year");
  const all = await readManualSpend();

  // Chỉ trả về công ty người dùng được xem — cùng nguyên tắc với các trang khác.
  const visible = all.filter(
    (e) => (!year || e.month.startsWith(`${year}-`)) && canAccessCompany(user, e.company),
  );

  return NextResponse.json({
    success: true,
    entries: visible,
    // Đợt 27: kênh theo sổ kênh (gốc + tự thêm ở trang KPI, bỏ kênh đã ẩn) + "Kênh khác".
    channels: [...adChannels().filter((c) => c.source === "manual" && !c.hidden).map((c) => c.key), "other"].map((c) => ({ id: c, label: manualChannelLabel(c) })),
    canEdit: hasPermission(user.role, "can_edit"),
  });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền sửa chi phí" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    company?: string;
    channel?: string;
    amount?: number;
    note?: string;
  };

  const company = body.company as ManualCompany;
  if (!isCompany(company)) {
    return NextResponse.json({ success: false, error: "Công ty không có ở bản cài này" }, { status: 400 });
  }
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: "Không có quyền với công ty này" }, { status: 403 });
  }

  try {
    await upsertManualSpend({
      month: String(body.month ?? ""),
      company,
      channel: body.channel as ManualChannel,
      amount: Number(body.amount ?? 0),
      note: body.note,
      updatedBy: user.email,
    });
  } catch (err) {
    if (err instanceof ManualSpendInputError) {
      return NextResponse.json({ success: false, error: friendlyError(err.message) }, { status: 400 });
    }
    throw err;
  }

  await writeAuditEntry(
    "budget",
    user,
    "update",
    `manual_spend:${body.month}:${company}:${body.channel}`,
    null,
    String(body.amount ?? 0),
    company,
  );

  return NextResponse.json({ success: true });
}
