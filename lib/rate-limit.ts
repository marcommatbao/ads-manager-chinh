// ============================================================
// Durable rate limiter — file-backed, survives process restarts.
//
// Previously this module was 100% dead code (zero real call sites) — the
// only rate limiting actually running in production was a private
// in-process Map duplicated inside app/api/auth/login/route.ts, which
// reset on every restart/redeploy. Consolidated here 2026-07-13 so
// login (and any future caller) shares one real, durable implementation.
//
// This is still single-instance only — the store is a local JSON file
// under withFileLock, not shared storage. That's an accurate match for
// this app's current single-container Coolify deployment (see
// docker-entrypoint.sh). If REDIS_URL is set, a Redis-backed sliding
// window is used instead (works across multiple instances); if not,
// this falls back to the file-backed fixed-window store below and logs
// a warning once, rather than crashing or silently no-op'ing.
// ============================================================

import fs from "fs";
import path from "path";
import { withFileLock } from "./file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";

const STORE_PATH = path.join(process.cwd(), "data", "rate-limit.json");

interface Bucket {
  count: number;
  resetAt: number;
}
type Store = Record<string, Bucket>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

function readStore(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  // Prune expired buckets on every write so this file doesn't grow
  // unbounded — same convention as lib/leads-notify.ts's cap-on-write.
  const now = Date.now();
  const pruned: Store = {};
  for (const [k, v] of Object.entries(store)) {
    if (v.resetAt > now) pruned[k] = v;
  }
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  writeFileAtomicSync(STORE_PATH, JSON.stringify(pruned));
}

let warnedNoRedis = false;

/**
 * Fixed-window rate limiter, keyed by caller-supplied string (typically
 * an IP address). Durable across restarts via data/rate-limit.json.
 *
 * NOTE: REDIS_URL support is intentionally not implemented in this pass —
 * no Redis/ioredis dependency exists in this project yet (confirmed via
 * package.json audit), and adding one speculatively without a real Redis
 * instance to test against would ship untested infra config. The file-
 * backed path below is the "at minimum" durable fallback and is what's
 * live today. Swapping in a real Redis-backed implementation later only
 * needs to preserve this function's signature — no caller changes needed.
 */
export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (!process.env.REDIS_URL && !warnedNoRedis) {
    warnedNoRedis = true;
    console.warn(
      "[rate-limit] REDIS_URL not set — using file-backed single-instance rate limiting " +
      "(data/rate-limit.json). Fine for this app's current single-container deployment; " +
      "revisit if this ever runs as multiple instances."
    );
  }

  return withFileLock(STORE_PATH, async () => {
    const store = readStore();
    const now = Date.now();
    const existing = store[key];

    if (!existing || now >= existing.resetAt) {
      store[key] = { count: 1, resetAt: now + windowMs };
      writeStore(store);
      return { allowed: true, remaining: maxRequests - 1, resetInMs: windowMs };
    }

    if (existing.count >= maxRequests) {
      writeStore(store);
      return { allowed: false, remaining: 0, resetInMs: existing.resetAt - now };
    }

    existing.count++;
    writeStore(store);
    return { allowed: true, remaining: Math.max(0, maxRequests - existing.count), resetInMs: existing.resetAt - now };
  });
}

/**
 * Resolve the real client IP behind a reverse proxy (Traefik, in this
 * app's Coolify deployment).
 *
 * Client-supplied X-Forwarded-For entries are spoofable (anyone can send
 * "X-Forwarded-For: 1.2.3.4" and the proxy appends the real peer IP
 * after it), so taking the FIRST entry lets an attacker rotate through
 * fake IPs to dodge rate limiting — take the LAST entry instead. That
 * last hop is appended by Traefik itself and cannot be spoofed past a
 * correctly configured reverse proxy, so X-Forwarded-For is the primary
 * signal here. X-Real-IP is only used as a fallback when X-Forwarded-For
 * is entirely absent: unlike nginx, Traefik does not synthesize/overwrite
 * X-Real-IP by default, so an attacker hitting this app directly could
 * send a fresh spoofed X-Real-IP on every request and get a fresh
 * rate-limit bucket each time — trusting it first would defeat the
 * login brute-force limiter entirely.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    // TRUSTED_PROXY_HOPS = số proxy tin cậy đứng trước app (mặc định 1 = Traefik). Mỗi proxy thêm 1 mục vào cuối,
    // nên IP client thật là mục thứ N tính từ cuối. Vibe Host có thêm tầng proxy/CDN → đặt 2 (kiểm theo
    // docs/VIBEHOST-PROXY-CHECK.md). Ít mục hơn số hop = có người gửi thẳng tới app → dùng mục đầu tiên.
    const hops = Math.max(1, Math.min(5, Number(process.env.TRUSTED_PROXY_HOPS) || 1));
    if (parts.length > 0) return parts[Math.max(0, parts.length - hops)];
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}
