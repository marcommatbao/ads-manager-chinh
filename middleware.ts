// ============================================================
// AdsCommand — Middleware (JWT Auth + RBAC)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { isPublicPage } from "@/lib/public-pages";
import { COOKIE_NAME, decodeSessionFromCookieValue } from "@/lib/auth";
import { canAccessRoute, getBlockedMessage } from "@/lib/permissions";
import { isHiddenPage } from "@/lib/hidden-pages";
import { csrfRejectReason } from "@/lib/csrf";
// Đợt 21 A2: mô-đun của bản cài (đọc data/companies.json — middleware chạy Node nên đọc tệp được).
import { hasModule } from "@/lib/companies";
import { moduleOfApi, moduleOfPage } from "@/lib/companies/modules";
// Đợt 21 A6: bản cài mới (SETUP_WIZARD=on) chưa hoàn tất thiết lập → mọi trang về /setup (trừ Cài đặt).
import { pageAllowedDuringSetup, setupPending } from "@/lib/setup/state";

// Run in Node.js runtime so we can use crypto for full JWT signature verification
export const runtime = "nodejs";

// Auth pages that don't need login
const AUTH_PAGES = ["/login", "/register"];

// Đợt 21 B — trang đổi mật khẩu (bắt buộc ở lần đăng nhập đầu / sau khi được đặt lại) và các API được gọi trước khi đổi.
const CHANGE_PASSWORD_PAGE = "/doi-mat-khau";
const API_ALLOWED_BEFORE_PASSWORD_CHANGE = ["/api/auth", "/api/companies"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── /api: chỉ chặn CSRF (xác thực vẫn do từng route tự làm) ──
  if (pathname.startsWith("/api")) {
    const why = csrfRejectReason({
      method: request.method,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    });
    if (why) return NextResponse.json({ success: false, error: "Yêu cầu bị chặn (khác nguồn)" }, { status: 403 });
    // Đợt 21 A2: API thuần một mô-đun đang TẮT ở bản cài → 404 (không lộ là có tính năng, không chạy nửa vời).
    const mod = moduleOfApi(pathname);
    if (mod && !hasModule(mod)) return NextResponse.json({ success: false, error: "Tính năng không có ở bản cài này" }, { status: 404 });
    // Đợt 21 B: phiên đang "phải đổi mật khẩu" → chỉ được gọi API đăng nhập/đổi mật khẩu + danh sách công ty (bố cục cần).
    if (!API_ALLOWED_BEFORE_PASSWORD_CHANGE.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      const s = decodeSessionFromCookieValue(request.cookies.get(COOKIE_NAME)?.value);
      if (s?.mustChangePassword) return NextResponse.json({ success: false, mustChangePassword: true, error: "Vui lòng đổi mật khẩu trước khi tiếp tục" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // ── Skip static assets and _next ──
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // ── Trang công khai (/about, /privacy) — ai cũng xem được, kể cả đã đăng nhập (15/10/2026, xác minh OAuth Google) ──
  if (isPublicPage(pathname)) return NextResponse.next();

  // ── Đợt 21 A2: trang thuộc mô-đun đang TẮT ở bản cài → về trang chủ ──
  {
    const mod = moduleOfPage(pathname);
    if (mod && !hasModule(mod)) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
  }

  // ── Get session from cookie (full JWT signature verification) ──
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? decodeSessionFromCookieValue(token) : null;

  // ── Not logged in or invalid/tampered token ──
  if (!session || !session.role || !session.companies) {
    if (AUTH_PAGES.some(p => pathname.startsWith(p))) {
      return NextResponse.next();
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Only allow relative paths as callbackUrl (prevent open redirect)
    if (pathname.startsWith("/") && !pathname.startsWith("//")) {
      // /oauth/authorize phải giữ nguyên tham số (client_id, code_challenge…) để quay lại đúng lượt uỷ quyền sau khi đăng nhập.
      loginUrl.searchParams.set("callbackUrl", pathname.startsWith("/oauth/") ? pathname + request.nextUrl.search : pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // ── Logged in but on auth page → redirect to dashboard ──
  if (AUTH_PAGES.some(p => pathname.startsWith(p))) {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = "/";
    return NextResponse.redirect(dashUrl);
  }

  // ── Đợt 21 B: phải đổi mật khẩu trước (đặt TRƯỚC chốt thiết lập — tài khoản quản trị đầu tiên cũng phải đổi) ──
  if (session.mustChangePassword && pathname !== CHANGE_PASSWORD_PAGE) {
    const pwUrl = request.nextUrl.clone();
    pwUrl.pathname = CHANGE_PASSWORD_PAGE;
    pwUrl.search = "";
    return NextResponse.redirect(pwUrl);
  }

  // ── Đợt 21 A6: đang thiết lập lần đầu → về /setup (bản Mắt Bão không bật SETUP_WIZARD → bỏ qua) ──
  if (setupPending() && !pageAllowedDuringSetup(pathname)) {
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = "/setup";
    setupUrl.search = "";
    return NextResponse.redirect(setupUrl);
  }

  // ── Trang đang tạm ẩn → đưa về Dashboard ──
  // Đặt SAU bước kiểm đăng nhập (người lạ vẫn phải về trang đăng nhập trước,
  // không lộ việc app có những trang nào) và TRƯỚC kiểm quyền.
  if (isHiddenPage(pathname)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  // ── Check route permission ──
  const role = session.role;
  if (!canAccessRoute(role, pathname)) {
    const message = getBlockedMessage(pathname);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.searchParams.set("blocked", message);
    return NextResponse.redirect(redirectUrl);
  }

  // ── Inject verified user info headers for server components ──
  const response = NextResponse.next();
  response.headers.set("x-user-role", role);
  response.headers.set("x-user-companies", (session.companies || []).join(","));
  return response;

}

// ── Matcher: pages + /api (api chỉ để chặn CSRF, xem lib/csrf.ts) ──
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
