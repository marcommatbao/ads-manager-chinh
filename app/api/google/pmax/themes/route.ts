// Đợt 10d (E1) — search theme + asset group mới theo chủ đề.
// GET  ?company=                                                                   — theme từng asset group, chưa khớp, gợi ý
// POST {company, op: "apply", assetGroupId, add[], remove[] (resource), validateOnly, confirmText?}
// POST {company, op: "undo", id}
// POST {company, op: "draft_group", campaignId, sourceAssetGroupId, theme, finalUrl}  — Gemini viết chữ, mượn ảnh/video
// POST {company, op: "create_group", draft, validateOnly, confirmText?}               — tạo TẠM DỪNG
// POST {company, op: "group_state", id, action: enable|pause|remove, confirmText}     — chỉ asset group do tool tạo
import { NextRequest, NextResponse } from "next/server"
import { getT } from "@/lib/i18n/server"
import type { TFunction } from "@/lib/i18n/translate"
import { actorOf, fail, requireCompany, requireUser } from "@/lib/case/http"
import { hasPermission } from "@/lib/permissions"
import { applyThemes, createAssetGroup, draftAssetGroup, listNewAssetGroups, listThemeChanges, MAX_THEMES, readThemes, setAssetGroupState, undoThemes, type AssetGroupDraft } from "@/lib/pmax/themes"
import { PMAX_CONFIRM_TEXT, PmaxControlError } from "@/lib/pmax/controls"
import { friendlyError } from "@/lib/not-configured";

export const dynamic = "force-dynamic"
export const maxDuration = 120
const err = (e: unknown, t: TFunction) => (e instanceof PmaxControlError ? NextResponse.json({ success: false, error: friendlyError(e.message) }, { status: e.status }) : fail(e, t))
const strs = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string").slice(0, max) : [])

export async function GET(request: NextRequest) {
  const t = await getT()
  const u = await requireUser(undefined, t)
  if (!u.ok) return u.response
  const co = requireCompany(u.value, request.nextUrl.searchParams.get("company"), t)
  if (!co.ok) return co.response
  try {
    return NextResponse.json({ success: true, groups: await readThemes(co.value, t), maxThemes: MAX_THEMES, history: listThemeChanges(co.value), newAssetGroups: listNewAssetGroups(co.value), canEdit: hasPermission(u.value.role, "can_edit"), confirmText: PMAX_CONFIRM_TEXT })
  } catch (e) { return err(e, t) }
}

export async function POST(request: NextRequest) {
  const t = await getT()
  const u = await requireUser("can_edit", t)
  if (!u.ok) return u.response
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const co = requireCompany(u.value, b.company, t)
  if (!co.ok) return co.response
  const actor = actorOf(u.value), validateOnly = b.validateOnly !== false, confirmText = typeof b.confirmText === "string" ? b.confirmText : undefined
  try {
    switch (b.op) {
      case "apply": return NextResponse.json({ success: true, validated: validateOnly, execution: await applyThemes({ company: co.value, assetGroupId: String(b.assetGroupId ?? ""), add: strs(b.add, MAX_THEMES), remove: strs(b.remove, MAX_THEMES), actor, validateOnly, confirmText }, t) })
      case "undo": return NextResponse.json({ success: true, execution: await undoThemes(co.value, String(b.id ?? ""), t) })
      case "draft_group": return NextResponse.json({ success: true, draft: await draftAssetGroup(co.value, { campaignId: String(b.campaignId ?? ""), sourceAssetGroupId: String(b.sourceAssetGroupId ?? ""), theme: String(b.theme ?? ""), finalUrl: String(b.finalUrl ?? "") }, t) })
      case "create_group": {
        const d = (b.draft ?? {}) as Partial<AssetGroupDraft>
        const draft = { campaignId: String(d.campaignId ?? ""), sourceAssetGroupId: String(d.sourceAssetGroupId ?? ""), name: String(d.name ?? ""), finalUrl: String(d.finalUrl ?? ""), theme: String(d.theme ?? ""),
          headlines: strs(d.headlines, 15), longHeadlines: strs(d.longHeadlines, 5), descriptions: strs(d.descriptions, 5), searchThemes: strs(d.searchThemes, MAX_THEMES),
          media: Array.isArray(d.media) ? d.media.filter((m) => m && typeof m.asset === "string" && typeof m.field === "string").slice(0, 40).map((m) => ({ field: m.field, asset: m.asset, label: String(m.label ?? "") })) : [] }
        return NextResponse.json({ success: true, validated: validateOnly, record: await createAssetGroup({ company: co.value, draft, actor, validateOnly, confirmText }, t) })
      }
      case "group_state": {
        const action = String(b.action)
        if (!["enable", "pause", "remove"].includes(action)) return NextResponse.json({ success: false, error: t("libgoogle.rt.badAction") }, { status: 400 })
        return NextResponse.json({ success: true, record: await setAssetGroupState(co.value, String(b.id ?? ""), action as "enable" | "pause" | "remove", actor, confirmText, t) })
      }
    }
    return NextResponse.json({ success: false, error: t("libgoogle.rt.badOp") }, { status: 400 })
  } catch (e) { return err(e, t) }
}
