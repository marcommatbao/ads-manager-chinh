import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import type { AutomationPolicy } from "./policy";
import type { SnapshotBinding } from "./snapshot-store";

type Reservation = { approvalId: string; campaignKey: string; company: string; runId: string; day: string; reservedAt: string };
const file = () => path.join(process.cwd(), "data", "automation-execution-reservations.json");

/** Single-process guard. Reservations are not released after uncertain writes. */
export async function reserveExecution(approvalId: string, binding: SnapshotBinding, runId: string, policy: AutomationPolicy, now = new Date()): Promise<void> {
  if (!approvalId || !runId || !Number.isFinite(now.getTime())) throw new Error("INVALID_EXECUTION_RESERVATION");
  await withFileLock(file(), async () => {
    let rows: Reservation[];
    try {
      const data: unknown = JSON.parse(fs.readFileSync(file(), "utf8"));
      if (!Array.isArray(data) || data.some(row => !row?.approvalId || !row?.campaignKey || !Number.isFinite(Date.parse(row.reservedAt)))) throw new Error("corrupt");
      rows = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("EXECUTION_LEDGER_UNAVAILABLE");
      rows = [];
    }
    const campaignKey = JSON.stringify([binding.provider, binding.accountId, binding.campaignId]);
    const day = now.toISOString().slice(0, 10);
    if (rows.some(row => row.approvalId === approvalId)) throw new Error("EXECUTION_ALREADY_RESERVED");
    const previous = rows.filter(row => row.campaignKey === campaignKey);
    if (previous.some(row => row.day === day || now.getTime() - Date.parse(row.reservedAt) < policy.cooldownHours * 3600000)) throw new Error("CAMPAIGN_EXECUTION_LOCKED");
    if (rows.filter(row => row.company === binding.company && row.day === day).length >= policy.maxMutationsPerDay) throw new Error("DAILY_MUTATION_LIMIT");
    if (rows.filter(row => row.company === binding.company && row.runId === runId && row.day === day).length >= policy.maxMutationsPerRun) throw new Error("RUN_MUTATION_LIMIT");
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    writeFileAtomicSync(file(), JSON.stringify([...rows, { approvalId, campaignKey, company: binding.company, runId, day, reservedAt: now.toISOString() }], null, 2));
  });
}
