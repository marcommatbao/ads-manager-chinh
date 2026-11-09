// ============================================================
// Auto-Apply settings — which Improvement actions may be applied
// automatically, and whether runs actually mutate or only recommend.
//
// Before this module the only control was the env var
// IMPROVEMENTS_AUTO_APPLY_MODE, which needs a redeploy to change and is
// all-or-nothing across every action type. The Auto-Apply settings page
// used to toggle three rule ids (AUTO_PAUSE_WASTED_KW, ...) that existed
// nowhere in the backend — the toggles persisted nothing and controlled
// nothing. These are the real action names emitted by
// app/api/improvements/route.ts and executed by applyOne().
//
// Env stays the default so existing deploys behave exactly as before;
// a stored mode overrides it once someone sets one in the UI.
// ============================================================
import fs from "fs";
import path from "path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";

const DATA_PATH = path.join(process.cwd(), "data", "auto-apply-settings.json");

export type Company = string;
export type AutoApplyMode = "dry_run" | "auto_apply";

/**
 * Real mutations applyOne() can perform. Kept identical to the cron's
 * AUTO_APPLY_ACTIONS allowlist — IMPROVE_PMAX_ASSETS/FIX_AD_STRENGTH are
 * excluded because their "apply" is a redirect to Creative AI Studio, not
 * a real fix, and RESOLVE_ALERT is not an ads mutation.
 */
export const AUTO_APPLY_ACTIONS = [
  "PAUSE_KEYWORD",
  "ADD_NEGATIVE",
  "UPDATE_BUDGET",
  "UPDATE_TARGET_CPA",
  "UPDATE_DEVICE_BID",
] as const;

export type AutoApplyAction = (typeof AUTO_APPLY_ACTIONS)[number];

export interface AutoApplyCompanySettings {
  /** Action types allowed to run automatically. */
  enabledRules: AutoApplyAction[];
  /** null = inherit IMPROVEMENTS_AUTO_APPLY_MODE. */
  mode: AutoApplyMode | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

type StoreShape = Partial<Record<Company, AutoApplyCompanySettings>>;

export function envMode(): AutoApplyMode {
  return process.env.IMPROVEMENTS_AUTO_APPLY_MODE === "auto_apply" ? "auto_apply" : "dry_run";
}

function defaults(): AutoApplyCompanySettings {
  // Default OFF: enabling a real keyword/budget mutation is an explicit
  // decision, matching this app's dry_run-by-default convention.
  return { enabledRules: [], mode: null, updatedAt: null, updatedBy: null };
}

function isAction(v: unknown): v is AutoApplyAction {
  return typeof v === "string" && (AUTO_APPLY_ACTIONS as readonly string[]).includes(v);
}

function readStore(): StoreShape {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) as StoreShape;
  } catch {
    return {};
  }
}

export function getAutoApplySettings(company: Company): AutoApplyCompanySettings {
  const stored = readStore()[company];
  if (!stored) return defaults();
  return {
    enabledRules: Array.isArray(stored.enabledRules) ? stored.enabledRules.filter(isAction) : [],
    mode: stored.mode === "auto_apply" || stored.mode === "dry_run" ? stored.mode : null,
    updatedAt: stored.updatedAt ?? null,
    updatedBy: stored.updatedBy ?? null,
  };
}

/** Mode actually in force: stored value if set, otherwise the env default. */
export function effectiveMode(company: Company): AutoApplyMode {
  return getAutoApplySettings(company).mode ?? envMode();
}

/** An action runs automatically only if it is both allowlisted and enabled here. */
export function isRuleEnabled(company: Company, action: string): boolean {
  return isAction(action) && getAutoApplySettings(company).enabledRules.includes(action);
}

export async function saveAutoApplySettings(
  company: Company,
  patch: { enabledRules?: string[]; mode?: AutoApplyMode | null },
  updatedBy: string,
): Promise<AutoApplyCompanySettings> {
  return withFileLock(DATA_PATH, async () => {
    const store = readStore();
    const current = store[company] ?? defaults();

    const next: AutoApplyCompanySettings = {
      enabledRules: patch.enabledRules
        ? [...new Set(patch.enabledRules.filter(isAction))]
        : current.enabledRules,
      mode: patch.mode !== undefined ? patch.mode : current.mode,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    store[company] = next;
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    writeFileAtomicSync(DATA_PATH, JSON.stringify(store, null, 2));
    return next;
  });
}
