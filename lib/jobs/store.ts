// ============================================================
// Job state persistence
// - data/job-control.json   — pause/resume controls per job
// - data/job-history.json   — rolling run history per job
// Both use withFileLock for safe concurrent writes.
// ============================================================

import fs from "fs";
import { RUNNING_JOBS } from "./execution-state";
import { CHECKPOINT_MAX_DURATION_MS } from "./checkpoint-visibility";
import path from "path";
import { withFileLock } from "@/lib/file-lock";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { hasModule } from "@/lib/companies";
import { JOB_COMPANY, JOB_MODULE, companyOfJob, moduleOfJob } from "@/lib/companies/modules";
import { companyIds } from "@/lib/companies/registry";
import { setupPending } from "@/lib/setup/state";
import { JOBS_BY_ID } from "./registry";
import type {
  JobId,
  JobControlFile,
  JobControlRecord,
  JobHistoryFile,
  JobRunRecord,
} from "./types";

const CONTROL_FILE = path.join(process.cwd(), "data", "job-control.json");
const HISTORY_FILE = path.join(process.cwd(), "data", "job-history.json");

const MAX_HISTORY_PER_JOB = 50;

// ── Control file ──────────────────────────────────────────

function readControlFile(): JobControlFile {
  if (!fs.existsSync(CONTROL_FILE)) return { updatedAt: new Date().toISOString(), controls: {} };
  const file = JSON.parse(fs.readFileSync(CONTROL_FILE, "utf8")) as JobControlFile;
  if (!file || !file.controls || typeof file.controls !== "object" || Array.isArray(file.controls)
    || Object.values(file.controls).some(c => !c || typeof c.enabled !== "boolean")) throw new Error("job_control_invalid");
  return file;
}

/** Job TẮT bằng cấu hình (JOBS_DISABLED="kpi_report,alerts_digest") — user 29/09 không cần 2 báo cáo Telegram. Tính như tạm
 *  dừng (không chạy, không bị canh lỗi); bật lại = bỏ khỏi biến + deploy. Ưu tiên hơn nút Tạm dừng trong Cài đặt → Jobs. */
export function envDisabledJobs(): Set<string> {
  return new Set((process.env.JOBS_DISABLED ?? "").split(",").map((x) => x.trim()).filter(Boolean));
}
const envPaused = (id: JobId): JobControlRecord => ({ jobId: id, enabled: false, pausedAt: null, pausedBy: "cấu hình JOBS_DISABLED", pauseReason: "Tắt bằng biến môi trường JOBS_DISABLED" });

export function getJobControl(id: JobId): JobControlRecord {
  if (envDisabledJobs().has(id)) return envPaused(id);
  // Đợt 21 A6: bản cài MỚI đang thiết lập (SETUP_WIZARD=on, chưa hoàn tất) → mọi job tự động dừng (chưa có công ty / khoá thật,
  // chạy chỉ sinh lỗi). Trừ query_smoke — trình thiết lập dùng nó để tự kiểm. Bản Mắt Bão không bật → không đổi.
  if (id !== "query_smoke" && setupPending()) return { jobId: id, enabled: false, pausedAt: null, pausedBy: "thiết lập", pauseReason: "Bản cài đang thiết lập lần đầu — job tự chạy sau khi bấm Hoàn tất" };
  // Đợt 21 A2: job thuộc mô-đun TẮT ở bản cài → không chạy (bản Mắt Bão bật đủ mô-đun → không đổi).
  const mod = moduleOfJob(id);
  if (mod && !hasModule(mod)) return { jobId: id, enabled: false, pausedAt: null, pausedBy: "mô-đun", pauseReason: `Mô-đun "${mod}" không bật ở bản cài này` };
  // Đợt 25: job của một công ty cụ thể (Quality Score MBC / MBI) — bản cài không có công ty đó thì không chạy.
  const co = companyOfJob(id);
  if (co && !companyIds().includes(co)) return { jobId: id, enabled: false, pausedAt: null, pausedBy: "công ty", pauseReason: `Bản cài này không có công ty ${co}` };
  const file = readControlFile();
  return file.controls[id] ?? { jobId: id, enabled: JOBS_BY_ID[id]?.defaultEnabled !== false, pausedAt: null, pausedBy: null, pauseReason: null };
}

/** Đợt 25: job có thuộc bản cài này không (mô-đun bật + công ty có mặt). Trang Cron Jobs / Sức khoẻ ẨN job không thuộc bản cài. */
export function jobInInstall(id: string): boolean {
  const mod = moduleOfJob(id), co = companyOfJob(id);
  return (!mod || hasModule(mod)) && (!co || companyIds().includes(co));
}

export function getAllJobControls(): Partial<Record<JobId, JobControlRecord>> {
  const c = { ...readControlFile().controls };
  for (const desc of Object.values(JOBS_BY_ID)) if (desc.defaultEnabled === false) c[desc.id] = getJobControl(desc.id);
  for (const [id, mod] of Object.entries(JOB_MODULE)) if (mod && !hasModule(mod)) c[id as JobId] = getJobControl(id as JobId);
  for (const [id, co] of Object.entries(JOB_COMPANY)) if (co && !companyIds().includes(co)) c[id as JobId] = getJobControl(id as JobId);
  for (const id of envDisabledJobs()) c[id as JobId] = envPaused(id as JobId);
  if (setupPending()) for (const id of Object.keys(JOBS_BY_ID)) if (id !== "query_smoke") c[id as JobId] = getJobControl(id as JobId);
  return c;
}

export async function saveJobControl(record: JobControlRecord): Promise<void> {
  await withFileLock(CONTROL_FILE, async () => {
    const file = readControlFile();
    file.updatedAt = new Date().toISOString();
    file.controls[record.jobId] = record;
    fs.mkdirSync(path.dirname(CONTROL_FILE), { recursive: true });
    await writeFileAtomic(CONTROL_FILE, JSON.stringify(file, null, 2));
  });
}

// ── History file ──────────────────────────────────────────

function readHistoryFile(): JobHistoryFile {
  if (!fs.existsSync(HISTORY_FILE)) return { updatedAt: new Date().toISOString(), history: {} };
  // Corrupt history must never be interpreted as an empty successful store.
  const file = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as JobHistoryFile;
  if (!file || typeof file.history !== "object" || !file.history || Array.isArray(file.history)
    || Object.values(file.history).some(records => !Array.isArray(records) || records.some(r => !r || typeof r.runId !== "string" || typeof r.status !== "string"))) {
    throw new Error("job_history_invalid");
  }
  return file;
}

export function getJobHistory(id: JobId, limit = 10): JobRunRecord[] {
  const file = readHistoryFile();
  const records = file.history[id] ?? [];
  return records.slice(-limit).reverse(); // newest first
}

export function getAllJobHistory(): Partial<Record<JobId, JobRunRecord[]>> {
  return readHistoryFile().history;
}

export async function appendJobRun(record: JobRunRecord): Promise<void> {
  await withFileLock(HISTORY_FILE, async () => {
    const file = readHistoryFile();
    const existing = file.history[record.jobId] ?? [];
    existing.push(record);
    // Keep only last MAX_HISTORY_PER_JOB entries
    file.history[record.jobId] = existing.slice(-MAX_HISTORY_PER_JOB);
    file.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    await writeFileAtomic(HISTORY_FILE, JSON.stringify(file, null, 2));
  });
}

// Update a record in-place (e.g. finalize a "running" record)
export async function updateJobRun(
  jobId: JobId,
  runId: string,
  patch: Partial<JobRunRecord>,
): Promise<void> {
  await withFileLock(HISTORY_FILE, async () => {
    const file = readHistoryFile();
    const history = file.history[jobId] ?? [];
    const idx = history.findLastIndex(r => r.runId === runId);
    if (idx !== -1) {
      // A late worker completion cannot erase an admin acknowledgement.
      if (history[idx].recovery) return;
      history[idx] = { ...history[idx], ...patch };
      file.history[jobId] = history;
      file.updatedAt = new Date().toISOString();
      fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
      await writeFileAtomic(HISTORY_FILE, JSON.stringify(file, null, 2));
    }
  });
}

/** History-only CAS; never clears RUNNING, claims, controls, or starts work.
 * withFileLock serializes one process only, not a distributed lease.
 */
export async function acknowledgeExpiredCheckpoint(runId: string, expectedStartedAt: string, actor: string): Promise<boolean> {
  return withFileLock(HISTORY_FILE, async () => {
    if (RUNNING_JOBS.has("quality_checkpoint")) return false;
    const file = readHistoryFile();
    const history = file.history.quality_checkpoint ?? [];
    const matches = history.filter(r => r.runId === runId);
    if (matches.length !== 1) return false;
    const run = matches[0];
    const start = Date.parse(run.startedAt);
    const now = Date.now();
    if (run.jobId !== "quality_checkpoint" || run.status !== "running" || run.recovery
      || run.startedAt !== expectedStartedAt || run.finishedAt !== null || run.durationMs !== null
      || !Number.isFinite(start) || new Date(start).toISOString() !== run.startedAt
      || start > now || now - start <= CHECKPOINT_MAX_DURATION_MS) return false;
    // Preserve the original evidence; this timestamp is acknowledgement, NOT completion.
    const original = { ...run };
    run.status = "abandoned";
    run.recovery = { acknowledgedAt: new Date(now).toISOString(), acknowledgedBy: actor, original };
    file.updatedAt = new Date(now).toISOString();
    await writeFileAtomic(HISTORY_FILE, JSON.stringify(file, null, 2));
    return true;
  });
}
