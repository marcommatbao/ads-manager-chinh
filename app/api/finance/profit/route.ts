import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { calculateProfit } from "@/lib/finance/profit-quality";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Profit readiness endpoint. This intentionally does not invent COGS/refund
 * values: the current repo has no authoritative COGS ledger or refund source.
 * It returns an explicit insufficient result until those sources are wired.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = request.nextUrl.searchParams.get("company") ?? "MBC";
  if (!getCompaniesForRole(user).includes(company)) {
    return NextResponse.json({ success: false, error: "Access denied for this company" }, { status: 403 });
  }
  const now = new Date();
  const from = request.nextUrl.searchParams.get("from") ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get("to") ?? now.toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ success: false, error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
  }

  const report = calculateProfit({
    grossRevenue: { value: 0, source: "not_available: gross revenue ledger", from, to, readAt: now.toISOString() },
    refunds: { value: 0, source: "not_available: refund ledger", from, to, readAt: now.toISOString() },
    cogs: null,
    adSpend: { value: 0, source: "not_available: company-scoped ad spend snapshot", from, to, readAt: now.toISOString() },
  });
  return NextResponse.json({
    success: true,
    company,
    from,
    to,
    report,
    missingSources: ["gross_revenue_ledger", "refund_ledger", "cogs_ledger", "company_scoped_ad_spend"],
  });
}
