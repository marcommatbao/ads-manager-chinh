// ============================================================
// Connector health engine
// - resolveConnectorRecord()  — build a health record from env + optional live check
// - runLiveCheck()            — run the live test for one connector
// - refreshAllConnectors()    — env-scan all connectors, persist results
// ============================================================

import { maskSecret } from "@/lib/settings/validators/credentials";
import { saveHealthRecord, saveHealthRecords, getStoredHealth } from "./health-store";
import { CONNECTOR_REGISTRY, getDescriptor, isConnectorDisabled } from "./registry";
import type { ConnectorHealthRecord, ConnectorId, CheckResult, ConnectorStatus } from "./types";
import { envSatisfied } from "@/lib/connect/env-satisfied";

// ── Individual check dispatch ─────────────────────────────

async function runCheck(id: ConnectorId): Promise<CheckResult> {
  switch (id) {
    case "meta": {
      const { checkMeta } = await import("./checks/meta");
      return checkMeta();
    }
    case "google_ads": {
      const { checkGoogle } = await import("./checks/google");
      return checkGoogle();
    }
    case "gemini": {
      const { checkGemini } = await import("./checks/gemini");
      return checkGemini();
    }
    case "telegram": {
      const { checkTelegram } = await import("./checks/telegram");
      return checkTelegram();
    }
    case "odoo": {
      const { checkOdoo } = await import("./checks/odoo");
      return checkOdoo();
    }
    default: {
      // passive env-only check
      const { passiveEnvCheck } = await import("./checks/passive");
      return passiveEnvCheck(id);
    }
  }
}

// ── Masked config builder ─────────────────────────────────

function buildMaskedConfig(id: ConnectorId): Record<string, string> {
  const desc   = getDescriptor(id);
  const secret = new Set(desc.secretEnv ?? []);
  const out: Record<string, string> = {};

  for (const key of [...desc.requiredEnv, ...(desc.optionalEnv ?? [])]) {
    const val = process.env[key];
    if (!val) continue;
    // Secret env vars → masked; non-secret → show as-is (e.g. customer IDs, URLs)
    out[key] = secret.has(key) ? maskSecret(val) : val;
  }
  return out;
}

// ── Config completeness ───────────────────────────────────

function computeConfigCompleteness(id: ConnectorId): { configComplete: boolean; partialConfig: boolean } {
  const desc    = getDescriptor(id);
  const present = desc.requiredEnv.filter(k => envSatisfied(k)).length;
  const total   = desc.requiredEnv.length;

  if (total === 0) return { configComplete: true, partialConfig: false };

  return {
    configComplete: present === total,
    partialConfig:  present > 0 && present < total,
  };
}

// ── Public API ────────────────────────────────────────────

/**
 * Run a live check for one connector, persist the result, and return the full record.
 * This is the "Test Connection" action.
 */
export async function runLiveCheck(id: ConnectorId): Promise<ConnectorHealthRecord> {
  if (isConnectorDisabled(id)) {
    const record: ConnectorHealthRecord = {
      id, status: "disabled", configComplete: false, partialConfig: false,
      lastChecked: new Date().toISOString(), lastSuccess: null, lastFailure: null,
      failureReason: "Disabled via env", failureCategory: null, maskedConfig: {},
    };
    await saveHealthRecord(record);
    return record;
  }

  const now     = new Date().toISOString();
  const stored  = getStoredHealth(id);
  const { configComplete, partialConfig } = computeConfigCompleteness(id);
  const result  = await runCheck(id);

  const record: ConnectorHealthRecord = {
    id,
    status:          result.status,
    configComplete,
    partialConfig,
    lastChecked:     now,
    lastSuccess:     result.ok ? now : (stored?.lastSuccess ?? null),
    lastFailure:     result.ok ? (stored?.lastFailure ?? null) : now,
    failureReason:   result.ok ? null : (result.failureReason ?? null),
    failureCategory: result.ok ? null : (result.failureCategory ?? null),
    maskedConfig:    buildMaskedConfig(id),
    note:            result.note,
    needsRefresh:    detectNeedsRefresh(id, stored),
  };

  await saveHealthRecord(record);
  return record;
}

/**
 * Record the outcome of a REAL call that just happened (not a synthetic test).
 *
 * Why this exists: the health snapshot is env-based, and a live check only runs
 * when an admin clicks "Test". A bot token that gets revoked therefore stays
 * "healthy" on screen — the env var is still set — while every alert fails with
 * nothing but a line in the container log to show for it. That is exactly what
 * happened to Telegram: `[Telegram] Send failed: Unauthorized` repeating in
 * production while Settings showed nothing wrong.
 *
 * Real traffic is better evidence than a synthetic probe, so the send paths
 * report what actually happened and the same UI surfaces it. Failures are
 * always recorded; successes are throttled, since a healthy connector sending
 * every few minutes does not need a disk write each time.
 */
const SUCCESS_RECORD_THROTTLE_MS = 15 * 60_000;

export async function recordLiveOutcome(
  id: ConnectorId,
  result: CheckResult,
): Promise<void> {
  try {
    const stored = getStoredHealth(id);

    if (result.ok && stored?.status === result.status && stored?.lastSuccess) {
      const age = Date.now() - Date.parse(stored.lastSuccess);
      if (Number.isFinite(age) && age < SUCCESS_RECORD_THROTTLE_MS) return;
    }

    const now = new Date().toISOString();
    const { configComplete, partialConfig } = computeConfigCompleteness(id);

    await saveHealthRecord({
      id,
      status:          result.status,
      configComplete,
      partialConfig,
      lastChecked:     now,
      lastSuccess:     result.ok ? now : (stored?.lastSuccess ?? null),
      lastFailure:     result.ok ? (stored?.lastFailure ?? null) : now,
      failureReason:   result.ok ? null : (result.failureReason ?? null),
      failureCategory: result.ok ? null : (result.failureCategory ?? null),
      maskedConfig:    buildMaskedConfig(id),
      note:            result.note,
      needsRefresh:    detectNeedsRefresh(id, stored),
    });
  } catch (err) {
    // Health bookkeeping must never break the thing it is observing.
    console.warn("[connectors] could not record live outcome:", err instanceof Error ? err.message : err);
  }
}

/**
 * Evaluate config completeness for all connectors WITHOUT making live API calls.
 * Fast — used on page load to show immediate state before any test.
 */
export function snapshotAllConnectors(): Record<ConnectorId, ConnectorHealthRecord> {
  const now = new Date().toISOString();
  const out: Partial<Record<ConnectorId, ConnectorHealthRecord>> = {};

  for (const desc of CONNECTOR_REGISTRY) {
    const id = desc.id;

    if (isConnectorDisabled(id)) {
      out[id] = {
        id, status: "disabled", configComplete: false, partialConfig: false,
        lastChecked: now, lastSuccess: null, lastFailure: null,
        failureReason: "Disabled via env", failureCategory: null, maskedConfig: {},
      };
      continue;
    }

    const { configComplete, partialConfig } = computeConfigCompleteness(id);
    const stored = getStoredHealth(id);

    let derivedStatus: ConnectorStatus;
    if (!configComplete && !partialConfig) {
      derivedStatus = "missing_config";
    } else if (partialConfig) {
      derivedStatus = "warning";
    } else {
      // configComplete — trust stored status if recent (<1h), else "warning" (needs test)
      const lastCheck = stored?.lastChecked ? Date.parse(stored.lastChecked) : 0;
      const ageMs     = Date.now() - lastCheck;
      derivedStatus   = stored?.status && ageMs < 3_600_000 ? stored.status : "warning";
    }

    out[id] = {
      id,
      status:          derivedStatus,
      configComplete,
      partialConfig,
      lastChecked:     stored?.lastChecked ?? null,
      lastSuccess:     stored?.lastSuccess ?? null,
      lastFailure:     stored?.lastFailure ?? null,
      // Keep the stored reason for EVERY unhealthy status, not just
      // missing_config/warning. It used to be nulled for auth_error and
      // service_error — exactly the two states where the reason is the only
      // actionable part ("Bot token bị Telegram từ chối — cần cấp lại
      // TELEGRAM_BOT_TOKEN"), leaving the UI showing a bare red label with
      // nothing to act on.
      failureReason:   derivedStatus === "healthy" || derivedStatus === "disabled"
                         ? null
                         : (stored?.failureReason ?? null),
      failureCategory: stored?.failureCategory ?? null,
      maskedConfig:    buildMaskedConfig(id),
      needsRefresh:    detectNeedsRefresh(id, stored),
      note:            stored?.note,
    };
  }

  return out as Record<ConnectorId, ConnectorHealthRecord>;
}

/**
 * Run live checks for all connectors concurrently and persist.
 * Heavy — should only be triggered on demand (not on every page load).
 */
export async function refreshAllConnectors(): Promise<Record<ConnectorId, ConnectorHealthRecord>> {
  const results = await Promise.allSettled(
    CONNECTOR_REGISTRY.map(d => runLiveCheck(d.id)),
  );

  const out: Partial<Record<ConnectorId, ConnectorHealthRecord>> = {};
  results.forEach((r, i) => {
    const def = CONNECTOR_REGISTRY[i];
    const id = def.id;
    if (r.status === "fulfilled") {
      out[id] = r.value;
      return;
    }

    // Kết nối nào ném lỗi bất ngờ thì trước đây BIẾN MẤT khỏi bảng health —
    // người dùng mở Settings → Kết nối thấy thiếu hẳn một dòng và hiểu là
    // "không có gì bất thường". Đúng kiểu sự cố đã xảy ra thật với Telegram:
    // log production báo lỗi liên tục mà màn hình không hiện gì.
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.error(`[connectors] health-check ${id} ném lỗi:`, reason);
    out[id] = {
      id,
      status: "service_error",
      configComplete: false,
      partialConfig: false,
      lastChecked: new Date().toISOString(),
      lastSuccess: null,
      lastFailure: new Date().toISOString(),
      failureReason: `Phép kiểm sức khoẻ ném lỗi: ${reason}`,
      failureCategory: null,
      maskedConfig: {},
    };
  });

  return out as Record<ConnectorId, ConnectorHealthRecord>;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Heuristic: if last success is > 23 hours ago for token-based connectors, flag for refresh.
 */
function detectNeedsRefresh(id: ConnectorId, stored: ConnectorHealthRecord | null): boolean {
  if (!stored?.lastSuccess) return false;
  if (!["meta", "google_ads", "gemini"].includes(id)) return false;
  const age = Date.now() - Date.parse(stored.lastSuccess);
  return age > 23 * 3_600_000; // 23 hours
}
