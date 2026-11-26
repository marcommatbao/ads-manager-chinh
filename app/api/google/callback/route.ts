// GET /api/google/callback — OAuth2 callback: exchange code → tokens → persist
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import path from "path";
import { saveGoogleCredentials } from "@/lib/settings/google-credentials";
import { envSuffix } from "@/lib/settings/company-ids";
import { guardEditCredentials } from "@/lib/settings/guards";
import { writeAuditEntry } from "@/lib/settings/audit";
import {
  exchangeCodeForRefreshToken,
  saveGA4OAuth,
} from "@/lib/ga4-oauth";
import { clearOAuthStateCookie, verifyOAuthState } from "@/lib/oauth-state";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/google-settings.json");

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Cả hai luồng (Google Ads + GA4) đều ghi đè thông tin kết nối dùng chung → kiểm quyền TRƯỚC mọi nhánh
  // (audit 30/09: trước đây chỉ nhánh GA4 kiểm, nhánh Google Ads thì mọi người đăng nhập đều thay được token).
  const guard = guardEditCredentials(user);
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  const appUrl = process.env.APP_URL || "http://localhost:3000";

  // The GA4 consent flow reuses this exact redirect URI (so no second URI has
  // to be registered in Google Cloud); `state` says which flow came back and,
  // since it is now a single-use nonce mirrored in an HttpOnly cookie, also
  // proves the round-trip is one this app actually started
  // (lib/oauth-state.ts). Everything after the GA4 branch is the original
  // Google Ads flow.
  const flow = verifyOAuthState(request, state);
  const isGA4 = flow === "ga4";
  const failRedirect = (msg: string) => {
    const res = NextResponse.redirect(
      isGA4
        ? `${appUrl}/settings/ga4?ga4_error=${encodeURIComponent(msg)}`
        : `${appUrl}/settings?google_error=${encodeURIComponent(msg)}`
    );
    res.headers.set("Set-Cookie", clearOAuthStateCookie());
    return res;
  };

  // A `code` that arrives without the matching state is either a stale tab or
  // someone else's authorization code being pushed into our account — never
  // exchange it.
  if (!flow) return failRedirect("invalid_state");
  if (error) return failRedirect("authorization_failed");
  if (!code) return failRedirect("no_code");

  if (isGA4) {
    try {
      const refreshToken = await exchangeCodeForRefreshToken(code);
      await saveGA4OAuth({
        refreshToken,
        connectedAt: new Date().toISOString(),
        connectedBy: user.email,
      });
      await writeAuditEntry("credentials_ga4", user, "update", "oauth_connect", null, null, "ALL");
      const okRes = NextResponse.redirect(`${appUrl}/settings/ga4?ga4_connected=true`);
      okRes.headers.set("Set-Cookie", clearOAuthStateCookie());
      return okRes;
    } catch {
      return failRedirect("ga4_token_exchange_failed");
    }
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) return failRedirect("missing_credentials");

  try {
    const redirectUri = `${appUrl}/api/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || tokenData.error || typeof tokenData.refresh_token !== "string" || !tokenData.refresh_token.trim()) {
      return failRedirect("token_exchange_failed");
    }

    // Persist the exact client pair used for this exchange, rather than letting
    // stale saved counterparts replace settings-origin runtime credentials.
    let provenance;
    try {
      provenance = await saveGoogleCredentials(SETTINGS_PATH, {
        refreshToken: tokenData.refresh_token, clientId, clientSecret,
      }, envSuffix);
    } catch {
      return failRedirect("credentials_persist_failed");
    }
    await writeAuditEntry("credentials_google", user, "update", "refreshToken, clientId, clientSecret", null, null, "ALL", {
      note: provenance.effective
        ? "oauth_saved_effective; google_api_read_not_tested"
        : "oauth_saved_reconnect_required; google_api_read_not_tested",
    });
    if (!provenance.persisted || !provenance.effective) {
      return failRedirect(provenance.restartConflict ? "reconnect_required_env_conflict" : "reconnect_required");
    }

    const okRes = NextResponse.redirect(`${appUrl}/settings?google_oauth_saved=true`);
    okRes.headers.set("Set-Cookie", clearOAuthStateCookie());
    return okRes;
  } catch {
    return failRedirect("oauth_callback_failed");
  }
}
