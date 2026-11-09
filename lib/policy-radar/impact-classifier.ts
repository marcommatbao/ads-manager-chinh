// ─────────────────────────────────────────────
// Policy Radar — Rule-based impact classifier
// Deterministic category → default severity/affected-area mapping.
// Kept rule-based (not AI) so severity is reproducible and auditable;
// admins can still override per item.
// ─────────────────────────────────────────────

import type {
  PolicyAffectedArea,
  PolicyCategory,
  PolicyChangeType,
  PolicySeverity,
} from "./types";

interface CategoryDefaults {
  severity: PolicySeverity;
  affectedAreas: PolicyAffectedArea[];
}

const CATEGORY_DEFAULTS: Record<PolicyCategory, CategoryDefaults> = {
  enforcement: { severity: "high", affectedAreas: ["account_health", "ad_copy"] },
  measurement: { severity: "high", affectedAreas: ["tracking_measurement", "reporting"] },
  account_health: { severity: "high", affectedAreas: ["account_health"] },
  targeting: { severity: "medium", affectedAreas: ["targeting"] },
  creative: { severity: "medium", affectedAreas: ["creative_ai", "ad_copy"] },
  automation: { severity: "medium", affectedAreas: ["automation_rules"] },
  policy: { severity: "medium", affectedAreas: ["ad_copy", "legal_review"] },
  terms: { severity: "medium", affectedAreas: ["legal_review"] },
  product_update: { severity: "low", affectedAreas: ["reporting"] },
};

// Escalate severity by one step for change types that carry immediate
// enforcement/liability weight, regardless of category.
const ESCALATING_CHANGE_TYPES: PolicyChangeType[] = ["enforcement_change", "new_policy"];

const SEVERITY_ORDER: PolicySeverity[] = ["low", "medium", "high"];

function escalate(severity: PolicySeverity): PolicySeverity {
  const idx = SEVERITY_ORDER.indexOf(severity);
  return SEVERITY_ORDER[Math.min(idx + 1, SEVERITY_ORDER.length - 1)];
}

export interface ClassificationInput {
  category: PolicyCategory;
  changeType: PolicyChangeType;
}

export interface ClassificationResult {
  severity: PolicySeverity;
  affectedAreas: PolicyAffectedArea[];
}

export function classifyImpact({ category, changeType }: ClassificationInput): ClassificationResult {
  const base = CATEGORY_DEFAULTS[category];
  const severity = ESCALATING_CHANGE_TYPES.includes(changeType) ? escalate(base.severity) : base.severity;
  return { severity, affectedAreas: [...base.affectedAreas] };
}
