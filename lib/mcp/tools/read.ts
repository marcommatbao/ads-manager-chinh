// Công cụ ĐỌC (mini-spec MCP-GD1 mục 4). Mỗi công cụ gọi đúng hàm mà trang tương ứng đang dùng, kiểm công ty như route.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { companyLabel } from "@/lib/companies"
import { getGoogleCampaignPerformance, getMetaCampaignPerformance } from "@/lib/campaigns/performance"
import { googleOverview, metaOverview } from "@/lib/case/service"
import { readSnapshot, readStates, viewItems } from "@/lib/inbox/store"
import { caseBoard } from "@/lib/case/board"
import { readCase } from "@/lib/case/store"
import { canAccessCompany } from "@/lib/permissions"
import { searchXray } from "@/lib/search/xray"
import { pmaxXray } from "@/lib/pmax/xray"
import { metaXray } from "@/lib/meta/xray"
import { recommendMeta } from "@/lib/meta/recommend"
import { creativeTruth } from "@/lib/meta/creative-truth"
import { collectWrites } from "@/lib/writes/feed"
import { readOutcomes, outcomeKey } from "@/lib/writes/job"
import { WINDOWS } from "@/lib/writes/outcome"
import { readPlaybook } from "@/lib/playbook/store"
import { withOutcomes } from "@/lib/playbook/outcomes"
import type { McpContext } from "../auth"
import { allowedCompanies, range, requireCo, run, ToolError, top } from "./kit"

const RO = { readOnlyHint: true, openWorldHint: true } as const
const dateArgs = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (Vietnam time). Default: 30 days ago. Max range 90 days."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD. Default: today."),
}
const company = z.string().describe("Company code from list_companies (e.g. MBC)")

export function registerReadTools(server: McpServer, ctx: McpContext): void {
  server.registerTool("list_companies", {
    title: "List companies",
    description: "Companies (brands) in this AdsCommand workspace that you can access. Every other tool takes one of these codes. Also tells whether you may make changes.",
    inputSchema: {}, annotations: RO,
  }, run(ctx, "list_companies", async () => ({
    companies: allowedCompanies(ctx).map((id) => ({ id, label: companyLabel(id) })),
    user: { name: ctx.user.name, role: ctx.user.role },
    keyMode: ctx.key.mode,
  })))

  server.registerTool("get_campaign_performance", {
    title: "Campaign performance",
    description: "Campaigns with spend and results for a date range. Meta: results (the campaign's own optimization event, same as Ads Manager 'Results'), CPL = spend/results, resultValue and resultRoas (null = Meta reports no value for that result type). Google: conversions, revenue (conversion value), roas. Sorted by spend, top `limit`.",
    inputSchema: {
      platform: z.enum(["meta", "google"]),
      company: company.optional().describe("Filter to one company; omit for all companies you can access"),
      status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("Meta only: filter by status"),
      limit: z.number().int().min(1).max(200).optional().describe("Max campaigns returned (default 50)"),
      ...dateArgs,
    },
    annotations: RO,
  }, run(ctx, "get_campaign_performance", async (a: { platform: "meta" | "google"; company?: string; status?: string; limit?: number; from?: string; to?: string }) => {
    const r = range(a.from, a.to)
    if (a.company) requireCo(ctx, a.company)
    const rows = a.platform === "meta"
      ? (await getMetaCampaignPerformance(ctx.user, { status: a.status ?? null, from: r.from, to: r.to })).campaigns.filter((c) => !a.company || c.company === a.company)
      : (await getGoogleCampaignPerformance(ctx.user, { company: a.company ?? null, from: r.from, to: r.to })).campaigns
    const slim = rows.map((c) => ({
      id: c.id, name: c.name, status: c.status, company: c.company, objective: c.objective, dailyBudget: c.dailyBudget,
      spend: Math.round(c.metrics.spend), impressions: c.metrics.impressions, clicks: c.metrics.clicks, ctr: +c.metrics.ctr.toFixed(2),
      results: c.metrics.conversions, cpl: c.metrics.conversions > 0 ? Math.round(c.metrics.spend / c.metrics.conversions) : null,
      ...(a.platform === "meta"
        ? { resultValue: c.metrics.resultValue ?? null, resultRoas: c.metrics.resultRoas != null ? +c.metrics.resultRoas.toFixed(2) : null }
        : { revenue: Math.round(c.metrics.revenue), roas: c.metrics.roas }),
    }))
    return { platform: a.platform, range: r, ...top(slim, a.limit ?? 50, (c) => c.spend) }
  }))

  server.registerTool("get_campaigns_over_target", {
    title: "Campaigns vs target",
    description: "Each campaign with spend, orders/leads and its verdict against the company's cost-per-result target (red = over the ceiling). This is AdsCommand's 'Campaign actions' overview; use it to find what to fix first.",
    inputSchema: { company, platform: z.enum(["google", "meta"]), ...dateArgs }, annotations: RO,
  }, run(ctx, "get_campaigns_over_target", async (a: { company: string; platform: "google" | "meta"; from?: string; to?: string }) => {
    const co = requireCo(ctx, a.company), r = range(a.from, a.to)
    const d = a.platform === "meta" ? await metaOverview(co, r) : await googleOverview(co, r)
    return { ...d, rows: top(d.rows, 80, (x) => x.perf.cost) }
  }))

  server.registerTool("get_today_inbox", {
    title: "Today's tasks",
    description: "AdsCommand's prioritized to-do inbox (PMax, Search, Meta, tracking health, open cases, next-best actions) with money at stake. Rebuilt periodically by the server.",
    inputSchema: { company: company.optional() }, annotations: RO,
  }, run(ctx, "get_today_inbox", async (a: { company?: string }) => {
    if (a.company) requireCo(ctx, a.company)
    const snap = readSnapshot()
    if (!snap) return { builtAt: null, items: [] }
    const ok = (co: string) => (co === "ALL" || canAccessCompany(ctx.user, co)) && (!a.company || co === a.company || co === "ALL")
    return { builtAt: snap.builtAt, ...top(viewItems(snap.items.filter((i) => ok(i.company)), readStates()), 60) }
  }))

  server.registerTool("list_cases", {
    title: "Open improvement cases",
    description: "Campaign improvement cases (sessions) being worked on: step, status, waiting for re-measure, reopened, done.",
    inputSchema: { company: company.optional() }, annotations: RO,
  }, run(ctx, "list_cases", async (a: { company?: string }) => {
    const cos = a.company ? [requireCo(ctx, a.company)] : allowedCompanies(ctx)
    return top(caseBoard(cos), 100)
  }))

  server.registerTool("get_case", {
    title: "Case detail",
    description: "Full detail of one improvement case: evidence, diagnosis, proposed actions, executions and re-measurements.",
    inputSchema: { id: z.string().min(1).max(80) }, annotations: RO,
  }, run(ctx, "get_case", async (a: { id: string }) => {
    const c = readCase(a.id)
    if (!c || !canAccessCompany(ctx.user, c.company)) throw new ToolError("Case not found")
    return c
  }))

  server.registerTool("google_search_xray", {
    title: "Google Search X-ray",
    description: "Google Search deep-dive for a company: campaigns (impression share lost to budget/rank), keywords with Quality Score, top search terms by cost, device split, warnings. Use for wasted spend and negative keyword ideas.",
    inputSchema: { company, ...dateArgs }, annotations: RO,
  }, run(ctx, "google_search_xray", async (a: { company: string; from?: string; to?: string }) => {
    const co = requireCo(ctx, a.company)
    const { keywords, terms, ...x } = await searchXray(co, range(a.from, a.to), { force: false })
    return { ...x, keywords: top(keywords, 100, (k) => k.cost), terms: top(terms, 100, (t) => t.cost) }
  }))

  server.registerTool("google_pmax_xray", {
    title: "Google PMax X-ray",
    description: "Performance Max deep-dive: spend by channel (Search/YouTube/Display…), search intents and n-grams, cannibalization with Search, asset groups.",
    inputSchema: { company, ...dateArgs }, annotations: RO,
  }, run(ctx, "google_pmax_xray", async (a: { company: string; from?: string; to?: string }) => pmaxXray(requireCo(ctx, a.company), range(a.from, a.to), { force: false })))

  server.registerTool("meta_xray", {
    title: "Meta X-ray",
    description: "Meta deep-dive: per-campaign flags (e.g. high frequency, view-heavy results), account warnings and AdsCommand's recommendations.",
    inputSchema: { company, ...dateArgs }, annotations: RO,
  }, run(ctx, "meta_xray", async (a: { company: string; from?: string; to?: string }) => {
    const x = await metaXray(requireCo(ctx, a.company), range(a.from, a.to), { detail: false, force: false })
    return { ...x, recommendations: recommendMeta(x) }
  }))

  server.registerTool("meta_creative_truth", {
    title: "Creatives that really sell",
    description: "Per Meta ad: what Meta reports vs real orders matched in the order system/GA4, with a verdict (scale, keep, cut…). Use to decide which creatives to scale or stop.",
    inputSchema: { company, ...dateArgs }, annotations: RO,
  }, run(ctx, "meta_creative_truth", async (a: { company: string; from?: string; to?: string }) => {
    const x = await creativeTruth(requireCo(ctx, a.company), range(a.from, a.to), { force: false })
    return { ...x, ads: top(x.ads, 80) }
  }))

  server.registerTool("get_change_history", {
    title: "Change history and outcomes",
    description: "Changes made through AdsCommand (by people, automation or Claude) and their measured outcome 7 and 14 days later (cost per result before vs after, adjusted for market movement). Use to learn what worked.",
    inputSchema: { days: z.number().int().min(1).max(400).optional().describe("Look-back window in days (default 30)"), company: company.optional() }, annotations: RO,
  }, run(ctx, "get_change_history", async (a: { days?: number; company?: string }) => {
    if (a.company) requireCo(ctx, a.company)
    const since = Date.now() - (a.days ?? 30) * 86_400_000
    const { events } = await collectWrites(new Date(), { persist: false })
    const outcomes = readOutcomes()
    const rows = events
      .filter((e) => canAccessCompany(ctx.user, e.company) && (!a.company || e.company === a.company) && Date.parse(e.at) >= since)
      .map((e) => ({ ...e, outcomes: WINDOWS.map((d) => ({ days: d, result: outcomes[outcomeKey(e.id, d)] ?? null })) }))
    return top(rows, 100)
  }))

  server.registerTool("get_playbook", {
    title: "Playbook",
    description: "What has worked for this company in the last 180 days (approved/auto lessons with outcomes). Use before proposing changes.",
    inputSchema: { company }, annotations: RO,
  }, run(ctx, "get_playbook", async (a: { company: string }) => withOutcomes(readPlaybook(requireCo(ctx, a.company)))))
}
