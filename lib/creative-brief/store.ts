import { readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { writeFileAtomic } from "@/lib/fs-atomic";
import { withFileLock } from "@/lib/file-lock";
import { briefInputSchema, briefOutputSchema } from "./validation";
import type { BriefDraft, BriefInput, CreativeBrief, BriefRevision } from "./types";

const FILE = path.join(process.cwd(), "data", "creative-brief-drafts.json");
const CAP = 50;
const REVISION_CAP = 100;
const BYTE_CAP = 5_000_000;
export class BriefStoreError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new BriefStoreError(status, message); };
function hash(name: string, input: BriefInput, output?: CreativeBrief) {
  return createHash("sha256").update(JSON.stringify({ name, input, output })).digest("hex");
}
function normalize(d: BriefDraft): BriefDraft {
  if (!d || typeof d.id !== "string" || !d.id || typeof d.name !== "string" ||
      !briefInputSchema.safeParse(d.input).success || (d.output !== undefined && !briefOutputSchema.safeParse(d.output).success) ||
      typeof d.createdAt !== "string" || typeof d.updatedAt !== "string" ||
      (d.output && d.output.company !== d.input.company)) return fail(503, "Brief store invalid");
  if (d.revision === undefined && d.history === undefined) {
    const revision: BriefRevision = { revision: 0, contentHash: hash(d.name, d.input, d.output), name: d.name, input: d.input, output: d.output, savedAt: d.updatedAt };
    return { ...d, revision: 0, contentHash: revision.contentHash, review: undefined, history: [revision] };
  }
  if (!Array.isArray(d.history) || !d.history.length || d.history.length > REVISION_CAP) return fail(503, "Brief history invalid");
  d.history.forEach((r, i) => {
    if (!Number.isInteger(r.revision) || (i === 0 && r.revision !== 0 && r.revision !== 1) ||
        typeof r.name !== "string" || typeof r.savedAt !== "string" || !briefInputSchema.safeParse(r.input).success || (r.output !== undefined && !briefOutputSchema.safeParse(r.output).success) || (i > 0 && r.revision !== d.history![i - 1].revision + 1) ||
        r.input?.company !== d.input.company || (r.output && r.output.company !== d.input.company) ||
        r.contentHash !== hash(r.name, r.input, r.output) ||
        (r.review && (r.review.revision !== r.revision || r.review.contentHash !== r.contentHash || typeof r.review.actorId !== "string" || !r.review.actorId || typeof r.review.reviewedAt !== "string" || !Number.isFinite(Date.parse(r.review.reviewedAt))))) fail(503, "Brief history invalid");
  });
  const last = d.history.at(-1)!;
  if (d.revision !== last.revision || d.contentHash !== last.contentHash || hash(d.name, d.input, d.output) !== last.contentHash || JSON.stringify(d.review) !== JSON.stringify(last.review)) return fail(503, "Brief reference invalid");
  return d;
}
function readDrafts(): BriefDraft[] {
  try {
    const raw = readFileSync(FILE, "utf8");
    if (Buffer.byteLength(raw) > BYTE_CAP) return fail(503, "Brief store too large");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.drafts) || parsed.drafts.length > CAP) return fail(503, "Brief store invalid");
    const drafts = parsed.drafts.map(normalize) as BriefDraft[];
    if (new Set(drafts.map(d => d.id)).size !== drafts.length) return fail(503, "Duplicate brief id");
    return drafts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return fail(503, "Brief store unavailable; restore explicitly");
  }
}
async function writeDrafts(drafts: BriefDraft[]) {
  const raw = JSON.stringify({ drafts }, null, 2);
  if (Buffer.byteLength(raw) > BYTE_CAP) return fail(409, "Brief storage capacity reached");
  try { await writeFileAtomic(FILE, raw); } catch { return fail(503, "Brief write failed"); }
}
export function getDraft(id: string) { return readDrafts().find(d => d.id === id) ?? null; }
export function listDrafts(limit = 20) { return readDrafts().slice(0, limit); }
export async function saveDraft(id: string, name: string, input: BriefInput, output?: CreativeBrief, expectedRevision?: number) {
  return withFileLock(FILE, async () => {
    if (!briefInputSchema.safeParse(input).success || (output !== undefined && !briefOutputSchema.safeParse(output).success) || typeof name !== "string" || !id) return fail(400, "Invalid brief content");
    const drafts = readDrafts();
    const idx = drafts.findIndex(d => d.id === id);
    const old = drafts[idx];
    if (old && old.input.company !== input.company) return fail(403, "Company cannot change");
    if ((old && expectedRevision !== old.revision) || (!old && expectedRevision !== undefined)) return fail(409, "Brief revision conflict");
    if ((!old && drafts.length >= CAP) || (old?.history?.length ?? 0) >= REVISION_CAP) return fail(409, "Brief storage capacity reached");
    if (output && output.company !== input.company) return fail(400, "Output company mismatch");
    const now = new Date().toISOString();
    const contentHash = hash(name, input, output);
    if (old?.contentHash === contentHash) return old;
    const revision = (old?.revision ?? 0) + 1;
    const entry: BriefRevision = { revision, contentHash, name, input, output, savedAt: now };
    const draft: BriefDraft = { id, name, input, output, createdAt: old?.createdAt ?? now, updatedAt: now, revision, contentHash, history: [...(old?.history ?? []), entry] };
    if (old) drafts[idx] = draft; else drafts.unshift(draft);
    await writeDrafts(drafts);
    return draft;
  });
}
export async function reviewDraft(id: string, company: string, expectedRevision: number, contentHash: string, actorId: string) {
  return withFileLock(FILE, async () => {
    const drafts = readDrafts();
    const draft = drafts.find(d => d.id === id);
    if (!draft) return fail(404, "Draft not found");
    if (draft.input.company !== company) return fail(403, "Company mismatch");
    if (draft.revision !== expectedRevision || draft.contentHash !== contentHash) return fail(409, "Brief revision conflict");
    if (!draft.output || !actorId) return fail(400, "Generated content and reviewer required");
    if (draft.review) return draft;
    draft.review = { revision: expectedRevision, contentHash, actorId, reviewedAt: new Date().toISOString() };
    draft.history!.at(-1)!.review = draft.review;
    await writeDrafts(drafts);
    return draft;
  });
}
// Deletion would remove immutable review evidence. Retain all drafts in this slice.
export async function deleteDraft(id: string): Promise<boolean> { void id; return fail(409, "Brief history retained; deletion disabled"); }
