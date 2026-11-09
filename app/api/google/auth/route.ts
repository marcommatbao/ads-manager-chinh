// GET /api/google/auth — Start Google OAuth2 flow for Google Ads
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createOAuthState, oauthStateCookie } from "@/lib/oauth-state";
import { guardEditCredentials } from "@/lib/settings/guards";
import { friendlyError } from "@/lib/not-configured";

const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
].join(" ");

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Kết nối = thay refresh token Google Ads DÙNG CHUNG cho cả hai công ty → chỉ người sửa được thông tin kết nối
  // (super_admin), giống /api/ga4/auth và POST /api/settings/google (audit 30/09: trước đây viewer cũng làm được).
  const guard = guardEditCredentials(user);
  if (guard) return guard;

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: friendlyError("GOOGLE_ADS_CLIENT_ID not configured") },
      { status: 500 }
    );
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const redirectUri = `${appUrl}/api/google/callback`;

  // Single-use nonce, mirrored into an HttpOnly cookie — the callback
  // refuses any code that does not come back with this exact value.
  const state = createOAuthState("ads");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
  res.headers.set("Set-Cookie", oauthStateCookie(state));
  return res;
}
