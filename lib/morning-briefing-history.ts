// ============================================================
// Morning Briefing History — file-backed audit trail
//
// Briefings are immutable snapshots. The store is intentionally small and
// bounded so the dashboard can show recent history without turning JSON into
// an unbounded database. Writes are atomic and serialized like other stores.
// ============================================================

import fs from "fs";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import type { MorningBriefing } from "@/lib/morning-briefing";

const HISTORY_FILE = path.join(process.cwd(), "data", "morning-briefing-history.json");
const MAX_ENTRIES = 90;

export interface MorningBriefingHistoryFile {
  updatedAt: string;
  entries: MorningBriefing[];
}

// Only application-owned diagnostic wording may cross the history boundary.
// Old provider messages are discarded, not heuristically redacted.
const GAP_SOURCES = ["số liệu hôm qua", "số liệu 7 ngày", "số liệu tháng", "danh sách chiến dịch", "insights theo chiến dịch"];
const SAFE_NOTES = new Set([
  "Không lấy được dữ liệu nguồn",
  "Không lấy được danh sách chiến dịch",
  "Không lấy được insights theo chiến dịch",
  "Bị chặn vì nguồn dữ liệu quan trọng không đầy đủ",
  "Bản rút gọn từ số liệu thô, không qua AI",
]);

function normalizeDiagnostics(briefing: MorningBriefing): MorningBriefing {
  return {
    ...briefing,
    dataGaps: (briefing.dataGaps ?? []).map((gap) => {
      const source = GAP_SOURCES.find((label) => typeof gap === "string" && gap.startsWith(`${label}:`));
      return source ? `${source}: Không lấy được dữ liệu nguồn` : "Không lấy được dữ liệu nguồn";
    }),
    evidence: (briefing.evidence ?? []).map((item) => ({
      ...item,
      note: item.note === undefined || SAFE_NOTES.has(item.note) ? item.note : "Không lấy được dữ liệu nguồn",
    })),
  };
}

function readFile(): MorningBriefingHistoryFile {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as Partial<MorningBriefingHistoryFile>;
      return {
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
        entries: Array.isArray(parsed.entries) ? parsed.entries.map(normalizeDiagnostics) : [],
      };
    }
  } catch {
    // A corrupt history file must not prevent today's briefing from rendering.
  }
  return { updatedAt: new Date(0).toISOString(), entries: [] };
}

export function getBriefingHistory(limit = 30): MorningBriefing[] {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), MAX_ENTRIES));
  return readFile().entries.slice(0, safeLimit);
}

/** Store one snapshot, deduplicated by generatedAt to make retries safe. */
export async function saveBriefing(briefing: MorningBriefing): Promise<void> {
  await withFileLock(HISTORY_FILE, async () => {
    const current = readFile();
    const entries = [
      normalizeDiagnostics(briefing),
      ...current.entries.filter((entry) => entry.generatedAt !== briefing.generatedAt),
    ].slice(0, MAX_ENTRIES);
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    writeFileAtomicSync(
      HISTORY_FILE,
      JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2),
    );
  });
}
