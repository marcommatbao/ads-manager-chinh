// ============================================================
// OAuth `state` — CSRF protection for the two Google consent flows
//
// Both flows (/api/google/auth for Google Ads, /api/ga4/auth for GA4) come
// back to the same callback, /api/google/callback, which exchanges whatever
// `code` it is handed for a refresh token and stores it as the app's
// credentials. The Ads flow used to send no `state` at all and the GA4 flow
// sent the constant "ga4", so the callback could not tell its own redirect
// apart from one an attacker constructed.
//
// That is the classic OAuth login-CSRF / account-association attack: get an
// admin (session cookie is SameSite=Lax, which IS sent on a top-level GET
// navigation) to open a crafted callback URL carrying the attacker's
// authorization code, and the app happily saves the attacker's Google
// account as its Google Ads / GA4 connection — from then on it reads and
// writes the wrong account.
//
// The fix is the standard one: a single-use random nonce, handed to Google
// as `state` and simultaneously stored in a short-lived HttpOnly cookie.
// The callback only proceeds when the two match, which an attacker cannot
// arrange because they cannot set that cookie. The flow name is carried in
// the same value ("ads:<nonce>" / "ga4:<nonce>") so the shared callback can
// still tell the two apart.
// ============================================================
import crypto from "crypto";
import type { NextRequest } from "next/server";

export type OAuthFlow = "ads" | "ga4";

export const OAUTH_STATE_COOKIE = "google_oauth_state";

/** Consent round-trips are interactive; ten minutes is plenty. */
const STATE_MAX_AGE = 600;

export function createOAuthState(flow: OAuthFlow): string {
  return `${flow}:${crypto.randomBytes(16).toString("hex")}`;
}

export function oauthStateCookie(state: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_MAX_AGE}${secure}`;
}

export function clearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Compare the `state` Google echoed back against the one this browser was
 * issued. Returns the flow it belongs to, or null when it does not match —
 * length-safe comparison so the check itself leaks nothing.
 */
export function verifyOAuthState(request: NextRequest, state: string | null): OAuthFlow | null {
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !expected) return null;

  const a = Buffer.from(state);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const flow = state.split(":")[0];
  return flow === "ads" || flow === "ga4" ? flow : null;
}
