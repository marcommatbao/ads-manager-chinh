// ============================================================
// Atomic file writes — shared by every data/*.json store in this app.
// ------------------------------------------------------------
// fs.writeFileSync/writeFile is NOT atomic — a process kill mid-write
// (crash, OOM, redeploy) can leave a truncated/invalid file. The next
// read then hits JSON.parse failure and typically falls back to an empty
// default, silently wiping whatever state that file held. Confirmed live
// 2026-07-21/22: exactly this happened to data/orders-notified.json,
// which made a stale-looking backlog (weeks-old already-notified orders)
// look brand new and flood Teams with duplicate cards.
//
// Write to a temp file in the same directory, then rename() — POSIX
// guarantees rename is atomic, so any reader only ever sees the fully-old
// or fully-new content, never a partial write.
// ============================================================

import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import crypto from "crypto";

function tmpPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
}

/** Sync version — for callers already using fs.writeFileSync. */
export function writeFileAtomicSync(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = tmpPathFor(filePath);
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/** Async version — for callers using fs.promises/fsp.writeFile. */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = tmpPathFor(filePath);
  await fsp.writeFile(tmpPath, content, "utf-8");
  await fsp.rename(tmpPath, filePath);
}
