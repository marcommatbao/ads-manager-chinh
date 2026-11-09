import { NextRequest, NextResponse } from "next/server";
import { isMaskedPlaceholder } from "@/lib/settings/validators/credentials";
import { getCurrentUser } from "@/lib/auth";
import { guardViewCredentials } from "@/lib/settings/guards";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

// GET /api/settings/meta/test?token=xxx — verify a Meta access token is valid
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

  const token = p("token") || process.env.META_ACCESS_TOKEN;
  const adAccountId = p("adAccountId") || process.env.META_AD_ACCOUNT_ID;

  if (!token) {
    return NextResponse.json({ ok: false, error: "No access token configured" });
  }

  try {
    // Verify token via Graph API /me endpoint
    const meRes = await fetch(
      `${META_GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(token)}`
    );
    const meData = await meRes.json() as { id?: string; name?: string; error?: { message: string; code: number } };

    if (meData.error) {
      return NextResponse.json({
        ok: false,
        error: meData.error.message,
        code: meData.error.code,
      });
    }

    // Check ad account access if provided
    let accountName = "";
    if (adAccountId) {
      const accountId = adAccountId.replace(/^act_/, "");
      const acctRes = await fetch(
        `${META_GRAPH_BASE}/act_${accountId}?fields=name,account_status,currency&access_token=${encodeURIComponent(token)}`
      );
      const acctData = await acctRes.json() as { name?: string; account_status?: number; currency?: string; error?: { message: string } };
      if (!acctData.error) accountName = acctData.name ?? "";
    }

    return NextResponse.json({
      ok: true,
      userId: meData.id,
      userName: meData.name,
      accountName,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Network error checking token" });
  }
}
