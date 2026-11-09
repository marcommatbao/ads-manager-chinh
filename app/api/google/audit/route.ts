import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/lib/i18n/server";
import { GoogleAuditEngine } from "@/lib/google-audit-engine";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client";

export async function GET(request: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const company = pickCompany(searchParams.get("company"));
    if (!canAccessCompany(user, company)) {
      return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
    }

    // Theo công ty của bản cài + chế độ cổng (trước 26/10/2026 đọc cứng MBC/MBI).
    const customerId = GOOGLE_CUSTOMER_IDS[company];

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: friendlyError("Google Ads customer ID not configured") },
        { status: 500 }
      );
    }

    const engine = new GoogleAuditEngine();
    const data = await engine.runAudit(customerId, t);

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: friendlyError(message) },
      { status: 500 }
    );
  }
}
