import { NextResponse } from "next/server";
import { getClearSessionCookieHeader, getCurrentUser } from "@/lib/auth";
import { revokeSessions } from "@/lib/team";

// Đăng xuất = thu hồi phía server (tăng session_version), không chỉ xoá cookie trên trình duyệt:
// cookie bị lộ / chép trước đó cũng hết hiệu lực ngay. Hệ quả: đăng xuất mọi thiết bị của người này.
export async function POST() {
  const user = await getCurrentUser();
  if (user && !user.id.startsWith("seo_")) {
    try { await revokeSessions(user.id); } catch (err) { console.error("[auth] không thu hồi được phiên:", err instanceof Error ? err.message : err); }
  }
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", getClearSessionCookieHeader());
  return response;
}
