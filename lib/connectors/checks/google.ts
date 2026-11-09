// Google Ads connector check — token refresh + account list
import type { CheckResult } from "../types";
import { googleDevToken } from "@/lib/google-ads-client";
import { envSatisfied } from "@/lib/connect/env-satisfied";
import { GatewayError, gatewayEnabled, getGatewayToken } from "@/lib/connect/gateway";

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function getAccessToken(): Promise<{ token: string } | { error: string; category: "auth" | "network" }> {
  // Chế độ cổng: token xin từ Cổng kết nối Mắt Bão (bản cài không có client secret / refresh token).
  if (gatewayEnabled()) {
    try {
      return { token: await getGatewayToken("google") };
    } catch (e) {
      const network = e instanceof GatewayError && (e.code === "unreachable" || e.status >= 500);
      return { error: e instanceof Error ? e.message : String(e), category: network ? "network" : "auth" };
    }
  }
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "Missing OAuth credentials", category: "auth" };
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as TokenResponse;
    if (!data.access_token) {
      return { error: data.error_description ?? data.error ?? "Token refresh failed", category: "auth" };
    }
    return { token: data.access_token };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), category: "network" };
  }
}

export async function checkGoogle(): Promise<CheckResult> {
  // 12/10: developer token không còn bắt buộc (Google bỏ từ 09/2026); có thì gửi, không có thì bỏ hẳn header.
  const devToken = googleDevToken();
  if (!envSatisfied("GOOGLE_ADS_CLIENT_ID") || !envSatisfied("GOOGLE_ADS_CLIENT_SECRET") || !envSatisfied("GOOGLE_ADS_REFRESH_TOKEN")) {
    return { ok: false, status: "missing_config", failureCategory: "invalid_config", failureReason: "Google Ads env vars incomplete" };
  }

  const tokenResult = await getAccessToken();
  if ("error" in tokenResult) {
    return { ok: false, status: "auth_error", failureCategory: tokenResult.category, failureReason: tokenResult.error };
  }

  // Verify with Google Ads API — list accessible customers.
  //
  // Two independent bugs in the old URL, both would 404 on their own:
  //  1. listAccessibleCustomers is a static, non-customer-scoped method (its
  //     whole purpose is to discover which customer IDs you have access to,
  //     before you'd know any) — confirmed against this project's own
  //     installed google-ads-api client: Client.listAccessibleCustomers()
  //     calls the gRPC method with customer_id: "" (empty), and the REST
  //     mapping documented at .../rpc/v23/CustomerService#listaccessiblecustomers
  //     takes no customer ID in the path either. The old code injected
  //     ${loginCustomerId} into the path — not a valid resource.
  //  2. Hardcoded to v18. This project's installed google-ads-api is ^23.0.0
  //     (see node_modules/google-ads-api/package.json) and its own bundled
  //     docs links point at .../rpc/v23/... — Google fully sunsets old API
  //     versions roughly a year after release, so v18 is very likely retired
  //     from Google's routing entirely by now, which alone would 404 every
  //     path under it regardless of the customer-ID issue.
  try {
    const res = await fetch(
      "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
      {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          ...(devToken ? { "developer-token": devToken } : {}),
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.status === 403 || res.status === 401) {
      return { ok: false, status: "auth_error", failureCategory: "auth", failureReason: `Auth denied (${res.status})` };
    }
    if (!res.ok) {
      return { ok: false, status: "service_error", failureCategory: "server_error", failureReason: `HTTP ${res.status}` };
    }
    const data = await res.json() as { resourceNames?: string[] };
    const count = data.resourceNames?.length ?? 0;
    return { ok: true, status: "healthy", note: `${count} account(s) accessible` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "service_error", failureCategory: "network", failureReason: msg };
  }
}
