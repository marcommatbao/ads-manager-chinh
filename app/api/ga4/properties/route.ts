// GET /api/ga4/properties — list the GA4 properties the connected Google
// account can read, so Settings → GA4 can offer a real picker instead of
// asking someone to type a numeric property id by hand.
import { isAdmin, canAccessAllCompanies } from "@/lib/permissions";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  readGA4OAuth,
  getAccessToken,
  invalidateAccessToken,
  listGA4Properties,
} from "@/lib/ga4-oauth";
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  // Đợt 21 A4: danh sách property (không có token) → admin+ như cũ.
  if (!isAdmin(user.role)) return NextResponse.json({ success: false, error: "Không có quyền" }, { status: 403 });
  // Đợt 21 A5b: danh sách MỌI property của tài khoản Google đã nối (dùng khi thiết lập) → chỉ người được giao mọi công ty.
  if (!canAccessAllCompanies(user)) return NextResponse.json({ success: false, error: "Không có quyền" }, { status: 403 });

  const oauth = readGA4OAuth();
  if (!oauth) {
    return NextResponse.json(
      { success: false, error: "Chưa kết nối Google Analytics", needsConnect: true },
      { status: 409 },
    );
  }

  try {
    const accessToken = await getAccessToken(oauth.refreshToken);
    const properties = await listGA4Properties(accessToken);
    return NextResponse.json({ success: true, properties });
  } catch (err) {
    // A revoked grant surfaces here first; drop the cached token so a
    // reconnect takes effect immediately rather than after an hour.
    invalidateAccessToken(oauth.refreshToken);
    const message = err instanceof Error ? err.message : "Không lấy được danh sách property";
    console.error("[ga4/properties]", err);
    return NextResponse.json({ success: false, error: friendlyError(message) }, { status: 502 });
  }
}
