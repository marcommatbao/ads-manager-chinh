// ============================================================
// Công cụ GHI (mini-spec MCP-GD1 mục 7) — "Claude tự xác nhận, có hạn mức":
//   propose_* chạy thử THẬT trên Google/Meta + chụp dấu vân tay trạng thái → đề xuất (15 phút)
//   apply_change(proposal_id, "XAC NHAN") → kiểm lại khoá/công tắc/trần ghi/hạn/dấu vân tay → ghi đúng nội dung đã chạy thử.
// Mọi ghi đi qua ĐÚNG đường ghi của giao diện (lib/campaigns/mutations, guardedMutate, executeCase, undo) nên tự vào
// "Đã làm & kết quả" và được đo lại 7/14 ngày. Nguồn ghi: "<email> qua Claude (MCP)".
// ============================================================
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { hasPermission, canAccessCompany, type PermissionKey } from "@/lib/permissions"
import { GOOGLE_CUSTOMER_IDS } from "@/lib/google-ads-client"
import { createdNames, guardedMutate, listWrites, undoWrite } from "@/lib/write-guard"
import { checkKeyword } from "@/lib/google-keyword-limits"
import { readCase } from "@/lib/case/store"
import { executeCase, undoExecution } from "@/lib/case/service"
import { getById, updateEntry } from "@/lib/decision-memory/store"
import { planUndo, undoableReason } from "@/lib/writes/undo"
import {
  readGoogleCampaignState, readMetaNodeState, setGoogleCampaignBudget, setGoogleCampaignStatus, setMetaBudget, setMetaStatus,
} from "@/lib/campaigns/mutations"
import { readSettings, writesToday } from "../store"
import { budgetRuleViolation, CONFIRM_TEXT, getProposalForApply, listProposals, markUsed, ProposalError, saveProposal, type Proposal } from "../proposals"
import { applyLaunch, applyLaunchUndo, planLaunchUndo } from "./launch"
import type { McpContext } from "../auth"
import { requireCo, run, ToolError } from "./kit"

const W = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const
const PROPOSE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const
const actorOf = (ctx: McpContext) => `${ctx.user.email || ctx.user.name} qua Claude (MCP)`
const ASK = "Show the user this summary (before → after, spend impact, undo) and ask for explicit approval. Only after the user agrees, call apply_change with this proposal_id and confirm=\"XAC NHAN\"."

/** Khoá mức Ghi + công tắc tổng + quyền vai trò. */
export function requireWriteFor(ctx: McpContext, perm: PermissionKey = "can_edit") { requireWrite(ctx, perm) }
function requireWrite(ctx: McpContext, perm: PermissionKey = "can_edit") {
  if (ctx.key.mode !== "write") throw new ToolError("This MCP key is read-only. Create a Read + Write key in AdsCommand → Settings → Claude.")
  if (!readSettings().writesEnabled) throw new ToolError("Writing via Claude is turned off in AdsCommand → Settings → Claude.")
  if (!hasPermission(ctx.user.role, perm)) throw new ToolError(`Your AdsCommand role lacks permission "${perm}".`)
}

const err = (e: unknown) => { throw new ToolError(e instanceof Error ? e.message : String(e)) }

async function propose(ctx: McpContext, p: Omit<Proposal, "id" | "createdAt" | "expiresAt" | "keyId" | "userId">) {
  const saved = await saveProposal({ ...p, keyId: ctx.key.id, userId: ctx.user.id })
  return { proposal_id: saved.id, expiresAt: saved.expiresAt, ...p.summary, nextStep: ASK }
}

// ── Dấu vân tay hiện tại theo loại đề xuất (lúc áp mà khác lúc chạy thử → từ chối) ──
async function fingerprintNow(ctx: McpContext, p: Proposal): Promise<string> {
  const a = p.payload as Record<string, string | number>
  if (p.kind === "status" || p.kind === "budget") {
    const st = a.platform === "google" ? await readGoogleCampaignState(String(a.company), String(a.id)) : await readMetaNodeState(ctx.user, String(a.id))
    return p.kind === "status" ? String(st.status) : String(st.dailyBudget)
  }
  if (p.kind === "case") return String(readCase(String(a.caseId))?.updatedAt ?? "missing")
  // Hoàn tác: tính lại ĐÚNG như lúc đề xuất (giá trị hiện tại / trạng thái tạm dừng) — trước đây trả "-" nên mọi hoàn tác
  // bị từ chối nhầm "State changed" (test mcp-launch bắt được 27/10).
  if (p.kind === "undo") return (await planUndoChange(ctx, String(a.changeId))).fingerprint
  return "-"
}

export function registerWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool("propose_campaign_status", {
    title: "Propose pause / enable",
    description: "Dry-run pausing or enabling a campaign (Google or Meta) or a Meta ad set. Nothing is changed yet: returns a proposal to show the user. Enabling a paused campaign starts spending its daily budget. " + ASK,
    inputSchema: {
      platform: z.enum(["google", "meta"]),
      company: z.string().optional().describe("Google only: company code (required for Google)"),
      id: z.string().regex(/^\d{3,25}$/).describe("Campaign id (Google) or campaign/ad set id (Meta)"),
      action: z.enum(["pause", "enable"]),
      level: z.enum(["campaign", "adset"]).optional().describe("Meta only: 'adset' when id is an ad set"),
    },
    annotations: PROPOSE,
  }, run(ctx, "propose_campaign_status", async (a: { platform: "google" | "meta"; company?: string; id: string; action: "pause" | "enable"; level?: "campaign" | "adset" }) => {
    requireWrite(ctx)
    if (a.platform === "google") requireCo(ctx, a.company)
    const r = a.platform === "google"
      ? await setGoogleCampaignStatus(ctx.user, { company: a.company, campaignId: a.id, action: a.action === "pause" ? "PAUSE" : "ACTIVE", validateOnly: true }).catch(err)
      : await setMetaStatus(ctx.user, { id: a.id, action: a.action === "pause" ? "PAUSE" : "ACTIVATE", level: a.level === "adset" ? "adset" : undefined, validateOnly: true }).catch(err)
    const prev = r.previous as { name: string; status?: string; dailyBudget: number; company?: string }
    const company = a.platform === "google" ? a.company! : String(prev.company)
    return propose(ctx, {
      kind: "status", company, target: `${a.platform}:${a.level ?? "campaign"}:${a.id}`,
      payload: { platform: a.platform, company, id: a.id, action: a.action, level: a.level ?? "campaign" },
      fingerprint: String(prev.status),
      summary: {
        change: `${a.action === "pause" ? "Pause" : "Enable"} "${prev.name}"`, platform: a.platform, company,
        before: prev.status, after: r.newStatus,
        spendImpact: a.action === "enable" ? `Starts spending again (current daily budget ${prev.dailyBudget || "set at ad set level"})` : "Stops spending until enabled again",
        dryRun: "passed", undo: "undo via propose_undo with the change id from get_change_history, or in AdsCommand → Actions & results",
      },
    })
  }))

  server.registerTool("propose_budget_change", {
    title: "Propose daily budget change",
    description: "Dry-run changing a daily budget: Google campaign, Meta CBO campaign, or Meta ABO ad set. Hard limits: at most ±30% per change, and the same object at most once per 24h via Claude. Returns a proposal. " + ASK,
    inputSchema: {
      platform: z.enum(["google", "meta"]),
      company: z.string().optional().describe("Google only: company code"),
      id: z.string().regex(/^\d{3,25}$/),
      newDailyBudget: z.number().positive().describe("New daily budget in account currency (VND, whole number)"),
      reason: z.string().max(300).optional().describe("Why — saved in the change log"),
    },
    annotations: PROPOSE,
  }, run(ctx, "propose_budget_change", async (a: { platform: "google" | "meta"; company?: string; id: string; newDailyBudget: number; reason?: string }) => {
    requireWrite(ctx, "can_manage_budget")
    if (a.platform === "google") requireCo(ctx, a.company)
    const next = Math.round(a.newDailyBudget)
    const st = a.platform === "google" ? await readGoogleCampaignState(a.company!, a.id).catch(err) : await readMetaNodeState(ctx.user, a.id).catch(err)
    const target = `${a.platform}:budget:${a.id}`
    const why = budgetRuleViolation(st.dailyBudget, next, target)
    if (why) throw new ToolError(why)
    const r = a.platform === "google"
      ? await setGoogleCampaignBudget(ctx.user, { company: a.company, campaignId: a.id, dailyBudget: next, validateOnly: true }).catch(err)
      : await setMetaBudget(ctx.user, { id: a.id, dailyBudget: next, validateOnly: true }).catch(err)
    const company = a.platform === "google" ? a.company! : (st as { company: string }).company
    return propose(ctx, {
      kind: "budget", company, target,
      payload: { platform: a.platform, company, id: a.id, dailyBudget: next, reason: a.reason ?? "" },
      fingerprint: String(st.dailyBudget),
      summary: {
        change: `Daily budget of "${st.name}"`, platform: a.platform, company,
        before: st.dailyBudget, after: next, changePct: Math.round(((next - st.dailyBudget) / st.dailyBudget) * 1000) / 10,
        spendImpact: `${next > st.dailyBudget ? "+" : ""}${next - st.dailyBudget} per day (~${(next - st.dailyBudget) * 30} per 30 days)`,
        warning: r.conflictWarning, dryRun: "passed", undo: "propose_undo restores the previous budget",
      },
    })
  }))

  server.registerTool("propose_negative_keywords", {
    title: "Propose negative keywords",
    description: "Dry-run adding negative keywords to Google Search campaigns (one atomic batch, max 50). Use search terms that spend without converting (google_search_xray). " + ASK,
    inputSchema: {
      company: z.string(),
      negatives: z.array(z.object({
        keyword: z.string().min(1).max(80),
        matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).optional(),
        campaignId: z.string().regex(/^\d{3,25}$/),
      })).min(1).max(50),
    },
    annotations: PROPOSE,
  }, run(ctx, "propose_negative_keywords", async (a: { company: string; negatives: { keyword: string; matchType?: "EXACT" | "PHRASE" | "BROAD"; campaignId: string }[] }) => {
    requireWrite(ctx)
    const co = requireCo(ctx, a.company)
    const bad = a.negatives.map((n) => ({ n, c: checkKeyword(n.keyword) })).filter((x) => !x.c.ok)
    if (bad.length) throw new ToolError(`Invalid keywords: ${bad.map((x) => `"${x.n.keyword}" (${x.c.problem ?? "too long"})`).join("; ")}`)
    const negatives = a.negatives.map((n) => ({ keyword: n.keyword.trim(), matchType: n.matchType ?? "PHRASE", campaignId: n.campaignId }))
    await guardedMutate({ company: co, source: "mcp/negative", label: "dry run", ops: negOps(co, negatives), inverseOf: () => [], validateOnly: true, actor: actorOf(ctx) }).catch(err)
    return propose(ctx, {
      kind: "negatives", company: co, target: `google:negatives:${co}`, payload: { company: co, negatives }, fingerprint: "-",
      summary: { change: `Add ${negatives.length} negative keyword(s)`, company: co, negatives, dryRun: "passed (Google validate_only)", undo: "propose_undo removes exactly these negatives" },
    })
  }))

  server.registerTool("propose_case_actions", {
    title: "Propose applying a case's selected actions",
    description: "Dry-run the actions AdsCommand already proposed and selected in an improvement case (see list_cases/get_case): e.g. negatives, pause campaign/ad set, budget, exclude placement. Only the case's own selected actions. " + ASK,
    inputSchema: { caseId: z.string().min(1).max(80) }, annotations: PROPOSE,
  }, run(ctx, "propose_case_actions", async (a: { caseId: string }) => {
    requireWrite(ctx)
    const c = readCase(a.caseId)
    if (!c || !canAccessCompany(ctx.user, c.company)) throw new ToolError("Case not found")
    const r = await executeCase(a.caseId, { actor: actorOf(ctx), idempotencyKey: `mcp-dry-${Date.now()}`, validateOnly: true }).catch(err)
    return propose(ctx, {
      kind: "case", company: c.company, target: `case:${a.caseId}`, payload: { caseId: a.caseId }, fingerprint: String(c.updatedAt),
      summary: { change: `Apply ${c.actions.filter((x) => x.selected).length} selected action(s) of case ${a.caseId}`, company: c.company, actions: c.actions.filter((x) => x.selected), dryRun: r.execution, undo: "propose_undo with case:<caseId>:<executionId>" },
    })
  }))

  server.registerTool("propose_undo", {
    title: "Propose undo of a change",
    description: "Dry-run undoing a change listed by get_change_history (id like dm:…, guard:…, case:<caseId>:<execId>) or a campaign Claude created (launch:<campaignId>, deleted only while still paused). Refuses if the value was changed again since. " + ASK,
    inputSchema: { changeId: z.string().min(3).max(200) }, annotations: PROPOSE,
  }, run(ctx, "propose_undo", async (a: { changeId: string }) => {
    requireWrite(ctx)
    const p = await planUndoChange(ctx, a.changeId)
    return propose(ctx, { kind: "undo", company: p.company, target: `undo:${a.changeId}`, payload: { changeId: a.changeId }, fingerprint: p.fingerprint, summary: { change: `Undo ${a.changeId}`, ...p.summary, dryRun: p.dry } })
  }))

  server.registerTool("apply_change", {
    title: "Apply an approved proposal",
    description: "Apply a proposal ONLY after the user explicitly approved it in this conversation. Requires confirm=\"XAC NHAN\". Writes to Google/Meta for real, logs the change (Actions & results) and it can be undone.",
    inputSchema: { proposal_id: z.string().regex(/^prop_[A-Za-z0-9_-]{12}$/), confirm: z.string() },
    annotations: W,
  }, run(ctx, "apply_change", async (a: { proposal_id: string; confirm: string }) => {
    requireWrite(ctx)
    if (a.confirm !== CONFIRM_TEXT) throw new ToolError(`confirm must be exactly "${CONFIRM_TEXT}" — only send it after the user approved`)
    const s = readSettings()
    if (writesToday(ctx.key.id) >= s.maxWritesPerDay) throw new ToolError(`Daily write limit reached for this key (${s.maxWritesPerDay}/day)`)
    let p: Proposal
    try { p = getProposalForApply(a.proposal_id, ctx.key.id) } catch (e) { throw new ToolError(e instanceof ProposalError ? e.message : String(e)) }
    const now = await fingerprintNow(ctx, p).catch(err)
    if (now !== p.fingerprint) throw new ToolError(`State changed since the dry run (was ${p.fingerprint}, now ${now}) — propose again`)
    const result = await applyProposal(ctx, p).catch(err)
    await markUsed(p.id, result)
    return { applied: true, proposal_id: p.id, ...p.summary, result }
  }, { isWrite: (out) => !!(out as { applied?: boolean })?.applied }))
}

function negOps(company: string, negatives: { keyword: string; matchType: string; campaignId: string }[]) {
  const customerId = GOOGLE_CUSTOMER_IDS[company]
  if (!customerId) throw new ToolError(`No Google Ads account connected for ${company}`)
  return negatives.map((nk) => ({
    entity: "campaign_criterion", operation: "create" as const,
    resource: { campaign: `customers/${customerId}/campaigns/${nk.campaignId}`, negative: true, keyword: { text: nk.keyword, match_type: nk.matchType } },
  }))
}

async function applyProposal(ctx: McpContext, p: Proposal): Promise<unknown> {
  const a = p.payload as Record<string, unknown>
  const actor = actorOf(ctx)
  switch (p.kind) {
    case "status":
      if (a.platform === "google") return setGoogleCampaignStatus(ctx.user, { company: String(a.company), campaignId: String(a.id), action: a.action === "pause" ? "PAUSE" : "ACTIVE", actor, rationale: "Claude (MCP) — đã được người dùng duyệt" })
      return setMetaStatus(ctx.user, { id: String(a.id), action: a.action === "pause" ? "PAUSE" : "ACTIVATE", level: a.level === "adset" ? "adset" : undefined, actor, rationale: "Claude (MCP) — đã được người dùng duyệt" })
    case "budget": {
      const why = budgetRuleViolation(Number(p.fingerprint), Number(a.dailyBudget), p.target)
      if (why) throw new ToolError(why)
      const rationale = `Claude (MCP) — đã được người dùng duyệt${a.reason ? `: ${String(a.reason)}` : ""}`
      return a.platform === "google"
        ? setGoogleCampaignBudget(ctx.user, { company: String(a.company), campaignId: String(a.id), dailyBudget: Number(a.dailyBudget), actor, rationale })
        : setMetaBudget(ctx.user, { id: String(a.id), dailyBudget: Number(a.dailyBudget), actor, rationale })
    }
    case "negatives": {
      const negatives = a.negatives as { keyword: string; matchType: string; campaignId: string }[]
      const r = await guardedMutate({
        company: String(a.company), source: "mcp/negative", label: `Claude: phủ định ${negatives.length} cụm: ${negatives.slice(0, 3).map((n) => n.keyword).join(", ")}${negatives.length > 3 ? "…" : ""}`,
        ops: negOps(String(a.company), negatives),
        inverseOf: (resp) => createdNames(resp).filter((n): n is string => !!n).map((n) => ({ entity: "campaign_criterion", operation: "remove" as const, resource: n })),
        confirmText: CONFIRM_TEXT, actor,
      })
      return { writeId: r.entry?.id, changeId: r.entry ? `guard:${r.entry.id}` : undefined, added: negatives.length }
    }
    case "case": {
      const r = await executeCase(String(a.caseId), { actor, idempotencyKey: p.id, validateOnly: false })
      return { executionId: r.execution.id, changeId: `case:${a.caseId}:${r.execution.id}`, execution: r.execution }
    }
    case "undo":
      return applyUndo(ctx, String(a.changeId))
    case "launch":
      return applyLaunch(ctx, p, actor)
  }
  throw new ToolError(`Unknown proposal kind ${p.kind}`)
}

// ── Hoàn tác theo mã thay đổi trong "Đã làm & kết quả" ──────────────────
async function currentOf(ctx: McpContext, platform: string, field: string, id: string, company: string): Promise<string | number | null> {
  const st = platform === "meta" ? await readMetaNodeState(ctx.user, id) : await readGoogleCampaignState(company, id)
  return field === "status" ? st.status ?? null : st.dailyBudget
}

async function planUndoChange(ctx: McpContext, changeId: string): Promise<{ company: string; fingerprint: string; summary: Record<string, unknown>; dry: string }> {
  const [src, ...rest] = changeId.split(":")
  if (src === "dm") {
    const e = getById(rest.join(":"))
    if (!e || !canAccessCompany(ctx.user, e.target.company)) throw new ToolError("Change not found")
    const why = undoableReason(e)
    if (why) throw new ToolError(why)
    const cur = await currentOf(ctx, e.target.platform, String(e.action.field), e.target.entityId, e.target.company).catch(err)
    const plan = planUndo(e, cur)
    if (!plan.ok) throw new ToolError(plan.reason)
    if (plan.field === "daily_budget" && !hasPermission(ctx.user.role, "can_manage_budget")) throw new ToolError('Your AdsCommand role lacks permission "can_manage_budget"')
    return { company: plan.company, fingerprint: String(plan.current), summary: { company: plan.company, entityId: plan.entityId, field: plan.field, current: plan.current, restore: plan.restore }, dry: "value verified unchanged since the change" }
  }
  if (src === "guard") {
    const w = listWrites().find((x) => x.id === rest.join(":"))
    if (!w || !canAccessCompany(ctx.user, w.company)) throw new ToolError("Change not found")
    if (w.undoneAt) throw new ToolError("Already undone")
    return { company: w.company, fingerprint: "-", summary: { company: w.company, label: w.label, inverseOps: w.inverse.length }, dry: "stored inverse operations" }
  }
  if (src === "case") {
    const [caseId, execId] = rest
    const c = caseId ? readCase(caseId) : null
    if (!c || !canAccessCompany(ctx.user, c.company)) throw new ToolError("Change not found")
    const ex = c.executions.find((x) => x.id === execId)
    if (!ex || ex.undoneAt) throw new ToolError(ex ? "Already undone" : "Execution not found")
    return { company: c.company, fingerprint: "-", summary: { company: c.company, caseId, executionId: execId }, dry: "case undo plan" }
  }
  if (src === "launch") return planLaunchUndo(ctx, rest.join(":"), listProposals())
  throw new ToolError("This change type can't be undone via Claude — use AdsCommand → Actions & results")
}

async function applyUndo(ctx: McpContext, changeId: string): Promise<unknown> {
  const [src, ...rest] = changeId.split(":")
  const actor = actorOf(ctx)
  if (src === "dm") {
    const e = getById(rest.join(":"))!
    const plan = planUndo(e, await currentOf(ctx, e.target.platform, String(e.action.field), e.target.entityId, e.target.company))
    if (!plan.ok) throw new ToolError(plan.reason)
    const rationale = `Claude (MCP) hoàn tác ${changeId}`
    if (plan.field === "status") {
      const pause = plan.restore === "PAUSED"
      if (plan.platform === "meta") await setMetaStatus(ctx.user, { id: plan.entityId, action: pause ? "PAUSE" : "ACTIVATE", level: e.target.entityType === "adset" ? "adset" : undefined, actor, rationale })
      else await setGoogleCampaignStatus(ctx.user, { company: plan.company, campaignId: plan.entityId, action: pause ? "PAUSE" : "ACTIVE", actor, rationale })
    } else if (plan.platform === "meta") await setMetaBudget(ctx.user, { id: plan.entityId, dailyBudget: plan.restore, actor, rationale })
    else await setGoogleCampaignBudget(ctx.user, { company: plan.company, campaignId: plan.entityId, dailyBudget: plan.restore, actor, rationale })
    await updateEntry(e.id, { undoneAt: new Date().toISOString(), undoneBy: actor })
    return { restored: plan.restore }
  }
  if (src === "guard") {
    const w = listWrites().find((x) => x.id === rest.join(":"))!
    return undoWrite(w.company, w.id, actor)
  }
  if (src === "case") return undoExecution(rest[0], rest[1], actor)
  if (src === "launch") {
    await planLaunchUndo(ctx, rest.join(":"), listProposals())
    return applyLaunchUndo(rest.join(":"))
  }
  throw new ToolError("Unsupported change id")
}
