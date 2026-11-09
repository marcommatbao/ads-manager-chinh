// GET /api/ga4/auth — start the Google OAuth2 consent flow for GA4.
//
// Uses the Google Ads OAuth client and the Google Ads redirect URI
// (/api/google/callback), tagged with state=ga4 so the shared callback can
// tell the two flows apart. See lib/ga4-oauth.ts for why no separate
// redirect URI is used.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guardEditCredentials } from "@/lib/settings/guards";
import { createOAuthState, oauthStateCookie } from "@/lib/oauth-state";
import {
  GA4_SCOPE,
  getOAuthClient,
  oauthRedirectUri,
  appUrl,
} from "@/lib/ga4-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guard = guardEditCredentials(user);
  if (guard) return guard;

  const client = getOAuthClient();
  if (!client) {
    return NextResponse.redirect(
      `${appUrl()}/settings/ga4?ga4_error=${encodeURIComponent(
        "GOOGLE_ADS_CLIENT_ID/SECRET chưa cấu hình — vào Cài đặt → API Keys trước.",
      )}`,
    );
  }

  // Same single-use nonce as the Google Ads flow — it also tags which of the
  // two flows this callback round-trip belongs to.
  const state = createOAuthState("ga4");

  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    scope: GA4_SCOPE,
    access_type: "offline",
    // Force the consent screen so Google reliably returns a refresh_token —
    // it omits one on repeat grants otherwise, which is the single most
    // common way this kind of flow silently half-works.
    prompt: "consent",
    state,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.headers.set("Set-Cookie", oauthStateCookie(state));
  return res;
}
