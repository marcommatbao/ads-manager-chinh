// ============================================================
// Decision Memory — JSON persistence
//
// data/decision-memory.json        — ring buffer, max 2,000 active entries
// data/decision-memory-YYYY-MM.json — monthly archives (append-only)
//
// All writes use withFileLock.
// ============================================================

import fs from "fs";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import type { DecisionMemoryEntry, DecisionMemoryFile } from "./types";

const DATA_DIR    = path.join(process.cwd(), "data");
const MEMORY_FILE = path.join(DATA_DIR, "decision-memory.json");
const MAX_ENTRIES = 2_000;

function archivePath(): string {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return path.join(DATA_DIR, `decision-memory-${ym}.json`);
}

function ensureDataDir(): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

// ── Readers ───────────────────────────────────────────────

function readFile(): DecisionMemoryFile {
  ensureDataDir();
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")) as DecisionMemoryFile;
    }
  } catch { /* corrupt — start fresh */ }
  return { updatedAt: new Date().toISOString(), entries: [] };
}

export function readAll(): DecisionMemoryEntry[] {
  return readFile().entries;
}

export function readByCompany(company: string): DecisionMemoryEntry[] {
  return readFile().entries.filter(e => e.target.company === company);
}

export function getById(id: string): DecisionMemoryEntry | null {
  return readFile().entries.find(e => e.id === id) ?? null;
}

// ── Writers ───────────────────────────────────────────────

function saveFile(data: DecisionMemoryFile): void {
  ensureDataDir();
  writeFileAtomicSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

/** Append a new entry. Rotates oldest to monthly archive when over MAX_ENTRIES. */
export async function append(entry: DecisionMemoryEntry): Promise<void> {
  await withFileLock(MEMORY_FILE, async () => {
    const data = readFile();
    data.entries.unshift(entry);
    data.updatedAt = new Date().toISOString();

    if (data.entries.length > MAX_ENTRIES) {
      const overflow = data.entries.splice(MAX_ENTRIES);
      archiveEntries(overflow);
    }

    saveFile(data);
  });
}

/** Patch an existing entry by id. Partial update — only provided keys are changed. */
export async function updateEntry(id: string, patch: Partial<DecisionMemoryEntry>): Promise<void> {
  await withFileLock(MEMORY_FILE, async () => {
    const data = readFile();
    const idx  = data.entries.findIndex(e => e.id === id);
    if (idx === -1) return;
    data.entries[idx] = { ...data.entries[idx], ...patch, updatedAt: new Date().toISOString() };
    data.updatedAt = new Date().toISOString();
    saveFile(data);
  });
}

/** Full replace of entries list. Use only when re-writing multiple entries (e.g. bulk window update). */
export async function save(entries: DecisionMemoryEntry[]): Promise<void> {
  await withFileLock(MEMORY_FILE, async () => {
    saveFile({ updatedAt: new Date().toISOString(), entries });
  });
}

// ── Monthly archive ───────────────────────────────────────

function archiveEntries(overflow: DecisionMemoryEntry[]): void {
  if (overflow.length === 0) return;
  const archFile = archivePath();
  try {
    let existing: DecisionMemoryEntry[] = [];
    if (fs.existsSync(archFile)) {
      existing = JSON.parse(fs.readFileSync(archFile, "utf8")) as DecisionMemoryEntry[];
    }
    const merged = [...existing, ...overflow];
    writeFileAtomicSync(archFile, JSON.stringify(merged, null, 2));
  } catch { /* non-fatal — overflow is still removed from active ring buffer */ }
}

// ── ID generator ─────────────────────────────────────────

let _seq = 0;
export function generateId(): string {
  _seq = (_seq + 1) % 10_000;
  const ts  = Date.now().toString(36);
  const seq = _seq.toString(36).padStart(3, "0");
  return `dm_${ts}_${seq}`;
}
