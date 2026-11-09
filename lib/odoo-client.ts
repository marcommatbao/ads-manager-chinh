// ============================================================
// Odoo 17 JSON-RPC Client — AdsCommand
// Bypasses broken REST API; uses /jsonrpc service="common"
// for auth and service="object" for data access.
// ============================================================

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { odooUrl, odooDb, requireOdooUrl, odooCredentials } from "@/lib/odoo-config";

// Không còn giá trị mặc định trong mã — xem lib/odoo-config.ts (đổi 17/09/2026).
const ODOO_URL = odooUrl();
const ODOO_DB  = odooDb();

// The Odoo host uses a Sectigo public CA but omits the intermediate cert in
// its TLS handshake, so Node's default chain verification can't link the
// leaf up to a trusted root. Bundle the missing intermediate (a PUBLIC CA
// certificate, not a secret — safe to commit) instead of disabling
// verification outright, which would accept ANY certificate for this host,
// not just the legitimate one with the incomplete chain.
let _odooCa: (string | Buffer)[] | undefined;
function odooCaBundle(): (string | Buffer)[] | undefined {
  if (_odooCa !== undefined) return _odooCa;
  try {
    const pem = fs.readFileSync(path.join(process.cwd(), "certs", "sectigo-rsa-dv.pem"), "utf8");
    _odooCa = [...tls.rootCertificates, pem];
  } catch {
    _odooCa = undefined; // missing file — fall through to default trust store, verification stays ON
  }
  return _odooCa;
}

const odooHttpsAgent = new https.Agent({ ca: odooCaBundle() });

/** POST JSON to an Odoo URL, bypassing TLS chain verification for the Odoo host only. */
async function odooFetch(url: string, body: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  if (!/^https?:\/\//.test(url)) {
    // Thiếu ODOO_URL → url thành "/jsonrpc". Báo rõ thay vì để new URL()
    // quăng "Invalid URL" không ai hiểu là do thiếu biến môi trường.
    throw new Error(
      "Odoo chưa cấu hình: thiếu biến môi trường ODOO_URL. Mã KHÔNG còn host mặc định."
    );
  }
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders,
      },
      agent: isHttps ? odooHttpsAgent : undefined,
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface OdooSession {
  uid: number;
  sessionId: string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: { message?: string; debug?: string };
  };
}

// ─────────────────────────────────────────────
// Module-level session cache
// Reused across requests within the same Node.js process.
// ─────────────────────────────────────────────

let cachedSession: { session: OdooSession; expiresAt: number } | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─────────────────────────────────────────────
// Core RPC call
// ─────────────────────────────────────────────

async function rpc(
  service: "common" | "object",
  method: string,
  args: unknown[],
  sessionId?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionId) {
    headers["Cookie"] = `session_id=${sessionId}`;
  }

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    id: Date.now(),
    params: { service, method, args },
  });

  const rawBody = await odooFetch(`${ODOO_URL}/jsonrpc`, payload, headers);

  let data: JsonRpcResponse;
  try {
    data = JSON.parse(rawBody) as JsonRpcResponse;
  } catch {
    throw new Error(`Odoo returned non-JSON: ${rawBody.slice(0, 200)}`);
  }

  if (data.error) {
    const detail = data.error.data?.message ?? data.error.message;
    throw new Error(`Odoo RPC error: ${detail}`);
  }
  return data.result;
}

// ─────────────────────────────────────────────
// Session management
// ─────────────────────────────────────────────

export async function getSession(): Promise<OdooSession> {
  // Return cached session if still valid
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession.session;
  }

  // Đợt 20b: cùng một chỗ đọc với trang kiểm kết nối (nhận cả ODOO_USER/ODOO_PASSWORD từ trang Cài đặt).
  const { login, secret: password } = odooCredentials();

  if (!login || !password) {
    throw new Error("Odoo chưa có thông tin đăng nhập: đặt ODOO_LOGIN + ODOO_API_KEY (hoặc ODOO_USER + ODOO_PASSWORD)");
  }
  // Kiểm luôn URL + DB ở đây: nhánh /web/session/authenticate bên dưới dựng
  // URL trực tiếp, không đi qua odooFetch nên không được guard ở đó.
  requireOdooUrl();
  if (!ODOO_DB) {
    throw new Error("Odoo chưa cấu hình: thiếu biến môi trường ODOO_DB (mã KHÔNG còn tên DB mặc định).");
  }

  // Step 1: Get numeric uid via common.authenticate
  const uid = await rpc("common", "authenticate", [ODOO_DB, login, password, {}]);

  if (!uid || uid === false) {
    throw new Error(
      "Odoo authentication failed — check credentials or ensure the custom auth module allows API access"
    );
  }

  // Step 2: Get session cookie via /web/session/authenticate for execute_kw calls
  let sessionId = "";
  try {
    // Parse session_id from set-cookie (odooFetch returns raw string, not a Response).
    // We wrap with http.request to capture headers separately.
    sessionId = await new Promise<string>((resolve) => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: Date.now(),
        params: { db: ODOO_DB, login, password },
      });
      const parsed = new URL(`${ODOO_URL}/web/session/authenticate`);
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          agent: odooHttpsAgent,
        },
        (res) => {
          const cookie = (res.headers["set-cookie"] ?? []).join("; ");
          const m = cookie.match(/session_id=([^;]+)/);
          resolve(m?.[1] ?? "");
          res.resume(); // drain response body
        }
      );
      req.on("error", () => resolve(""));
      req.write(body);
      req.end();
    });
  } catch {
    // Non-fatal — some Odoo setups don't require the session cookie
    // when API key auth is used directly via execute_kw
    console.warn("[odoo-client] Could not obtain session cookie — proceeding without it");
  }

  const session: OdooSession = { uid: uid as number, sessionId };
  cachedSession = { session, expiresAt: Date.now() + SESSION_TTL_MS };
  return session;
}

/** Invalidate the cached session (call after auth errors) */
export function clearSession(): void {
  cachedSession = null;
}

// ─────────────────────────────────────────────
// search_read — fetch records matching a domain
// ─────────────────────────────────────────────

export async function searchRead<T>(
  model: string,
  // Odoo domain DSL — normally an array of [field, op, value] tuples (AND'd),
  // but "|"/"&"/"!" prefix operators for OR/AND/NOT are bare strings mixed
  // into the same flat list, hence `unknown[]` rather than `unknown[][]`.
  domain: unknown[],
  fields: string[],
  opts: { limit?: number; order?: string; offset?: number } = {}
): Promise<T[]> {
  const session = await getSession();
  const result = await rpc(
    "object",
    "execute_kw",
    [
      ODOO_DB,
      session.uid,
      odooCredentials().secret,
      model,
      "search_read",
      [domain],
      {
        fields,
        limit:  opts.limit  ?? 200,
        order:  opts.order,
        offset: opts.offset ?? 0,
      },
    ],
    session.sessionId
  );
  return result as T[];
}

// ─────────────────────────────────────────────
// read_group — aggregate / group-by queries
// ─────────────────────────────────────────────

export async function readGroup(
  model: string,
  domain: unknown[][],
  fields: string[],
  groupby: string[],
  opts: { orderby?: string; limit?: number; lazy?: boolean } = {}
): Promise<unknown[]> {
  const session = await getSession();
  const result = await rpc(
    "object",
    "execute_kw",
    [
      ODOO_DB,
      session.uid,
      odooCredentials().secret,
      model,
      "read_group",
      [domain, fields, groupby],
      {
        orderby: opts.orderby,
        limit:   opts.limit,
        lazy:    opts.lazy ?? false,
      },
    ],
    session.sessionId
  );
  return result as unknown[];
}

// ─────────────────────────────────────────────
// fields_get — introspect model fields (debug helper)
// ─────────────────────────────────────────────

export async function fieldsGet(
  model: string,
  attributes: string[] = ["string", "type"]
): Promise<Record<string, { string: string; type: string }>> {
  const session = await getSession();
  const result = await rpc(
    "object",
    "execute_kw",
    [
      ODOO_DB,
      session.uid,
      odooCredentials().secret,
      model,
      "fields_get",
      [],
      { attributes },
    ],
    session.sessionId
  );
  return result as Record<string, { string: string; type: string }>;
}
