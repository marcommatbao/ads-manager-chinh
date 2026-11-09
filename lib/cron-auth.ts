// ============================================================
// CRON_SECRET authentication helper
//
// Security rules:
//   - Header-only (Authorization: Bearer <secret>) in every environment.
//     Query string (?secret=...) is never accepted — it appears in access
//     logs and shell history. Use: curl -H "Authorization: Bearer $CRON_SECRET" ...
//   - If CRON_SECRET is not set: dev=allow with warning, prod=reject.
// ============================================================

import { timingSafeEqual } from "crypto";
import { isPlaceholderSecret } from "./secret-placeholders";
import { NextRequest, NextResponse } from "next/server";
import { log, logCronRejected } from "@/lib/logger";

const isProd = process.env.NODE_ENV === "production";

export interface CronAuthResult {
  ok: true;
}
export interface CronAuthDenied {
  ok: false;
  response: NextResponse;
}

export type CronAuthCheck = CronAuthResult | CronAuthDenied;

function denied(module: string, reason: string): CronAuthDenied {
  logCronRejected(module, reason);
  return {
    ok: false,
    response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
  };
}

/**
 * Call at the top of every cron route handler.
 *
 *   const auth = checkCronAuth(request, "cron/budget_check");
 *   if (!auth.ok) return auth.response;
 */
/** So sánh thời gian hằng (độ dài khác → false ngay, độ dài khoá không phải bí mật). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkCronAuth(request: NextRequest, module: string): CronAuthCheck {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    if (isProd) {
      return denied(module, "CRON_SECRET not set — rejecting all requests in production");
    }
    log.warn(module, "CRON_SECRET not set — endpoint is unprotected (dev mode only)");
    return { ok: true };
  }

  // Audit 30/09: giá trị mẫu công khai (.env.example) = không có khoá → production từ chối tất cả.
  if (isProd && isPlaceholderSecret(cronSecret)) {
    return denied(module, "CRON_SECRET is a public placeholder — rejecting all requests in production");
  }

  const authHeader = request.headers.get("authorization");
  const fromHeader = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (fromHeader) {
    if (safeEqual(fromHeader, cronSecret)) return { ok: true };
    return denied(module, "invalid Authorization header value");
  }

  // Query-string auth is never accepted, in any environment — it appears in
  // access logs and shell history. Deliberately never read the param.
  return denied(module, "no Authorization header (query-string auth not accepted)");
}
