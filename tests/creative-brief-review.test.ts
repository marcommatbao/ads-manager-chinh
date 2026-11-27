import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { BriefInput, CreativeBrief } from "@/lib/creative-brief/types";

const mocks = vi.hoisted(() => ({ user: { id: "server-editor", role: "admin_mbc", companies: ["ALL"] } as { id: string; role: string; companies: string[] }, build: vi.fn(), refs: vi.fn(() => []) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/creative-brief/builder", () => ({ buildBrief: mocks.build }));
vi.mock("@/lib/playbook/suggest", () => ({ briefReferences: mocks.refs }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => () => "test" }));
const input: BriefInput = { company: "MBC", platform: "facebook", product: "hosting", objective: "conversion", funnelStage: "bottom", selectedSegments: [] };
const output: CreativeBrief = {
  id: "generated-fixture", generatedAt: "2026-11-27T00:00:00Z", company: "MBC", platform: "facebook", product: { key: "hosting", displayName: "Hosting", category: "test" }, objective: "conversion", funnelStage: "bottom",
  audienceSummary: { primaryPersona: "test", size: "niche", topPainPoints: [], motivators: [], sophistication: "beginner" }, painPoints: [], usp: "original", valueProposition: "value", proofPoints: [], toneStrategy: { primaryTone: "plain", voiceGuidance: "plain", avoid: [] }, ctaStrategy: { primaryCta: "Read", urgencyFrame: "none", intent: "test" }, complianceNotes: [], sensitiveTerms: [],
};
let scratch: string;
let file: string;
beforeEach(() => {
  vi.resetModules();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "brief-review-"));
  vi.spyOn(process, "cwd").mockReturnValue(scratch);
  file = path.join(scratch, "data/creative-brief-drafts.json"); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, '{"drafts":[]}');
  mocks.user = { id: "server-editor", role: "admin_mbc", companies: ["ALL"] };
  mocks.build.mockReset().mockReturnValue(output); mocks.refs.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(scratch, { recursive: true, force: true }); });
const context = { params: Promise.resolve({ id: "draft" }) };
function req(body: unknown, method = "PATCH") { return new NextRequest("http://localhost/api/creative/brief/draft", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }); }
async function seed() { const store = await import("@/lib/creative-brief/store"); return { store, draft: await store.saveDraft("draft", "test", input, output) }; }

it("reviews exact revision with server actor; edits invalidate current review and preserve immutable historical content", async () => {
  const { store, draft } = await seed(); const route = await import("@/app/api/creative/brief/[id]/route");
  const response = await route.PATCH(req({ action: "review", company: "MBC", expectedRevision: draft.revision, contentHash: draft.contentHash, actorId: "forged" }), context);
  expect(response.status).toBe(200);
  const reviewed = (await response.json()).data.draft;
  expect(reviewed.review.actorId).toBe("server-editor");
  const edit = await route.PATCH(req({ action: "edit", company: "MBC", expectedRevision: draft.revision, usp: "changed", valueProposition: "new value" }), context);
  expect(edit.status).toBe(200);
  const saved = store.getDraft("draft")!;
  expect(saved.revision).toBe(2); expect(saved.review).toBeUndefined(); expect(saved.output?.usp).toBe("changed");
  expect(saved.history?.[0]).toEqual(reviewed.history[0]); expect(saved.history?.[0].output?.usp).toBe("original");
  expect((await route.PATCH(req({ action: "review", company: "MBC", expectedRevision: 1, contentHash: draft.contentHash }), context)).status).toBe(409);
  expect((await route.PATCH(req({ action: "review", company: "MBC", expectedRevision: 2, contentHash: draft.contentHash }), context)).status).toBe(409);
  expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.refs).not.toHaveBeenCalled();
});
it("serializes process-local concurrent revisions: one winner, one conflict", async () => {
  const { store } = await seed();
  const results = await Promise.allSettled([store.saveDraft("draft", "a", input, output, 1), store.saveDraft("draft", "b", input, output, 1)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(store.getDraft("draft")?.history).toHaveLength(2);
});
it("legacy drafts become unreviewed revision zero without migration; edits keep original snapshot", async () => {
  fs.writeFileSync(file, JSON.stringify({ drafts: [{ id: "draft", name: "legacy", input, output, createdAt: "old", updatedAt: "old", review: { actorId: "untrusted" } }] }));
  const store = await import("@/lib/creative-brief/store");
  expect(store.getDraft("draft")).toMatchObject({ revision: 0 }); expect(store.getDraft("draft")?.review).toBeUndefined();
  await store.saveDraft("draft", "changed", input, output, 0);
  expect(store.getDraft("draft")?.history?.[0].review).toBeUndefined();
});
it("creates the first draft when the store has never existed", async () => {
  fs.unlinkSync(file);
  const store = await import("@/lib/creative-brief/store");
  expect(store.listDrafts()).toEqual([]);
  const draft = await store.saveDraft("first", "new", input, output);
  expect(draft.revision).toBe(1);
  expect(store.getDraft("first")?.review).toBeUndefined();
});
it.each(["corrupt", "invalid shape", "bad history"])("fails closed on %s store without replacing bytes", async kind => {
  const { store } = await seed();
  if (kind === "corrupt") fs.writeFileSync(file, "{");
  if (kind === "invalid shape") fs.writeFileSync(file, '{"drafts":[{}]}');
  if (kind === "bad history") { const data = JSON.parse(fs.readFileSync(file, "utf8")); data.drafts[0].history[0].output.usp = "tampered"; fs.writeFileSync(file, JSON.stringify(data)); }
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  await expect(store.saveDraft("other", "new", input, output)).rejects.toMatchObject({ status: 503 });
  expect(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null).toBe(before);
});
it("atomic rename failure leaves previously reviewed data readable", async () => {
  const { store, draft } = await seed(); await store.reviewDraft("draft", "MBC", 1, draft.contentHash!, "actor");
  const before = fs.readFileSync(file, "utf8"); vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(new Error("disk failure"));
  await expect(store.saveDraft("draft", "changed", input, output, 1)).rejects.toMatchObject({ status: 503 });
  expect(fs.readFileSync(file, "utf8")).toBe(before); expect(store.getDraft("draft")?.review?.actorId).toBe("actor");
});
it("company denial and existing draft mismatch precede source access", async () => {
  const { store } = await seed(); const route = await import("@/app/api/creative/brief/route");
  expect((await route.POST(req({ input: { ...input, company: "MBI" } }, "POST"))).status).toBe(403);
  mocks.user.role = "admin_mbi";
  expect((await route.POST(req({ input: { ...input, company: "MBI" }, draftId: "draft", expectedRevision: 1 }, "POST"))).status).toBe(403);
  expect(store.getDraft("draft")?.input.company).toBe("MBC"); expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.refs).not.toHaveBeenCalled();
});
it("viewer reads only own company, cannot generate/edit/review/delete; editor cannot delete history", async () => {
  await seed(); const route = await import("@/app/api/creative/brief/[id]/route"); const list = await import("@/app/api/creative/brief/route");
  mocks.user.role = "viewer_mbc";
  expect((await route.GET(req({}, "POST"), context)).status).toBe(200);
  expect((await list.GET(new NextRequest("http://localhost/api/creative/brief"))).status).toBe(200);
  for (const action of ["edit", "review"]) expect((await route.PATCH(req({ action }), context)).status).toBe(403);
  expect((await list.POST(req({ input }, "POST"))).status).toBe(403);
  expect((await route.DELETE(req({}, "DELETE"), context)).status).toBe(403);
  mocks.user.role = "viewer_mbi"; expect((await route.GET(req({}, "POST"), context)).status).toBe(403);
  const json = await (await list.GET(new NextRequest("http://localhost/api/creative/brief"))).json(); expect(json.data.drafts).toEqual([]);
  mocks.user.role = "admin_mbc"; expect((await route.DELETE(req({}, "DELETE"), context)).status).toBe(409);
  expect(mocks.build).not.toHaveBeenCalled();
});
it("generate POST uses mocked boundary, requires exact revision for overwrite", async () => {
  const route = await import("@/app/api/creative/brief/route");
  const response = await route.POST(req({ input }, "POST")); expect(response.status).toBe(200);
  const { data } = await response.json(); expect(data.draft.revision).toBe(1);
  mocks.build.mockClear();
  expect((await route.POST(req({ input, draftId: data.draft.id }, "POST"))).status).toBe(409); expect(mocks.build).not.toHaveBeenCalled();
});
it("capacity refuses new drafts and revisions without evicting reviewed history", async () => {
  const { store, draft } = await seed(); await store.reviewDraft("draft", "MBC", 1, draft.contentHash!, "actor");
  for (let i = 1; i < 50; i++) await store.saveDraft(`d${i}`, "test", input, output);
  const before = fs.readFileSync(file, "utf8"); await expect(store.saveDraft("overflow", "test", input, output)).rejects.toMatchObject({ status: 409 }); expect(fs.readFileSync(file, "utf8")).toBe(before);
  for (let revision = 1; revision < 100; revision++) await store.saveDraft("draft", `v${revision}`, input, output, revision);
  const full = fs.readFileSync(file, "utf8"); await expect(store.saveDraft("draft", "overflow", input, output, 100)).rejects.toMatchObject({ status: 409 }); expect(fs.readFileSync(file, "utf8")).toBe(full); expect(store.getDraft("draft")?.history?.[0].review?.actorId).toBe("actor");
});
it("byte cap fails closed on write, and unavailable reads return errors rather than empty lists", async () => {
  const { store } = await seed(); const before = fs.readFileSync(file, "utf8");
  await expect(store.saveDraft("draft", "large", input, { ...output, usp: "x".repeat(5_000_000) }, 1)).rejects.toMatchObject({ status: 409 });
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  fs.writeFileSync(file, "{}");
  const route = await import("@/app/api/creative/brief/route");
  expect((await route.GET(new NextRequest("http://localhost/api/creative/brief"))).status).toBe(503);
  expect((await route.POST(req({ input }, "POST"))).status).toBe(503); expect(mocks.build).not.toHaveBeenCalled();
});
it("review retry preserves first reviewer; unrelated body content cannot alter a review snapshot", async () => {
  const { store, draft } = await seed(); const route = await import("@/app/api/creative/brief/[id]/route");
  await store.reviewDraft("draft", "MBC", 1, draft.contentHash!, "first-reviewer");
  const response = await route.PATCH(req({ action: "review", company: "MBC", expectedRevision: 1, contentHash: draft.contentHash, output: { ...output, usp: "forged" }, actorId: "forged" }), context);
  expect(response.status).toBe(200); expect(store.getDraft("draft")?.review?.actorId).toBe("first-reviewer"); expect(store.getDraft("draft")?.output?.usp).toBe("original");
});
