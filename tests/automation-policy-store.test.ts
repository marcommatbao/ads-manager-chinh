import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let scratch: string | undefined;
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); scratch = undefined; });

describe("policy draft persistence", () => {
  it("serializes concurrent saves so only one wins a revision", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(scratch);
    const store = await import("@/lib/automation/policy");
    const results = await Promise.allSettled([
      store.saveAutomationPolicyDraft(store.DEFAULT_AUTOMATION_POLICY, "admin-a", "1.0"),
      store.saveAutomationPolicyDraft(store.DEFAULT_AUTOMATION_POLICY, "admin-b", "1.0"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(scratch, "data/automation-policy-audit.json"), "utf8"))).toHaveLength(1);
  });
  it("writes an audited OFF draft and rejects stale revisions", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(scratch);
    const store = await import("@/lib/automation/policy");
    const saved = await store.saveAutomationPolicyDraft({ ...store.DEFAULT_AUTOMATION_POLICY, status: "approved", owner: "client", globalEnabled: true, applyEnabled: true }, "trusted-admin", "1.0");
    expect(saved).toMatchObject({ status: "draft", owner: "trusted-admin", globalEnabled: false, applyEnabled: false });
    expect(store.readAutomationPolicy()).toEqual(saved);
    const audit = JSON.parse(fs.readFileSync(path.join(scratch, "data/automation-policy-audit.json"), "utf8"));
    expect(audit[0]).toMatchObject({ actorId: "trusted-admin", event: "draft_save_requested" });
    await expect(store.saveAutomationPolicyDraft(saved, "trusted-admin", "1.0")).rejects.toThrow("POLICY_CONFLICT");
  });
  it("falls back OFF for corrupt policy and refuses corrupt audit", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(scratch);
    const store = await import("@/lib/automation/policy");
    fs.mkdirSync(path.join(scratch, "data"));
    fs.writeFileSync(path.join(scratch, "data/automation-policy.json"), "invalid");
    expect(store.readAutomationPolicy().applyEnabled).toBe(false);
    fs.writeFileSync(path.join(scratch, "data/automation-policy-audit.json"), "invalid");
    await expect(store.saveAutomationPolicyDraft(store.DEFAULT_AUTOMATION_POLICY, "admin", "1.0")).rejects.toThrow("POLICY_AUDIT_UNAVAILABLE");
  });
});
