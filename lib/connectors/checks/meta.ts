// Meta (Facebook) Ads connector check
import type { CheckResult } from "../types";
import { META_GRAPH_BASE } from "@/lib/meta/graph-version";

export async function checkMeta(): Promise<CheckResult> {
  const token     = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !accountId) {
    return { ok: false, status: "missing_config", failureCategory: "invalid_config", failureReason: "META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set" };
  }

  try {
    const fmtId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const res = await fetch(
      `${META_GRAPH_BASE}/${fmtId}?fields=id,name&access_token=${token}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = await res.json() as { id?: string; name?: string; error?: { code: number; message: string; type?: string } };

    if (!res.ok || data.error) {
      const code = data.error?.code ?? res.status;
      const msg  = data.error?.message ?? `HTTP ${res.status}`;
      if (code === 190 || code === 102 || code === 104) {
        return { ok: false, status: "auth_error", failureCategory: "auth", failureReason: `Token invalid or expired (code ${code})`, note: msg };
      }
      if (res.status === 429) {
        return { ok: false, status: "service_error", failureCategory: "rate_limit", failureReason: "Rate limit hit (429)" };
      }
      return { ok: false, status: "service_error", failureCategory: "server_error", failureReason: msg };
    }

    return { ok: true, status: "healthy", note: data.name ?? data.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { ok: false, status: "service_error", failureCategory: "network", failureReason: `Network error: ${msg}` };
    }
    return { ok: false, status: "service_error", failureCategory: "unknown", failureReason: msg };
  }
}
