// ============================================================
// AdsCommand — JWT Cookie-Based Auth
// No external dependencies (uses Node crypto)
// ============================================================

import crypto from "crypto";
import { cookies } from "next/headers";
import type { Role } from "./permissions";
import { isPlaceholderSecret } from "./secret-placeholders";
import { isAllowedLoginEmail } from "./login-domain";

// Require a real secret — weak fallback only in development so the server still boots.
const _rawSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!_rawSecret) {
  // `next build` nạp module này để thu thập dữ liệu trang; nền tảng như Vibe Host chỉ đưa biến vào lúc chạy
  // nên lúc build chưa có khoá. Lúc chạy thật (không phải giai đoạn build) vẫn bắt buộc.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(
      "[auth] AUTH_SECRET is required in production. " +
      "Set AUTH_SECRET (or NEXTAUTH_SECRET) in your environment variables."
    );
  }
  console.warn(
    "[auth] ⚠️  AUTH_SECRET not set — using insecure dev secret. " +
    "Add AUTH_SECRET=<random-64-char-string> to .env.local before deploying."
  );
}
const JWT_SECRET = _rawSecret ?? "adscommand-dev-secret-do-not-use-in-production";
// Audit 30/09: khoá ký là giá trị mẫu CÔNG KHAI (.env.example) trên production = ai cũng tự ký được phiên super_admin.
// Không ném lúc nạp module (để `next build` không vỡ) — thay vào đó không cấp và không nhận phiên nào.
const KEY_IS_PUBLIC_PLACEHOLDER = process.env.NODE_ENV === "production" && isPlaceholderSecret(_rawSecret);
if (KEY_IS_PUBLIC_PLACEHOLDER) {
  console.error("[auth] FATAL: AUTH_SECRET/NEXTAUTH_SECRET là giá trị mẫu công khai — mọi đăng nhập bị từ chối cho tới khi đặt khoá ngẫu nhiên.");
}
const COOKIE_NAME = "adscommand_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// ─────────────────────────────────────────────
// Session Payload
// ─────────────────────────────────────────────

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  companies: string[];
  /** Đợt 21 B: phải đổi mật khẩu trước khi dùng app (middleware chuyển về /doi-mat-khau, API trả 403). */
  mustChangePassword?: boolean;
}

interface JWTPayload {
  sub: string;        // user id
  name: string;
  email: string;
  role: Role;
  companies: string[];
  /** session_version của thành viên lúc cấp phiên (lib/team.ts). */
  sv?: number;
  /** Đợt 21 B: phải đổi mật khẩu (middleware chỉ giải mã JWT, không tra kho người dùng). */
  mcp?: boolean;
  iat: number;        // issued at
  exp: number;        // expires
}

// ─────────────────────────────────────────────
// JWT Helpers (HMAC-SHA256)
// ─────────────────────────────────────────────

function base64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf-8");
}

function signJWT(payload: JWTPayload): string {
  if (KEY_IS_PUBLIC_PLACEHOLDER) throw new Error("AUTH_SECRET là giá trị mẫu công khai — không cấp phiên");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJWT(token: string): JWTPayload | null {
  if (KEY_IS_PUBLIC_PLACEHOLDER) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${body}`)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const payload = JSON.parse(base64urlDecode(body)) as JWTPayload;

    // Check expiration
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Password Hashing (scrypt; còn đọc được băm SHA-256 cũ)
// ─────────────────────────────────────────────
// Tiêu đề cũ ghi "SHA-256 + salt" trong khi code đã dùng scrypt từ lâu — sửa
// cho khớp, chú thích lệch code làm người đọc sau tin nhầm.

// scrypt params: N=16384, r=8, p=1 → ~100ms on modern hardware
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/**
 * Băm này có phải định dạng CŨ (SHA-256 một vòng) không?
 *
 * Dùng để tự nâng cấp sang scrypt ngay sau lần đăng nhập đúng đầu tiên. Không
 * có bước đó thì tài khoản cũ nằm mãi ở mức yếu — SHA-256 một vòng bẻ nhanh
 * hơn scrypt (N=16384) hàng vạn lần.
 */
export function isLegacyPasswordHash(stored: string): boolean {
  return !((stored ?? "").startsWith("scrypt:"));
}

export function verifyPassword(password: string, stored: string): boolean {
  // Còn đọc được băm cũ dạng `salt:hash` (SHA-256 một vòng).
  //
  // GIỮ để người dùng cũ vẫn đăng nhập được, nhưng nơi gọi PHẢI nâng cấp ngay
  // sau khi đúng — xem isLegacyPasswordHash(). Bỏ hẳn nhánh này khi đã hết
  // tài khoản dùng định dạng cũ.
  if (isLegacyPasswordHash(stored)) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const attempt = crypto.createHash("sha256").update(salt + password).digest("hex");
    // So sánh chống đo thời gian, giống nhánh scrypt bên dưới. Trước đây dùng
    // `===`: rủi ro thực tế thấp (phải đoán được HASH chứ không phải mật khẩu)
    // nhưng để hai nhánh lệch nhau là mời người đọc sau chép nhầm cái yếu.
    try {
      return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
    } catch {
      return false; // độ dài lệch → Buffer khác cỡ → coi như sai
    }
  }
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const attempt = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────────

export function createSessionToken(user: SessionUser, sessionVersion = 0): string {
  const payload: JWTPayload = {
    sv: sessionVersion,
    ...(user.mustChangePassword ? { mcp: true } : {}),
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companies: user.companies,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE,
  };
  return signJWT(payload);
}

export function decodeSessionToken(token: string): SessionUser | null {
  const payload = verifyJWT(token);
  if (!payload) return null;
  return {
    id: payload.sub,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    companies: payload.companies,
    ...(payload.mcp ? { mustChangePassword: true } : {}),
  };
}

/** Tối thiểu từ lib/team TeamMember cần để đối chiếu phiên (tránh import vòng auth ↔ team). */
export interface SessionMemberRecord {
  id: string; name: string; email: string; role: Role; company_access: string[]
  status: string; is_active: boolean; session_version?: number; must_change_password?: boolean
}

/**
 * Phiên chỉ hợp lệ khi thành viên CÒN tồn tại, đang hoạt động và session_version khớp — quyền lấy từ kho, KHÔNG từ token.
 * Trước đây quyền đọc thẳng từ JWT 7 ngày: xoá / hạ quyền / khoá / đổi mật khẩu / đăng xuất đều không có tác dụng với cookie cũ.
 * Người dùng đăng nhập qua công cụ SEO (id "seo_…") không có bản ghi cục bộ — giữ nguyên cách cũ.
 */
export function resolveSession(token: string, lookup: (id: string) => SessionMemberRecord | null): SessionUser | null {
  const payload = verifyJWT(token);
  if (!payload) return null;
  if (payload.sub.startsWith("seo_")) return isAllowedLoginEmail(payload.email) ? decodeSessionToken(token) : null;
  const m = lookup(payload.sub);
  if (!m || !m.is_active || m.status !== "active") return null;
  if (!isAllowedLoginEmail(m.email)) return null;
  if ((m.session_version ?? 0) !== (payload.sv ?? 0)) return null;
  return { id: m.id, name: m.name, email: m.email, role: m.role, companies: m.company_access, ...(m.must_change_password ? { mustChangePassword: true } : {}) };
}

/**
 * Get current user from session cookie (server components/API routes).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const payload = verifyJWT(token);
    if (!payload) return null;
    const { getMember } = await import("./team");
    const member = payload.sub.startsWith("seo_") ? null : await getMember(payload.sub);
    return resolveSession(token, () => member);
  } catch {
    return null;
  }
}

/**
 * Create Set-Cookie header value for session.
 */
export function getSessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

/**
 * Create Set-Cookie header value to clear session.
 */
export function getClearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// For middleware (Edge runtime): decode from raw cookie string
export function decodeSessionFromCookieValue(cookieValue: string | undefined): SessionUser | null {
  if (!cookieValue) return null;
  return decodeSessionToken(cookieValue);
}

export { COOKIE_NAME };
