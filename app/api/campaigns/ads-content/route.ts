// ============================================================
// Ads Content — Creative-Level Monitoring Aggregation API
// ============================================================
// GET /api/campaigns/ads-content?month=YYYY-MM&company=MBC|MBI|ALL
//
// Server-enforced company scoping: the `company` param is clamped to
// whatever the caller's role is actually permitted to see, so a
// tampered query param can never leak the other company's data.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCompaniesForRole } from "@/lib/permissions";
import { normalizeMonth, monthToRange } from "@/lib/ads-content/month-range";
import { getCached, setCached } from "@/lib/ads-content/cache";
import { getAdsContentItems } from "@/lib/ads-content/aggregate";
import type { AdsContentResponse } from "@/types/creative-content.types";
import { friendlyError } from "@/lib/not-configured";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const month = normalizeMonth(searchParams.get("month"));
  const requestedCompany = searchParams.get("company") ?? "ALL";

  const allowedCompanies = getCompaniesForRole(user);
  const companies = requestedCompany === "ALL"
    ? allowedCompanies
    : allowedCompanies.filter((c) => c === requestedCompany);

  if (companies.length === 0) {
    const empty: AdsContentResponse = { items: [], warnings: [], generatedAt: new Date().toISOString(), month };
    return NextResponse.json(empty);
  }

  const cacheKey = `ads-content:${[...companies].sort().join(",")}:${month}`;
  const cached = getCached<AdsContentResponse>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const dateRange = monthToRange(month);

  try {
    const { items, warnings } = await getAdsContentItems(companies, dateRange);

    const payload: AdsContentResponse = {
      items,
      warnings,
      generatedAt: new Date().toISOString(),
      month,
    };

    // Kết quả thiếu nguồn (warnings) chỉ được giữ 30 giây, không phải 5 phút —
    // xem lib/ads-content/cache.ts. Nếu không, một lỗi Meta thoáng qua sẽ khoá
    // trang ở trạng thái rỗng và nút Refresh không cứu được.
    setCached(cacheKey, payload, { partial: warnings.length > 0 });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/campaigns/ads-content] fatal error:", err);
    return NextResponse.json(
      { error: friendlyError(err instanceof Error ? err.message : "Failed to load Ads Content") },
      { status: 500 }
    );
  }
}
