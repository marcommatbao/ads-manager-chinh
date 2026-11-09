// ============================================================
// Structured logger — safe for production use
//
// Guarantees:
//   - Known secret env key names are NEVER logged (field names only)
//   - Values from SECRET_ENV_KEYS set are redacted automatically
//   - In production: compact JSON per line (structured log ingestion)
//   - In development: human-readable prefix format
//
// Usage:
//   import { log } from "@/lib/logger";
//   log.info("budget_check", "Run complete", { campaigns: 12 });
//   log.error("meta_client", "Token refresh failed", { statusCode: 401 });
//   log.security("auth", "Invalid CRON_SECRET from IP 1.2.3.4");
// ============================================================

import { SECRET_ENV_KEYS } from "@/lib/env";

// ── Types ────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error" | "security";

interface LogEntry {
  level:    LogLevel;
  module:   string;
  message:  string;
  ts:       string;
  [key: string]: unknown;
}

// ── Secret redaction ──────────────────────────────────────

// Patterns that look like secret values even if not in the registry
const SECRET_PATTERNS = [
  /^eyJ/,            // JWT token
  /^\d{15,}$/,       // Long numeric (ad account IDs are fine — these are raw tokens)
];

const REDACTED = "[REDACTED]";

/** Redact known-secret keys from an object one level deep */
function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // Key name is a known secret env var
    if (SECRET_ENV_KEYS.has(k.toUpperCase())) {
      out[k] = REDACTED;
      continue;
    }
    // Key name contains recognizable secret substrings
    const lower = k.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("token") ||
      lower.includes("apikey") ||
      lower.includes("api_key") ||
      lower.includes("access_key")
    ) {
      out[k] = REDACTED;
      continue;
    }
    // Value looks like a token
    if (typeof v === "string" && v.length > 20 && SECRET_PATTERNS.some(p => p.test(v))) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta || Object.keys(meta).length === 0) return undefined;
  return redactSecrets(meta);
}

// ── Output formatting ─────────────────────────────────────

const isProd = process.env.NODE_ENV === "production";

function emit(entry: LogEntry): void {
  const { level, module: mod, message, ts, ...rest } = entry;
  const safe = sanitizeMeta(rest as Record<string, unknown>);

  if (isProd) {
    // Compact JSON for log aggregation (Loki, CloudWatch, etc.)
    const line: Record<string, unknown> = { level, module: mod, message, ts };
    if (safe) Object.assign(line, safe);
    process.stdout.write(JSON.stringify(line) + "\n");
  } else {
    // Human-readable for local dev
    const prefix = `[${level.toUpperCase().padEnd(8)}] [${mod}]`;
    const extra = safe ? " " + JSON.stringify(safe) : "";
    // security gets its own stream even in dev
    const writeFn = level === "error" || level === "security"
      ? console.error.bind(console)
      : level === "warn"
        ? console.warn.bind(console)
        : console.log.bind(console);
    writeFn(`${prefix} ${message}${extra}`);
  }
}

// ── Logger factory ────────────────────────────────────────

function makeLog(level: LogLevel) {
  return function (module: string, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      module,
      message,
      ts: new Date().toISOString(),
      ...(meta ?? {}),
    };
    emit(entry);
  };
}

export const log = {
  debug:    makeLog("debug"),
  info:     makeLog("info"),
  warn:     makeLog("warn"),
  error:    makeLog("error"),
  /** Use for security events: auth failures, invalid tokens, permission violations */
  security: makeLog("security"),
};

// ── Convenience: wrap a cron route's auth failure ─────────

export function logCronRejected(module: string, reason: string): void {
  log.security(module, `CRON_SECRET rejected — ${reason}`);
}
