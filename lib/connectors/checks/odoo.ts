// Odoo ERP connector check — JSON-RPC version call (no auth required)
// then optional login if credentials are present.
import type { CheckResult } from "../types";
import { odooUrl, odooDb, odooCredentials } from "@/lib/odoo-config";

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number | null;
  result?: T;
  error?: { code: number; message: string; data?: { message?: string } };
}

async function odooCall<T>(url: string, method: string, params: unknown): Promise<JsonRpcResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, id: 1, params }),
    signal: AbortSignal.timeout(10000),
  });
  return res.json() as Promise<JsonRpcResponse<T>>;
}

export async function checkOdoo(): Promise<CheckResult> {
  // Không còn mặc định trong mã (đổi 17/09/2026) — xem lib/odoo-config.ts.
  const url  = odooUrl();
  const db   = odooDb();
  if (!url || !db) {
    return { ok: false, status: "missing_config", failureCategory: "invalid_config", failureReason: "ODOO_URL / ODOO_DB chưa cấu hình (mã không còn giá trị mặc định)" };
  }
  // Đợt 20b: đọc ĐÚNG thông tin đăng nhập mà odoo-client dùng (trước đây ODOO_USER/ODOO_PASSWORD — lệch với client).
  // Bỏ https.Agent({rejectUnauthorized:false}): fetch của Node bỏ qua `agent`, dòng đó chưa từng có tác dụng (TLS vẫn kiểm).
  const { login: user, secret: pass } = odooCredentials();

  if (!user || !pass) {
    // Can still check if the server is reachable — partial config
    try {
      const ver = await odooCall<{ server_version?: string }>(
        `${url}/jsonrpc`, "call",
        { service: "common", method: "version", args: [] },
      );
      if (ver.result?.server_version) {
        return { ok: false, status: "warning", failureCategory: "invalid_config", failureReason: "Thiếu ODOO_LOGIN + ODOO_API_KEY (hoặc ODOO_USER + ODOO_PASSWORD) — máy chủ Odoo trả lời nhưng chưa đăng nhập được", note: `Odoo ${ver.result.server_version}` };
      }
    } catch { /* fall through */ }
    return { ok: false, status: "missing_config", failureCategory: "invalid_config", failureReason: "Chưa có ODOO_LOGIN + ODOO_API_KEY (hoặc ODOO_USER + ODOO_PASSWORD)" };
  }

  try {
    const loginRes = await odooCall<number | false>(
      `${url}/jsonrpc`, "call",
      { service: "common", method: "authenticate", args: [db, user, pass, {}] },
    );

    if (loginRes.error) {
      const msg = loginRes.error.data?.message ?? loginRes.error.message;
      return { ok: false, status: "auth_error", failureCategory: "auth", failureReason: `Login failed: ${msg}` };
    }
    if (!loginRes.result) {
      return { ok: false, status: "auth_error", failureCategory: "auth", failureReason: "Login returned false — wrong credentials or DB" };
    }

    return { ok: true, status: "healthy", note: `uid=${loginRes.result}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return { ok: false, status: "service_error", failureCategory: "network", failureReason: `Cannot reach ${url}: ${msg}` };
    }
    return { ok: false, status: "service_error", failureCategory: "unknown", failureReason: msg };
  }
}
