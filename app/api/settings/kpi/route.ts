// ============================================================
// KPI targets API
// GET /api/settings/kpi?year=YYYY      → 12 tháng + 4 quý (mọi role đọc)
// PUT /api/settings/kpi { year, months, note? } → lưu (admin/super_admin)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, isSuperAdmin } from "@/lib/permissions";
import { kpiForbiddenChanges } from "@/lib/settings/kpi-scope";
import { getKpiYear, saveKpiYear, effectiveMonth, type MonthKpi } from "@/lib/settings/kpi-store";
import { writeAuditEntry, writeAuditSnapshot, computeDiff } from "@/lib/settings/audit";
import { validateKpiYear } from "@/lib/settings/validators/kpi";
import { adChannels } from "@/lib/settings/ad-channels";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseYear(v: string | null): number {
  const y = Number(v);
  const now = new Date().getFullYear();
  return Number.isInteger(y) && y >= 2020 && y <= now + 5 ? y : now;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const year = parseYear(request.nextUrl.searchParams.get("year"));
  const canEdit = isAdmin(user.role) || isSuperAdmin(user.role);
  // Đợt 27: kèm sổ kênh (gốc + tự thêm) — trang KPI / Tổng quan / P&L dựng cột kênh theo danh sách này.
  // 12/10: `months` = ngân sách CỐ ĐỊNH (trang KPI sửa số này); `effectiveMonths` = trần THỰC TẾ (cố định + khoản chi bổ sung)
  // — Dashboard / P&L / Ngân sách so chi tiêu với số này.
  const view = getKpiYear(year);
  return NextResponse.json({ success: true, canEdit, canManageChannels: isSuperAdmin(user.role), channels: adChannels(), ...view, effectiveMonths: view.months.map(effectiveMonth) });
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(isAdmin(user.role) || isSuperAdmin(user.role))) {
    return NextResponse.json({ error: "Chỉ admin được sửa KPI" }, { status: 403 });
  }

  let body: { year?: number; months?: MonthKpi[]; note?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const year = parseYear(String(body.year));
  if (!Array.isArray(body.months) || body.months.length !== 12) {
    return NextResponse.json({ error: "months phải là mảng 12 phần tử" }, { status: 400 });
  }

  // Validate
  const errors = validateKpiYear(body.months);
  if (errors.length > 0) {
    return NextResponse.json({ success: false, errors }, { status: 422 });
  }

  // Snapshot current year before overwriting
  const oldYear = getKpiYear(year);
  const forbidden = kpiForbiddenChanges(user, oldYear.months, body.months);
  if (forbidden.length > 0) {
    return NextResponse.json({ success: false, error: `Bạn không được giao công ty của các ô: ${forbidden.join(", ")}` }, { status: 403 });
  }
  const snapId  = await writeAuditSnapshot("kpi", user, oldYear);

  // Save
  const saved = await saveKpiYear(year, body.months, user.email);

  // Audit diff per month
  const oldMonths = oldYear.months as unknown as Record<string, unknown>[];
  const newMonths = body.months as unknown as Record<string, unknown>[];
  const diffEntries = oldMonths.flatMap((old, i) =>
    computeDiff(old, newMonths[i] ?? {}, `month[${i + 1}]`)
  );

  if (diffEntries.length > 0) {
    await writeAuditEntry(
      "kpi", user, "update", `year_${year}`,
      null, null, "ALL",
      {
        note:              body.note,
        rollbackReference: snapId,
        diff:              diffEntries,
      },
    );
  }

  return NextResponse.json({ success: true, ...saved });
}
