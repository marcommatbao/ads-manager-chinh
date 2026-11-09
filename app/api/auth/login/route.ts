import { NextRequest, NextResponse } from "next/server";
import { updateMember, getMemberByEmail } from "@/lib/team";
import { verifyPassword, hashPassword, isLegacyPasswordHash, createSessionToken, getSessionCookieHeader } from "@/lib/auth";
import type { Role } from "@/lib/permissions";
import type { CompanyAccess } from "@/lib/team";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import crypto from "crypto";
import { isAllowedLoginEmail, loginDomainMessage } from "@/lib/login-domain";
import { normalizePassword } from "@/lib/password-policy";
import { setupEnabled } from "@/lib/setup/state";

// Max 5 attempts per IP per 60s. Durable across restarts (data/rate-limit.json)
// — was previously an in-process Map here that reset on every redeploy.
const LOGIN_RATE_LIMIT_MAX = 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
// Audit 30/09: thêm giới hạn theo EMAIL — giới hạn theo IP dựa vào X-Forwarded-For, đổi header là né được.
// Khoá lưu dạng băm, không ghi email thô vào data/rate-limit.json.
const LOGIN_EMAIL_MAX = 10;
const LOGIN_EMAIL_WINDOW_MS = 15 * 60_000;

// Map SEO tool roles → AdsCommand roles
const SEO_ROLE_MAP: Record<string, Role> = {
  superadmin: "super_admin",
  // Đợt 21 A5: CHỈ ánh xạ sang vai trò CŨ. Đăng nhập SEO gán companies=["ALL"] trong phiên — vô hại với vai trò cũ (phạm vi
  // theo vai trò) nhưng sẽ cấp MỌI công ty nếu ánh xạ sang vai trò chung "admin"/"viewer". Đừng đổi sang vai trò chung.
  admin:      "admin_mbc",
  editor:     "viewer_mbc",
  viewer:     "viewer_mbc",
};

async function trySeоAuth(email: string, password: string) {
  // Soát bảo mật 03/10: bản cài KHÁCH (SETUP_WIZARD=on) KHÔNG BAO GIỜ nhận đăng nhập qua công cụ SEO của Mắt Bão — nếu
  // SEO_API_URL lỡ bị chép sang, người dùng SEO (kể cả superadmin → super_admin) sẽ vào được bản cài của khách.
  if (setupEnabled()) return null;
  // Không còn host mặc định trong mã (đổi 17/09/2026). Nhánh này GỬI email +
  // mật khẩu người dùng sang một hệ thống khác; host của nó không nên nằm
  // trong repo công khai. Thiếu biến → BỎ hẳn nhánh dự phòng này (trả null)
  // chứ không đăng nhập bằng một host đoán được.
  const seoBase = (process.env.SEO_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!seoBase) return null;
  try {
    const res = await fetch(`${seoBase}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string; user?: { id?: number; display_name?: string; role?: string } };
    if (!data.access_token || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed } = await rateLimit(ip, LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS);

  if (!allowed) {
    return NextResponse.json(
      { success: false, error: "Quá nhiều lần thử. Vui lòng đợi 1 phút rồi thử lại." },
      { status: 429 }
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  const password = body.password;
  // Chuẩn hoá TRƯỚC khi tra cứu: trước đây " Email@x" (thừa khoảng trắng) không khớp tài khoản cục bộ đã bị khoá
  // → rơi sang đăng nhập qua công cụ SEO.
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !password) {
    return NextResponse.json({ success: false, error: "Email và mật khẩu không được để trống" }, { status: 400 });
  }
  // Chỉ email công ty (lib/login-domain.ts) — chặn TRƯỚC khi tra cứu / gửi sang công cụ SEO.
  if (!isAllowedLoginEmail(email)) {
    return NextResponse.json({ success: false, error: loginDomainMessage() }, { status: 403 });
  }
  const emailKey = `login-email:${crypto.createHash("sha256").update(email).digest("hex").slice(0, 32)}`;
  if (!(await rateLimit(emailKey, LOGIN_EMAIL_MAX, LOGIN_EMAIL_WINDOW_MS)).allowed) {
    return NextResponse.json(
      { success: false, error: "Tài khoản này bị thử sai quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại." },
      { status: 429 }
    );
  }

  // ── 1. Local auth (team-members.json) ──────────────────────────────
  const member = await getMemberByEmail(email);
  const storedHash = member?.password_hash ?? "scrypt:dummy:dummy";
  const localValid = member && member.is_active && member.status === "active"
    ? verifyPassword(password, storedHash) || (normalizePassword(password) !== password && verifyPassword(normalizePassword(password), storedHash)) // NFC: xem lib/password-policy.ts
    : false;

  if (localValid && member) {
    // ── Tự nâng cấp băm cũ sang scrypt ──
    //
    // Đây là lần DUY NHẤT hệ thống cầm mật khẩu bản rõ, nên cũng là lần duy
    // nhất băm lại được. Không làm ở đây thì tài khoản cũ nằm mãi ở SHA-256
    // một vòng — bẻ nhanh hơn scrypt (N=16384) hàng vạn lần.
    //
    // KHÔNG để hỏng ở bước này làm hỏng đăng nhập: người dùng nhập đúng mật
    // khẩu rồi, ghi tệp lỗi là chuyện của mình. Ghi log rồi đi tiếp.
    if (isLegacyPasswordHash(member.password_hash ?? "")) {
      try {
        await updateMember(member.id, { password_hash: hashPassword(password) }, { keepSessions: true });
        console.info(`[auth] đã nâng cấp băm mật khẩu sang scrypt cho ${member.email}`);
      } catch (err) {
        console.error("[auth] không nâng cấp được băm mật khẩu:", err instanceof Error ? err.message : err);
      }
    }

    const token = createSessionToken({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      companies: member.company_access,
      mustChangePassword: !!member.must_change_password, // Đợt 21 B
    }, member.session_version ?? 0);
    const response = NextResponse.json({
      success: true,
      user: { name: member.name, email: member.email, role: member.role, mustChangePassword: !!member.must_change_password },
    });
    response.headers.set("Set-Cookie", getSessionCookieHeader(token));
    return response;
  }

  // ── 2. Fallback: SEO tool auth ──────────────────────────────────────
  // Only attempt if local user not found (don't leak wrong-password to SEO)
  if (!member) {
    const seoUser = await trySeоAuth(email, password);
    if (seoUser) {
      const adsRole: Role = SEO_ROLE_MAP[seoUser.role ?? ""] ?? "viewer_mbc";
      const companies: CompanyAccess[] = ["ALL"];
      const displayName = seoUser.display_name ?? email.split("@")[0];
      const userId = `seo_${seoUser.id ?? email.replace(/\W/g, "_")}`;

      const token = createSessionToken({
        id: userId,
        name: displayName,
        email,
        role: adsRole,
        companies,
      });
      const response = NextResponse.json({
        success: true,
        user: { name: displayName, email, role: adsRole },
      });
      response.headers.set("Set-Cookie", getSessionCookieHeader(token));
      return response;
    }
  }

  return NextResponse.json({ success: false, error: "Email hoặc mật khẩu không đúng" }, { status: 401 });
}
