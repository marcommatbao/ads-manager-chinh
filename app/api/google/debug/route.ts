// GET /api/google/debug — Check Google Ads connection status and account info
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAdsClient } from "@/lib/google-client";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configured = {
    developerToken: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: !!process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: !!process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: !!process.env.GOOGLE_ADS_REFRESH_TOKEN,
    customerIdMBC: process.env.GOOGLE_ADS_CUSTOMER_ID_MBC || null,
    customerIdMBI: process.env.GOOGLE_ADS_CUSTOMER_ID_MBI || null,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
  };

  // 12/10: developer token không còn bắt buộc (Google bỏ từ 09/2026) — vẫn báo có/không ở `configured`.
  const allConfigured =
    configured.clientId &&
    configured.clientSecret &&
    configured.refreshToken &&
    (configured.customerIdMBC || configured.customerIdMBI);

  if (!allConfigured) {
    return NextResponse.json({ ok: false, configured, error: "Missing required env vars" });
  }

  try {
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];
    const breakdown = await googleAdsClient.getAccountBreakdown({ from, to });

    return NextResponse.json({
      ok: true,
      configured,
      accounts: breakdown.map((a) => ({
        id: a.accountId,
        name: a.accountName,
        clicks: a.clicks,
        impressions: a.impressions,
        costMicros: a.costMicros,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, configured, error: friendlyError(message) }, { status: 500 });
  }
}
