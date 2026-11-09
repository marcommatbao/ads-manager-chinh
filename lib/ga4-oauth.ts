// ============================================================
// GA4 OAuth — connection + access-token refresh
//
// Why this exists: lib/ga4-client.ts takes a raw Bearer access token, and
// data/ga4-settings.json stored one per property, but nothing ever
// refreshed it. A Google access token lives ~1 hour, so any GA4 connection
// made by pasting a token was broken by the next working day. Nothing in
// the app ever called connect_property either, so GA4 was never usable at
// all — this module plus /api/ga4/auth + the Settings → GA4 tab close that.
//
// The OAuth consent reuses the SAME redirect URI as the Google Ads flow
// (/api/google/callback, distinguished by `state`), so no new redirect URI
// has to be registered in Google Cloud — a real operational blocker,
// because that console is not something this app can change.
//
// Client credentials are shared with Google Ads (same Google Cloud
// project), so connecting GA4 needs no extra secrets.
// ============================================================
import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { encryptFields, decryptFields } from "@/lib/crypto/data-encryption";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
// The flow marker used to be this constant, sent as `state` verbatim. It now
// lives in lib/oauth-state.ts as "ga4:<nonce>" so the same value that names
// the flow also proves the callback belongs to a round-trip this app started.

const OAUTH_PATH = path.resolve(process.cwd(), "data/ga4-oauth.json");
const ENCRYPTED_FIELDS = ["refreshToken"] as const;

export interface GA4OAuthRecord {
  refreshToken: string;
  connectedAt: string;
  connectedBy: string;
}

export function getOAuthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

export function oauthRedirectUri(): string {
  // Deliberately the Google Ads callback — see header.
  return `${appUrl()}/api/google/callback`;
}

// ── Stored connection ────────────────────────────────────────

export function readGA4OAuth(): GA4OAuthRecord | null {
  try {
    if (!fs.existsSync(OAUTH_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(OAUTH_PATH, "utf8")) as Record<string, unknown>;
    const dec = decryptFields(raw, ENCRYPTED_FIELDS) as unknown as GA4OAuthRecord;
    return dec.refreshToken ? dec : null;
  } catch {
    return null;
  }
}

export async function saveGA4OAuth(record: GA4OAuthRecord): Promise<void> {
  await withFileLock(OAUTH_PATH, async () => {
    fs.mkdirSync(path.dirname(OAUTH_PATH), { recursive: true });
    const toWrite = encryptFields(record as unknown as Record<string, unknown>, ENCRYPTED_FIELDS);
    writeFileAtomicSync(OAUTH_PATH, JSON.stringify(toWrite, null, 2));
  });
}

export async function clearGA4OAuth(): Promise<void> {
  await withFileLock(OAUTH_PATH, async () => {
    try {
      fs.rmSync(OAUTH_PATH, { force: true });
    } catch { /* already gone */ }
  });
}

// ── Token exchange / refresh ─────────────────────────────────

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForRefreshToken(code: string): Promise<string> {
  const client = getOAuthClient();
  if (!client) throw new Error("GOOGLE_ADS_CLIENT_ID/SECRET chưa cấu hình");

  const data = await postToken({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: oauthRedirectUri(),
    grant_type: "authorization_code",
  });

  if (data.error || !data.refresh_token) {
    throw new Error(
      data.error_description || data.error ||
      "Google không trả refresh_token — thử lại và chọn 'Cho phép' ở màn hình đồng ý.",
    );
  }
  return data.refresh_token;
}

// Access tokens are short-lived; cache in-process and refresh a minute
// early so a request never starts with a token about to expire.
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const EXPIRY_SKEW_MS = 60_000;

export async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached.accessToken;

  const client = getOAuthClient();
  if (!client) throw new Error("GOOGLE_ADS_CLIENT_ID/SECRET chưa cấu hình");

  const data = await postToken({
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
  });

  if (data.error || !data.access_token) {
    throw new Error(
      data.error_description || data.error ||
      "Không làm mới được access token GA4 — có thể quyền đã bị thu hồi, hãy kết nối lại.",
    );
  }

  const accessToken = data.access_token;
  tokenCache.set(refreshToken, {
    accessToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return accessToken;
}

/** Drop a cached token — call after a 401 so the next attempt re-fetches. */
export function invalidateAccessToken(refreshToken: string): void {
  tokenCache.delete(refreshToken);
}

// ── Property discovery (Analytics Admin API) ─────────────────

export interface GA4PropertyOption {
  /** "properties/123456789" — the form the Data API expects. */
  propertyId: string;
  displayName: string;
  accountName: string;
}

export async function listGA4Properties(accessToken: string): Promise<GA4PropertyOption[]> {
  const out: GA4PropertyOption[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = (await res.json()) as {
      accountSummaries?: Array<{
        displayName?: string;
        propertySummaries?: Array<{ property?: string; displayName?: string }>;
      }>;
      nextPageToken?: string;
      error?: { message?: string };
    };

    if (data.error) throw new Error(data.error.message ?? "Analytics Admin API error");

    for (const acc of data.accountSummaries ?? []) {
      for (const p of acc.propertySummaries ?? []) {
        if (!p.property) continue;
        out.push({
          propertyId: p.property,
          displayName: p.displayName ?? p.property,
          accountName: acc.displayName ?? "",
        });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return out;
}
