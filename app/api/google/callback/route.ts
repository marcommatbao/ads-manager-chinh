// GET /api/google/callback — OAuth2 callback: exchange code → tokens → persist
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption";
import { withFileLock } from "@/lib/file-lock";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { guardEditCredentials } from "@/lib/settings/guards";
import { writeAuditEntry } from "@/lib/settings/audit";
import {
  exchangeCodeForRefreshToken,
  saveGA4OAuth,
} from "@/lib/ga4-oauth";
import { clearOAuthStateCookie, verifyOAuthState } from "@/lib/oauth-state";

const SETTINGS_PATH = path.resolve(process.cwd(), "data/google-settings.json");

type GoogleSettings = {
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  developerToken?: string;
  customerIdMBC?: string;
  customerIdMBI?: string;
  loginCustomerId?: string;
};

// Must match app/api/settings/google/route.ts's ENCRYPTED_FIELDS — both
// routes read/write the same data/google-settings.json file.
const ENCRYPTED_FIELDS = ["developerToken", "clientSecret", "refreshToken"] as const;

async function saveSettings(settings: GoogleSettings): Promise<void> {
  await withFileLock(SETTINGS_PATH, async () => {
    let existing: GoogleSettings = {};
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as GoogleSettings;
        existing = decryptFields(raw, ENCRYPTED_FIELDS);
      }
    } catch { /* ignore */ }

    const merged = { ...existing, ...settings };

    if (merged.refreshToken)   process.env.GOOGLE_ADS_REFRESH_TOKEN = merged.refreshToken;
    if (merged.clientId)       process.env.GOOGLE_ADS_CLIENT_ID = merged.clientId;
    if (merged.clientSecret)   process.env.GOOGLE_ADS_CLIENT_SECRET = merged.clientSecret;
    if (merged.developerToken) process.env.GOOGLE_ADS_DEVELOPER_TOKEN = merged.developerToken;
    if (merged.customerIdMBC)  process.env.GOOGLE_ADS_CUSTOMER_ID_MBC = merged.customerIdMBC;
    if (merged.customerIdMBI)  process.env.GOOGLE_ADS_CUSTOMER_ID_MBI = merged.customerIdMBI;
    if (merged.loginCustomerId) process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = merged.loginCustomerId;

    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      const toWrite = encryptFields(merged, ENCRYPTED_FIELDS);
      writeFileAtomicSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2));
    } catch (e) {
      console.warn("[callback/google] Could not persist to disk:", e);
    }
  });
}

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
  if (error) return failRedirect(error);
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
    } catch (err) {
      return failRedirect(err instanceof Error ? err.message : "ga4_token_exchange_failed");
    }
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings?google_error=missing_credentials`
    );
  }

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

    if (tokenData.error || !tokenData.refresh_token) {
      const msg = tokenData.error_description || tokenData.error || "token_exchange_failed";
      return NextResponse.redirect(
        `${appUrl}/settings?google_error=${encodeURIComponent(msg)}`
      );
    }

    await saveSettings({ refreshToken: tokenData.refresh_token });
    await writeAuditEntry("credentials_google", user, "update", "oauth_connect", null, null, "ALL");

    const okRes = NextResponse.redirect(`${appUrl}/settings?google_connected=true`);
    okRes.headers.set("Set-Cookie", clearOAuthStateCookie());
    return okRes;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(
      `${appUrl}/settings?google_error=${encodeURIComponent(message)}`
    );
  }
}
