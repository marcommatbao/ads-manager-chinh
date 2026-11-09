// ============================================================
// Lên chiến dịch Meta mới qua Claude (mini-spec MCP-GD1 mục 7.2): dùng ĐÚNG luồng tạo của Creative (lib/meta/launch.ts).
// Bất biến: chiến dịch mới LUÔN tạo ở trạng thái TẠM DỪNG (cả 3 cấp) — người dùng tự bật; ngân sách/ngày ≤ trần ở
// Cài đặt → Kết nối Claude. Chạy thử = kiểm trước khi tạo (preflight) + Meta validate_only trên lệnh tạo chiến dịch.
// Hoàn tác = XOÁ chiến dịch, chỉ khi nó còn tạm dừng và do chính Claude tạo (đề xuất "launch" đã áp).
// ============================================================
import crypto from "crypto"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CreativeResult, LaunchConfig } from "@/lib/creative-pipeline"
import { OBJECTIVE_MAP, rollbackMetaObject } from "@/lib/creative-pipeline"
import { runPreflightMeta } from "@/lib/launch-preflight"
import { buildCampaignParams } from "@/lib/meta/campaign-params"
import { launchMetaCampaign, LaunchHttpError } from "@/lib/meta/launch"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"
import { knownPages, metaAccountIds } from "@/lib/meta-accounts"
import { FALLBACK_PIXELS } from "@/lib/meta-client"
import { readMetaNodeState } from "@/lib/campaigns/mutations"
import { readSettings } from "../store"
import { saveProposal, type Proposal } from "../proposals"
import type { McpContext } from "../auth"
import { requireCo, run, ToolError } from "./kit"

const RO = { readOnlyHint: true, openWorldHint: true } as const
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const IMG_MAX = 10 * 1024 * 1024

function creds() {
  const token = process.env.META_ACCESS_TOKEN, account = process.env.META_AD_ACCOUNT_ID
  if (!token || !account) throw new ToolError("Meta is not connected in AdsCommand (Settings → Facebook)")
  return { token, account }
}

async function graphList(url: string): Promise<{ id: string; name: string }[] | null> {
  try {
    const d = (await (await fetch(url)).json()) as { data?: { id: string; name: string }[] }
    return d.data?.length ? d.data.map((x) => ({ id: x.id, name: x.name })) : null
  } catch { return null }
}

/** Ảnh từ URL công khai → thư viện ảnh của tài khoản quảng cáo (không tốn tiền, không chạy gì) → image_hash. */
async function uploadImageFromUrl(url: string): Promise<string> {
  let u: URL
  try { u = new URL(url) } catch { throw new ToolError(`Invalid image URL: ${url}`) }
  if (u.protocol !== "https:") throw new ToolError("Image URL must be https")
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), redirect: "follow" })
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim()
  if (!res.ok || !IMG_TYPES.has(type)) throw new ToolError(`Image URL must return JPEG/PNG/GIF/WebP (got ${res.status} ${type || "unknown"})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > IMG_MAX) throw new ToolError("Image larger than 10MB")
  const { token, account } = creds()
  const form = new FormData()
  form.append("access_token", token)
  form.append("filename", new Blob([buf], { type }), `claude-${crypto.randomBytes(4).toString("hex")}.${type.split("/")[1]}`)
  const d = (await (await fetch(`${META_GRAPH_BASE}/act_${account}/adimages`, { method: "POST", body: form })).json()) as { images?: Record<string, { hash?: string }>; error?: { message?: string } }
  if (d.error) throw new ToolError(`Meta rejected the image: ${d.error.message}`)
  const hash = d.images ? Object.values(d.images)[0]?.hash : undefined
  if (!hash) throw new ToolError("Image upload returned no hash")
  return hash
}

const segmentSchema = z.object({
  name: z.string().min(1).max(80),
  ageMin: z.number().int().min(18).max(65).optional(),
  ageMax: z.number().int().min(18).max(65).optional(),
  gender: z.enum(["all", "male", "female"]).optional(),
  locations: z.array(z.string()).max(20).optional().describe("Vietnamese provinces/cities, e.g. 'Hồ Chí Minh', 'Hà Nội'. Empty = whole country"),
  interests: z.array(z.string()).max(20).optional().describe("Interest keywords (resolved to Meta interests server-side)"),
})
const creativeSchema = z.object({
  headline: z.string().min(1).max(255),
  primaryText: z.string().min(1).max(2000),
  description: z.string().max(255).optional(),
  cta: z.string().max(40).optional().describe("e.g. LEARN_MORE, SIGN_UP, SHOP_NOW, CONTACT_US"),
  imageUrl: z.string().url().optional().describe("Public https image (JPEG/PNG/GIF/WebP ≤10MB)"),
  objectStoryId: z.string().regex(/^\d+_\d+$/).optional().describe("Use an existing Page post (from meta_page_posts) instead of text+image"),
}).refine((c) => !!c.imageUrl !== !!c.objectStoryId, { message: "Give exactly one of imageUrl or objectStoryId" })

export function registerLaunchTools(server: McpServer, ctx: McpContext): void {
  server.registerTool("meta_launch_assets", {
    title: "Meta launch assets",
    description: "Facebook Pages and Pixels available for new Meta campaigns, the company's default Page/Pixel, and the daily budget cap for campaigns created by Claude. Call before propose_new_meta_campaign.",
    inputSchema: { company: z.string() }, annotations: RO,
  }, run(ctx, "meta_launch_assets", async (a: { company: string }) => {
    const co = requireCo(ctx, a.company)
    const token = process.env.META_ACCESS_TOKEN, account = process.env.META_AD_ACCOUNT_ID
    const pages = (token && await graphList(`${META_GRAPH_BASE}/me/accounts?fields=id,name&access_token=${token}`)) || knownPages()
    const pixels = (token && account && await graphList(`${META_GRAPH_BASE}/act_${account}/adspixels?fields=id,name&access_token=${token}`)) || FALLBACK_PIXELS
    const ids = metaAccountIds(co as never)
    return {
      company: co, pages, pixels, defaults: { pageId: ids.pageId || null, pixelId: ids.pixelId || null },
      objectives: Object.keys(OBJECTIVE_MAP), newCampaignMaxDailyBudget: readSettings().newCampaignMaxDailyBudget,
      rules: "New campaigns are always created PAUSED. Total daily budget (CBO budget, or ad set budget × number of segments) must be ≤ newCampaignMaxDailyBudget.",
    }
  }))

  server.registerTool("meta_page_posts", {
    title: "Page posts",
    description: "Recent posts of a Facebook Page — use a post id as objectStoryId to advertise an existing post.",
    inputSchema: { company: z.string(), pageId: z.string().regex(/^\d{5,25}$/).optional(), days: z.number().int().min(1).max(180).optional() }, annotations: RO,
  }, run(ctx, "meta_page_posts", async (a: { company: string; pageId?: string; days?: number }) => {
    const co = requireCo(ctx, a.company)
    const { token } = creds()
    const pageId = a.pageId || metaAccountIds(co as never).pageId
    if (!pageId) throw new ToolError("No Page configured for this company — pass pageId from meta_launch_assets")
    const pt = ((await (await fetch(`${META_GRAPH_BASE}/${pageId}?fields=access_token&access_token=${token}`)).json().catch(() => ({}))) as { access_token?: string }).access_token ?? token
    const q = new URLSearchParams({ fields: "id,message,created_time,full_picture", since: String(Math.floor(Date.now() / 1000) - (a.days ?? 30) * 86400), limit: "30", access_token: pt })
    const d = (await (await fetch(`${META_GRAPH_BASE}/${pageId}/published_posts?${q}`)).json()) as { data?: { id: string; message?: string; created_time?: string; full_picture?: string }[]; error?: { message?: string } }
    if (d.error) throw new ToolError(`Meta: ${d.error.message}`)
    return { pageId, posts: (d.data ?? []).map((p) => ({ objectStoryId: p.id, createdAt: p.created_time, hasImage: !!p.full_picture, text: (p.message ?? "").slice(0, 300) })) }
  }))

  server.registerTool("propose_new_meta_campaign", {
    title: "Propose a new Meta campaign",
    description: "Dry-run creating a NEW Meta campaign (campaign → one ad set per segment → ads) through AdsCommand's launch pipeline. It is ALWAYS created PAUSED — the user turns it on in AdsCommand or Ads Manager. Total daily budget must be ≤ the cap from meta_launch_assets. Images from imageUrl are uploaded to the ad account image library at this step (no spend). Show the user the plan and ask for approval; only then call apply_change with confirm=\"XAC NHAN\".",
    inputSchema: {
      company: z.string(),
      campaignName: z.string().min(3).max(200),
      objective: z.enum(["OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC"]),
      budgetType: z.enum(["cbo", "adset"]).describe("cbo = one budget on the campaign; adset = budget per ad set (segment)"),
      dailyBudget: z.number().int().positive().describe("CBO: campaign daily budget. ABO: daily budget PER ad set"),
      destinationUrl: z.string().url(),
      pageId: z.string().regex(/^\d{5,25}$/).optional().describe("Default: company's Page"),
      pixelId: z.string().regex(/^\d{5,25}$/).optional().describe("Default: company's Pixel (required for SALES/LEADS website conversions)"),
      pixelEvent: z.string().max(40).optional().describe("Standard event enum e.g. PURCHASE, LEAD, COMPLETE_REGISTRATION"),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      segments: z.array(segmentSchema).min(1).max(5),
      creatives: z.array(creativeSchema).min(1).max(6),
      useAdvantageAudience: z.boolean().optional(),
      includeInstagram: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, run(ctx, "propose_new_meta_campaign", async (a: {
    company: string; campaignName: string; objective: string; budgetType: "cbo" | "adset"; dailyBudget: number; destinationUrl: string
    pageId?: string; pixelId?: string; pixelEvent?: string; startDate?: string; useAdvantageAudience?: boolean; includeInstagram?: boolean
    segments: z.infer<typeof segmentSchema>[]; creatives: z.infer<typeof creativeSchema>[]
  }) => {
    const { requireWriteFor } = await import("./write")
    requireWriteFor(ctx, "can_edit")
    const co = requireCo(ctx, a.company)
    const { token, account } = creds()
    const cap = readSettings().newCampaignMaxDailyBudget
    const total = a.budgetType === "cbo" ? a.dailyBudget : a.dailyBudget * a.segments.length
    if (total > cap) throw new ToolError(`Total daily budget ${total} exceeds the cap ${cap} for campaigns created by Claude (AdsCommand → Settings → Claude)`)
    const ids = metaAccountIds(co as never)
    const pageId = a.pageId || ids.pageId
    if (!pageId) throw new ToolError("No Page — pass pageId from meta_launch_assets")
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
    // Ảnh: tải lên thư viện ảnh ngay lúc đề xuất (để chạy thử kiểm được mẫu quảng cáo); mỗi mẫu gán cho MỌI phân khúc.
    const creatives: CreativeResult[] = []
    for (const [ci, c] of a.creatives.entries()) {
      const imageHash = c.imageUrl ? await uploadImageFromUrl(c.imageUrl) : undefined
      a.segments.forEach((s, si) => creatives.push({
        id: `mcp_${crypto.randomBytes(5).toString("hex")}`, segmentName: s.name, segmentIndex: si, funnelStage: "TOFU", tone: "claude", toneLabel: "Claude",
        platform: "facebook", headline: c.headline, primaryText: c.primaryText, description: c.description ?? "", cta: c.cta ?? "LEARN_MORE", selected: true,
        ...(imageHash ? { imageHash } : { objectStoryId: c.objectStoryId, isExistingPost: true }),
      } as CreativeResult))
      void ci
    }
    const objConf = OBJECTIVE_MAP[a.objective]
    const config: LaunchConfig = {
      campaignName: a.campaignName, objectiveKey: a.objective, objective: a.objective, company: co,
      budgetType: a.budgetType, dailyBudget: a.budgetType === "cbo" ? a.dailyBudget : 0, adSetDailyBudget: a.budgetType === "adset" ? a.dailyBudget : 0,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP", optimizationGoal: objConf.optimization_goal,
      pixelId: a.pixelId || ids.pixelId || undefined, pixelEvent: a.pixelEvent,
      startDate: a.startDate ?? today, continuous: true, destinationUrl: a.destinationUrl, pageId,
      segments: a.segments.map((s) => ({
        segmentName: s.name, funnelStage: "TOFU",
        demographics: { ageMin: s.ageMin ?? 18, ageMax: s.ageMax ?? 65, gender: s.gender ?? "all", locations: s.locations ?? [] },
        interests: s.interests ?? [], behaviors: [],
      })),
      creatives, includeInstagram: !!a.includeInstagram, useAdvantageAudience: !!a.useAdvantageAudience, autoUTM: true,
      launchActive: false, // BẤT BIẾN: luôn tạo TẠM DỪNG
    }
    const pre = runPreflightMeta(config, co)
    if (pre.status === "blocked") throw new ToolError(`Pre-launch check failed: ${pre.errors.map((e) => e.message).join("; ")}`)
    // Meta validate_only trên lệnh tạo chiến dịch (không tạo gì).
    const params = buildCampaignParams({ name: config.campaignName, objective: config.objectiveKey, status: "PAUSED", budgetType: config.budgetType, dailyBudget: config.dailyBudget, bidStrategy: config.bidStrategy })
    const form = new URLSearchParams({ access_token: token, execution_options: JSON.stringify(["validate_only"]) })
    for (const [k, v] of Object.entries(params)) form.set(k, typeof v === "string" ? v : JSON.stringify(v))
    const vr = (await (await fetch(`${META_GRAPH_BASE}/act_${account}/campaigns`, { method: "POST", body: form })).json()) as { error?: { message?: string; error_user_msg?: string } }
    if (vr.error) throw new ToolError(`Meta rejected the campaign in dry run: ${vr.error.error_user_msg ?? vr.error.message}`)
    const saved = await saveProposal({
      keyId: ctx.key.id, userId: ctx.user.id, kind: "launch", company: co, target: `meta:launch:${config.campaignName}`,
      payload: { config: config as unknown as Record<string, unknown> }, fingerprint: "-",
      summary: {
        change: `Create NEW Meta campaign "${config.campaignName}" (PAUSED)`, company: co, objective: a.objective,
        budget: a.budgetType === "cbo" ? `${a.dailyBudget}/day (campaign)` : `${a.dailyBudget}/day × ${a.segments.length} ad sets`,
        adSets: a.segments.map((s) => s.name), ads: creatives.length, pageId, pixelId: config.pixelId ?? null,
        warnings: pre.warnings?.map((w) => w.message) ?? [], dryRun: "passed (pre-launch checks + Meta validate_only on campaign)",
        status: "Will be created PAUSED — the user enables it in AdsCommand or Ads Manager", undo: "propose_undo with launch:<campaignId> deletes it while still paused",
      },
    })
    return { proposal_id: saved.id, expiresAt: saved.expiresAt, ...saved.summary, nextStep: "Show the user this plan and ask for approval; only then call apply_change with confirm=\"XAC NHAN\"." }
  }))
}

/** Áp đề xuất "launch" (gọi từ apply_change). */
export async function applyLaunch(ctx: McpContext, p: Proposal, actor: string): Promise<unknown> {
  const config = { ...(p.payload.config as unknown as LaunchConfig), launchActive: false }
  try {
    const r = await launchMetaCampaign(ctx.user, config, { actor })
    return { ...r, log: undefined, changeId: r.campaignId ? `launch:${String(r.campaignId)}` : undefined }
  } catch (e) {
    if (e instanceof LaunchHttpError) throw new ToolError(String(e.body.error ?? "launch failed"))
    throw e
  }
}

/** Hoàn tác "launch:<campaignId>": chỉ chiến dịch do Claude tạo (đề xuất launch đã áp) và còn TẠM DỪNG → xoá. */
export async function planLaunchUndo(ctx: McpContext, campaignId: string, used: Proposal[]) {
  const mine = used.find((x) => x.kind === "launch" && x.usedAt && (x.result as { campaignId?: string } | undefined)?.campaignId === campaignId)
  if (!mine) throw new ToolError("Only campaigns created via Claude can be removed here")
  const st = await readMetaNodeState(ctx.user, campaignId)
  if (st.status !== "PAUSED") throw new ToolError(`Campaign is ${st.status} — pause it first (propose_campaign_status)`)
  return { company: st.company, fingerprint: String(st.status), summary: { company: st.company, campaign: st.name, action: "DELETE campaign (and its ad sets/ads)" }, dry: "campaign verified PAUSED and created via Claude" }
}

export async function applyLaunchUndo(campaignId: string): Promise<unknown> {
  const r = await rollbackMetaObject(campaignId, "campaign", creds().token)
  if (!r.ok) throw new ToolError(`Meta: ${r.error}`)
  return { deleted: campaignId }
}
