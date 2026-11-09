// ============================================================
// Dừng/bật + đổi ngân sách/ngày chiến dịch (Google, Meta) — dùng chung cho route giao diện và MCP cho Claude (#7142).
// Tách nguyên văn từ 4 route app/api/{google,meta}/campaigns/[id]/{status,budget} 27/10, thêm:
//   - validateOnly: chạy thử thật trên nền tảng (Google validate_only, Meta execution_options=validate_only), KHÔNG ghi;
//   - readState: trạng thái hiện tại (dấu vân tay chống ghi đè khi người khác vừa sửa);
//   - actor: nhãn nguồn ghi vào kho quyết định → "Đã làm & kết quả" (vd "a@x.com qua Claude (MCP)").
// ============================================================
import type { SessionUser } from "@/lib/auth"
import { getGoogleAdsCustomer } from "@/lib/google-ads-client"
import { canAccessCompany, hasPermission } from "@/lib/permissions"
import { checkRecentCampaignMutation, recordCampaignMutation } from "@/lib/mutation-guard"
import { googleStatusName } from "@/lib/writes/undo"
import { resolveMetaNodeOwner } from "@/lib/meta-campaign-company"
import { detectCompany } from "@/lib/company-detect"
import { META_GRAPH_BASE } from "@/lib/meta/graph-version"

export class MutationError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const BUDGET_MIN = 10_000
export const BUDGET_MAX = 1_000_000_000

function checkBudgetBounds(dailyBudget: number) {
  if (!dailyBudget || dailyBudget < BUDGET_MIN) throw new MutationError(400, "Ngân sách tối thiểu ₫10,000/ngày")
  if (dailyBudget > BUDGET_MAX) throw new MutationError(400, "Ngân sách tối đa ₫1,000,000,000/ngày")
}

// ── Google ──────────────────────────────────────────────────────────────
export interface GoogleCampaignState { campaignId: number; name: string; status: string; resourceName: string; budgetResourceName?: string; dailyBudget: number }

function googleCampaignId(id: string | number): number {
  const n = parseInt(String(id), 10)
  if (!n || isNaN(n)) throw new MutationError(400, "campaignId không hợp lệ")
  return n
}

function requireGoogle(user: SessionUser, company: string | undefined, perm: "can_edit" | "can_manage_budget"): string {
  if (!hasPermission(user.role, perm)) throw new MutationError(403, perm === "can_edit" ? "Không có quyền chỉnh sửa campaign" : "Không có quyền chỉnh ngân sách")
  if (!company) throw new MutationError(400, "Thiếu công ty")
  if (!canAccessCompany(user, company)) throw new MutationError(403, "Không có quyền truy cập công ty này")
  return company
}

export async function readGoogleCampaignState(company: string, id: string | number): Promise<GoogleCampaignState> {
  const campaignId = googleCampaignId(id)
  const rows = await getGoogleAdsCustomer(company).query(`
    SELECT campaign.resource_name, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign WHERE campaign.id = ${campaignId}
  `)
  const r = rows[0]
  if (!r?.campaign?.resource_name) throw new MutationError(404, "Không tìm thấy campaign trên Google Ads")
  return {
    campaignId, name: String(r.campaign.name ?? campaignId), status: googleStatusName(r.campaign.status) ?? String(r.campaign.status),
    resourceName: String(r.campaign.resource_name), budgetResourceName: r.campaign_budget?.resource_name ? String(r.campaign_budget.resource_name) : undefined,
    dailyBudget: Math.round(Number(r.campaign_budget?.amount_micros ?? 0) / 1_000_000),
  }
}

export async function setGoogleCampaignStatus(
  user: SessionUser,
  p: { company?: string; campaignId: string | number; action: "PAUSE" | "ACTIVE"; validateOnly?: boolean; actor?: string; rationale?: string },
): Promise<{ newStatus: "ACTIVE" | "PAUSED"; previous: GoogleCampaignState; validated?: true }> {
  const company = requireGoogle(user, p.company, "can_edit")
  const st = await readGoogleCampaignState(company, p.campaignId)
  // Google Ads' real enum is ENABLED/PAUSED — not Meta's ACTIVE/PAUSED.
  const googleStatus = p.action === "PAUSE" ? "PAUSED" : "ENABLED"
  const customer = getGoogleAdsCustomer(company)
  if (p.validateOnly) {
    await customer.mutateResources([{ entity: "campaign", operation: "update", resource: { resource_name: st.resourceName, status: googleStatus } }] as never, { validate_only: true } as never)
    return { newStatus: googleStatus === "ENABLED" ? "ACTIVE" : "PAUSED", previous: st, validated: true }
  }
  await customer.campaigns.update([{ resource_name: st.resourceName, status: googleStatus }] as never)
  // Đợt 15b: bật/tắt chiến dịch trước đây KHÔNG để lại dấu vết → không đo lại được hiệu quả.
  recordCampaignMutation({ source: { type: "human_manual", actor: p.actor ?? (user.email || user.name || user.id) }, event: googleStatus === "PAUSED" ? "campaign.pause" : "campaign.resume", company, campaignId: String(st.campaignId), campaignName: st.name, rationale: p.rationale ?? "Bật/tắt chiến dịch từ bảng Campaigns", platform: "google_ads", change: googleStatusName(st.status) ? { field: "status", before: googleStatusName(st.status)!, after: googleStatus } : undefined })
  return { newStatus: googleStatus === "ENABLED" ? "ACTIVE" : "PAUSED", previous: st }
}

export async function setGoogleCampaignBudget(
  user: SessionUser,
  p: { company?: string; campaignId: string | number; dailyBudget: number; validateOnly?: boolean; actor?: string; rationale?: string },
): Promise<{ newBudget: number; previousBudget: number; conflictWarning: string | null; previous: GoogleCampaignState; validated?: true }> {
  const company = requireGoogle(user, p.company, "can_manage_budget")
  checkBudgetBounds(p.dailyBudget)
  const st = await readGoogleCampaignState(company, p.campaignId)
  if (!st.budgetResourceName) throw new MutationError(404, "Không tìm thấy ngân sách của campaign này")
  // Hệ thống tự động khác vừa đổi ngân sách campaign này chưa? Đường có người quyết → chỉ CẢNH BÁO, không chặn.
  const recent = checkRecentCampaignMutation(String(st.campaignId), company, "human_manual")
  const customer = getGoogleAdsCustomer(company)
  const amount_micros = Math.round(p.dailyBudget) * 1_000_000
  if (p.validateOnly) {
    await customer.mutateResources([{ entity: "campaign_budget", operation: "update", resource: { resource_name: st.budgetResourceName, amount_micros } }] as never, { validate_only: true } as never)
    return { newBudget: p.dailyBudget, previousBudget: st.dailyBudget, conflictWarning: recent.hasConflict ? recent.note : null, previous: st, validated: true }
  }
  await customer.campaignBudgets.update([{ resource_name: st.budgetResourceName, amount_micros }] as never)
  const actor = p.actor ?? user.email
  recordCampaignMutation({
    source: { type: "human_manual", actor },
    event: p.dailyBudget > st.dailyBudget ? "budget.increase" : "budget.decrease",
    company, campaignId: String(st.campaignId), campaignName: st.name,
    rationale: p.rationale ?? `Đổi ngân sách thủ công bởi ${actor}`,
    notes: `₫${st.dailyBudget.toLocaleString("vi-VN")}/ngày → ₫${Math.round(p.dailyBudget).toLocaleString("vi-VN")}/ngày`,
    platform: "google_ads",
    change: st.dailyBudget > 0 ? { field: "daily_budget", before: st.dailyBudget, after: Math.round(p.dailyBudget) } : undefined,
  })
  return { newBudget: p.dailyBudget, previousBudget: st.dailyBudget, conflictWarning: recent.hasConflict ? recent.note : null, previous: st }
}

// ── Meta ────────────────────────────────────────────────────────────────
export interface MetaNodeState { id: string; kind: "campaign" | "child"; name: string; campaignName: string; campaignId?: string; company: string; status?: string; dailyBudget: number }

function metaToken(): string {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new MutationError(500, "META_ACCESS_TOKEN not configured")
  return token
}

/** Công ty lấy từ CHIẾN DỊCH CHA trên Meta (tên có tiền tố công ty) — không bao giờ tin công ty do client gửi. */
export async function readMetaNodeState(user: SessionUser, id: string): Promise<MetaNodeState> {
  const token = metaToken()
  let owner
  try { owner = await resolveMetaNodeOwner(id, token, { withBudget: true, withStatus: true }) }
  catch (e) { throw new MutationError(403, `Không xác minh được công ty: ${e instanceof Error ? e.message : String(e)}`) }
  const company = detectCompany(owner.campaignName)
  if (!canAccessCompany(user, company)) throw new MutationError(403, "Access denied for this company")
  return { id, kind: owner.kind, name: owner.name, campaignName: owner.campaignName, campaignId: owner.campaignId, company, status: owner.status, dailyBudget: parseFloat(owner.dailyBudget ?? "0") || 0 }
}

async function metaUpdate(id: string, fields: Record<string, string>, validateOnly: boolean): Promise<void> {
  const url = new URL(`${META_GRAPH_BASE}/${id}`)
  url.searchParams.set("access_token", metaToken())
  for (const [k, v] of Object.entries(fields)) url.searchParams.set(k, v)
  if (validateOnly) url.searchParams.set("execution_options", JSON.stringify(["validate_only"]))
  const res = await fetch(url.toString(), { method: "POST" })
  const data = (await res.json()) as { success?: boolean; error?: { message: string } }
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `Meta API error ${res.status}`)
}

export async function setMetaStatus(
  user: SessionUser,
  p: { id: string; action: "PAUSE" | "ACTIVATE"; level?: "adset"; validateOnly?: boolean; actor?: string; rationale?: string },
): Promise<{ newStatus: "ACTIVE" | "PAUSED"; previous: MetaNodeState; validated?: true }> {
  if (!hasPermission(user.role, "can_edit")) throw new MutationError(403, "Không có quyền chỉnh sửa campaign")
  const status = p.action === "PAUSE" ? "PAUSED" : "ACTIVE"
  const st = await readMetaNodeState(user, p.id)
  await metaUpdate(p.id, { status }, !!p.validateOnly)
  if (p.validateOnly) return { newStatus: status, previous: st, validated: true }
  // Đợt 15b: ghi dấu vết để đo lại 7/14 ngày.
  const adsetLevel = p.level === "adset" && st.kind === "child"
  recordCampaignMutation({ source: { type: "human_manual", actor: p.actor ?? (user.email || user.name || user.id) }, event: adsetLevel ? (status === "PAUSED" ? "adset.pause" : "adset.resume") : status === "PAUSED" ? "campaign.pause" : "campaign.resume", company: st.company, campaignId: p.id, campaignName: st.name ?? p.id, rationale: p.rationale ?? (adsetLevel ? "Bật/tắt nhóm quảng cáo" : "Bật/tắt chiến dịch từ bảng Campaigns"), platform: "meta", change: st.status ? { field: "status", before: st.status, after: status } : undefined, ...(adsetLevel ? { entityType: "adset" as const, parentId: st.campaignId, parentName: st.campaignName } : {}) })
  return { newStatus: status, previous: st }
}

export async function setMetaBudget(
  user: SessionUser,
  p: { id: string; dailyBudget: number; validateOnly?: boolean; actor?: string; rationale?: string },
): Promise<{ newBudget: number; previousBudget: number; conflictWarning: string | null; previous: MetaNodeState; validated?: true }> {
  if (!hasPermission(user.role, "can_manage_budget")) throw new MutationError(403, "Không có quyền chỉnh ngân sách")
  checkBudgetBounds(p.dailyBudget)
  const st = await readMetaNodeState(user, p.id)
  const recent = checkRecentCampaignMutation(p.id, st.company, "human_manual")
  // VND là tiền không có phần lẻ — Meta nhận đúng số, không ×100.
  await metaUpdate(p.id, { daily_budget: String(Math.round(p.dailyBudget)) }, !!p.validateOnly)
  if (p.validateOnly) return { newBudget: p.dailyBudget, previousBudget: st.dailyBudget, conflictWarning: recent.hasConflict ? recent.note : null, previous: st, validated: true }
  const actor = p.actor ?? user.email
  recordCampaignMutation({
    source: { type: "human_manual", actor },
    event: p.dailyBudget > st.dailyBudget ? "budget.increase" : "budget.decrease",
    company: st.company, campaignId: p.id, campaignName: st.name ?? `Campaign ${p.id}`,
    rationale: p.rationale ?? `Đổi ngân sách Facebook thủ công bởi ${actor}`,
    notes: `₫${st.dailyBudget.toLocaleString("vi-VN")}/ngày → ₫${Math.round(p.dailyBudget).toLocaleString("vi-VN")}/ngày`,
    platform: "meta",
    change: st.dailyBudget > 0 ? { field: "daily_budget", before: st.dailyBudget, after: Math.round(p.dailyBudget) } : undefined,
  })
  return { newBudget: p.dailyBudget, previousBudget: st.dailyBudget, conflictWarning: recent.hasConflict ? recent.note : null, previous: st }
}
