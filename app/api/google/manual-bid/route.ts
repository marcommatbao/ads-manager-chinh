// ============================================================
// GET /api/google/manual-bid?company=MBC&days=30[&campaignId=...]
// ============================================================
// Đề xuất giá thầu thủ công cho từng từ khoá, gộp theo chiến dịch.
// Chỉ ĐỌC — việc ghi nằm ở ./apply.

import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessCompany } from "@/lib/permissions";
import { fetchManualBidRecommendations } from "@/lib/google-manual-bid";
import { pickCompany } from "@/lib/companies"
import { friendlyError } from "@/lib/not-configured";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const company = pickCompany(req.nextUrl.searchParams.get("company"));
  if (!canAccessCompany(user, company)) {
    return NextResponse.json({ success: false, error: t("libgoogle.mba.noViewCo", { co: company }) }, { status: 403 });
  }

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? undefined;

  try {
    const { campaigns, warnings } = await fetchManualBidRecommendations(company, days, campaignId, t);
    return NextResponse.json({ success: true, campaigns, warnings, generatedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google/manual-bid]", message);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
