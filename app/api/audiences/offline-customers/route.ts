// GET /api/audiences/offline-customers?company=MBI&days=90&minAmount=500000
//
// Real Odoo-backed customer list for the "offline_orders" Audience Builder
// source — MBI ONLY (see lib/odoo-mbi-audience.ts for why MBC has no
// equivalent real query). Returns customers already mapped to this
// codebase's CustomerRecord shape (lib/audience-builder.ts), ready to feed
// straight into /api/audiences/create-lookalike without a CSV round-trip.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, canAccessCompany } from "@/lib/permissions";
import { getMbiOfflineOrderCustomers } from "@/lib/odoo-mbi-audience";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user.role, "can_edit")) {
    return NextResponse.json({ success: false, error: "Không có quyền tạo Audience" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const company = (searchParams.get("company") || "MBC") as string | "both";
  const daysParam = Number(searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 90;
  const minAmountParam = Number(searchParams.get("minAmount"));
  const minAmount = Number.isFinite(minAmountParam) && minAmountParam > 0 ? minAmountParam : 0;

  // Real wiring only exists for MBI. Return an HONEST "not supported"
  // result rather than a fake 0-customers "no orders found" — the caller
  // (app/(dashboard)/audiences/page.tsx) must fall back to the CSV upload
  // path for MBC/both, not read this as "Odoo really has zero matches".
  if (company !== "MBI") {
    return NextResponse.json({
      success: true,
      supported: false,
      reason:
        `Chưa có kết nối Odoo thực cho "offline_orders" ở phạm vi ${company === "both" ? "MBC + MBI (cả hai)" : "MBC"} — ` +
        `chỉ MBI có query sale.order → res.partner đã xác minh. Vui lòng dùng Upload CSV cho công ty này.`,
      customers: [],
      count: 0,
    });
  }

  if (!canAccessCompany(user, "MBI")) {
    return NextResponse.json({ success: false, error: "Access denied for MBI" }, { status: 403 });
  }

  try {
    const { customers, orderCount } = await getMbiOfflineOrderCustomers({ days, minAmount });
    return NextResponse.json({
      success: true,
      supported: true,
      customers,
      count: customers.length,
      orderCount,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: friendlyError(err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
