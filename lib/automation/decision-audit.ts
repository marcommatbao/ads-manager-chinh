import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";

const FILE = path.join(process.cwd(), "data", "automation-decisions.json");
const MAX = 2_000;

export interface DecisionAuditRecord extends BudgetDecision {
  mode: "evaluate" | "dry_run";
  createdAt: string;
  proposedPayload?: { campaignId: string; currentBudget: number; proposedBudget: number | null };
}

function readAll(): DecisionAuditRecord[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as DecisionAuditRecord[]; } catch { return []; }
}

export function recordDecision(decision: BudgetDecision, mode: DecisionAuditRecord["mode"] = "evaluate"): DecisionAuditRecord {
  const record: DecisionAuditRecord = { ...decision, mode, createdAt: new Date().toISOString(), ...(decision.proposedBudget !== null ? { proposedPayload: { campaignId: decision.campaignId, currentBudget: decision.currentBudget, proposedBudget: decision.proposedBudget } } : {}) };
  const rows = [...readAll(), record].slice(-MAX);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileAtomicSync(FILE, JSON.stringify(rows, null, 2));
  return record;
}

export function recentDecisionAudits(limit = 50): DecisionAuditRecord[] {
  return readAll().slice(-limit).reverse();
}
