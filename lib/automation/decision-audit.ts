import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import crypto from "node:crypto";
import type { SnapshotBinding } from "./snapshot-store";
import type { BudgetDecision } from "@/lib/automation/profit-evaluator";

const FILE = path.join(process.cwd(), "data", "automation-decisions.json");
const MAX = 2_000;

export interface DecisionAuditRecord extends BudgetDecision {
  decisionId?: string;
  snapshotRegistryId?: string;
  snapshotPayloadHash?: string;
  binding?: SnapshotBinding;
  expiresAt?: string;
  mode: "evaluate" | "dry_run" | "simulation";
  createdAt: string;
  proposedPayload?: { campaignId: string; currentBudget: number; proposedBudget: number | null };
}

function readAll(): DecisionAuditRecord[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as DecisionAuditRecord[]; } catch { return []; }
}

export function recordDecision(decision: BudgetDecision, mode: DecisionAuditRecord["mode"] = "evaluate", provenance?: Pick<DecisionAuditRecord, "snapshotRegistryId" | "snapshotPayloadHash" | "binding" | "expiresAt">): DecisionAuditRecord {
  const record: DecisionAuditRecord = { ...decision, ...provenance, decisionId: crypto.randomUUID(), mode, createdAt: new Date().toISOString(), ...(decision.proposedBudget !== null ? { proposedPayload: { campaignId: decision.campaignId, currentBudget: decision.currentBudget, proposedBudget: decision.proposedBudget } } : {}) };
  const rows = [...readAll(), record].slice(-MAX);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileAtomicSync(FILE, JSON.stringify(rows, null, 2));
  return record;
}

export function recentDecisionAudits(limit = 50): DecisionAuditRecord[] {
  return readAll().slice(-limit).reverse();
}
