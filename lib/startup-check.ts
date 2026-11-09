// ============================================================
// Boot-time environment + runtime sanity checks
//
// Call from instrumentation.ts register() so failures surface
// immediately on startup, not on the first request.
//
// Designed to be non-fatal in development (warnings) but fatal
// in production for REQUIRED vars.
// ============================================================

import { isPlaceholderSecret } from "./secret-placeholders";
import { getMissingRequired, getConfiguredGroups } from "@/lib/env";
import { log } from "@/lib/logger";
import { gatewayHalfConfigured } from "./connect/gateway";

const MODULE = "startup";
const isProd = process.env.NODE_ENV === "production";

export interface StartupCheckResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
  configuredGroups: Record<string, string[]>;
}

export function runStartupChecks(): StartupCheckResult {
  const missing  = getMissingRequired();
  const warnings: string[] = [];

  // ── NBA_AUTO_APPLY safety ─────────────────────────────────
  const nbaMode = (process.env.NBA_AUTO_APPLY ?? "dry_run").toLowerCase();
  if (!["off", "dry_run", "on"].includes(nbaMode)) {
    warnings.push(`NBA_AUTO_APPLY="${nbaMode}" is invalid — expected off|dry_run|on; defaulting to dry_run`);
  }
  if (nbaMode === "on") {
    log.warn(MODULE, "NBA_AUTO_APPLY=on — real ad mutations ENABLED; confirm this is intentional");
  }

  // ── Chế độ cổng: MB_CONNECT_URL và MB_CONNECT_INSTALL_KEY phải đi cùng nhau (thiếu một = cấu hình hỏng, không âm
  //    thầm rơi về chế độ dán khoá) ──
  if (gatewayHalfConfigured()) {
    warnings.push("Chỉ đặt một trong hai MB_CONNECT_URL / MB_CONNECT_INSTALL_KEY — chế độ cổng KHÔNG bật; đặt đủ cả hai hoặc bỏ cả hai");
  }

  // ── AUTH_SECRET strength ──────────────────────────────────
  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (authSecret && authSecret.length < 32) {
    warnings.push("AUTH_SECRET is shorter than 32 characters — use a stronger secret");
  }
  if (isPlaceholderSecret(authSecret)) {
    if (isProd) {
      missing.push("AUTH_SECRET"); // treat hardcoded dev default as missing in prod
    } else {
      warnings.push("AUTH_SECRET is using dev placeholder — replace before deploying to production");
    }
  }

  // ── CRON_SECRET / DATA_ENCRYPTION_KEY không được là giá trị mẫu công khai (audit 30/09) ──
  for (const k of ["CRON_SECRET", "DATA_ENCRYPTION_KEY"] as const) {
    if (isPlaceholderSecret(process.env[k])) {
      if (isProd) missing.push(k); else warnings.push(`${k} is a public placeholder from .env.example — replace it`);
    }
  }

  // ── data/ directory writable ──────────────────────────────
  try {
    const fs   = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const dir  = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dir)) {
      warnings.push("data/ directory does not exist — JSON persistence will fail on first write");
    } else {
      const probe = path.join(dir, ".startup-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
    }
  } catch (e) {
    warnings.push(`data/ directory is not writable: ${e instanceof Error ? e.message : e}`);
  }

  // ── Report ────────────────────────────────────────────────
  const configuredGroups = getConfiguredGroups();

  if (missing.length > 0) {
    const action = isProd ? "FATAL" : "WARNING";
    log.error(MODULE, `${action}: required env vars missing: ${missing.join(", ")}`);
    if (isProd) {
      // Surface once clearly in stderr — Next.js will still start but the
      // first request that touches these vars will throw predictably.
      process.stderr.write(
        `\n[AdsCommand] FATAL: Missing required env vars: ${missing.join(", ")}\n` +
        `Set these in your Coolify / Vercel environment configuration.\n\n`,
      );
    }
  }

  for (const w of warnings) {
    log.warn(MODULE, w);
  }

  const groupSummary = Object.entries(configuredGroups)
    .map(([g, keys]) => `${g}(${keys.length})`)
    .join(" ");

  log.info(MODULE, `Startup checks complete — connectors: ${groupSummary || "none"}`, {
    missingRequired: missing.length,
    warnings: warnings.length,
    nbaMode,
  });

  return {
    ok: isProd ? missing.length === 0 : true,
    missing,
    warnings,
    configuredGroups,
  };
}
