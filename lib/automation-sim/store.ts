// ============================================================
// Automation Sim — run history (data/automation-sim-runs.json)
// JSON + file-lock, cap 30 lần gần nhất.
// ============================================================

import { promises as fsp, readFileSync, existsSync } from "fs";
import { writeFileAtomic } from "@/lib/fs-atomic";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import type { SimulationResult } from "./types";

const FILE = path.join(process.cwd(), "data", "automation-sim-runs.json");
const LOCK_KEY = "automation-sim-runs";
const CAP = 30;

function readRuns(): SimulationResult[] {
  try {
    if (!existsSync(FILE)) return [];
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as { runs?: SimulationResult[] };
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

export async function saveRun(result: SimulationResult): Promise<void> {
  await withFileLock(LOCK_KEY, async () => {
    const runs = [result, ...readRuns()].slice(0, CAP);
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    await writeFileAtomic(FILE, JSON.stringify({ runs }, null, 2));
  });
}

export function getRuns(limit = 10): SimulationResult[] {
  return readRuns().slice(0, limit);
}
