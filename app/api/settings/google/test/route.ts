// GET /api/settings/google/test — verify Google Ads credentials are working
import { isMaskedPlaceholder } from "@/lib/settings/validators/credentials";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guardViewCredentials } from "@/lib/settings/guards";
import { GoogleAdsApi } from "google-ads-api";
import { friendlyError } from "@/lib/not-configured";
import { googleDevToken } from "@/lib/google-ads-client";

// Đợt 21 A4 (soát bảo mật): khoá mới dán gửi qua THÂN POST, không qua URL (URL lọt vào log proxy + lịch sử trình duyệt).
// GET vẫn chạy nhưng CHỈ kiểm khoá đã lưu (bỏ qua mọi khoá trên URL).
type ParamGet = (k: string) => string | null;
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Ô đang hiện giá trị đã che (••••) = "dùng khoá đã lưu" → bỏ qua, không đem chuỗi che đi kiểm.
  return run(request, (k) => (typeof b[k] === "string" && (b[k] as string).trim() && !isMaskedPlaceholder(b[k] as string) ? (b[k] as string).trim() : null));
}
export async function GET(request: NextRequest) {
  return run(request, () => null);
}
async function run(request: NextRequest, p: ParamGet) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const credGuard = guardViewCredentials(user);
  if (credGuard) return credGuard;

  // 12/10: không còn bắt buộc (Google bỏ từ 09/2026). Rỗng → undefined để thư viện KHÔNG gửi header (header rỗng bị Google từ chối 400).
  const developerToken = p("developerToken") || googleDevToken();
  const clientId       = p("clientId")       || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret   = p("clientSecret")   || process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken   = p("refreshToken")   || process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerIdMBC  = p("customerIdMBC")  || process.env.GOOGLE_ADS_CUSTOMER_ID_MBC;
  const customerIdMBI  = p("customerIdMBI")  || process.env.GOOGLE_ADS_CUSTOMER_ID_MBI;
  const loginCustomerId = p("loginCustomerId") || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({
      ok: false,
      error: "Missing required credentials (clientId, clientSecret, refreshToken)",
    });
  }

  const customerIds = [customerIdMBC, customerIdMBI].filter(Boolean) as string[];
  if (customerIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Cần ít nhất một mã khách hàng Google Ads" });
  }

  try {
    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken as string, // undefined = không gửi header
    });

    const accountResults: { id: string; name: string; campaigns: number }[] = [];

    for (const customerId of customerIds) {
      const customer = client.Customer({
        customer_id: customerId,
        refresh_token: refreshToken,
        ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
      });

      const rows = await customer.query(
        `SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1`
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (rows as any[])[0];
      const name = row?.customer?.descriptive_name || `Account ${customerId}`;

      const campaignRows = await customer.query(
        `SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED' LIMIT 1`
      );

      accountResults.push({
        id: customerId,
        name,
        campaigns: campaignRows.length,
      });
    }

    return NextResponse.json({ ok: true, accounts: accountResults });
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    let message = "Unknown error";

    if (Array.isArray(e.errors) && e.errors.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = e.errors[0] as any;
      message = first?.message || first?.error_code || JSON.stringify(first);
    } else if (err instanceof Error) {
      message = err.message;
    } else if (typeof e.message === "string") {
      message = e.message;
    }

    return NextResponse.json({ ok: false, error: friendlyError(message) }, { status: 500 });
  }
}
