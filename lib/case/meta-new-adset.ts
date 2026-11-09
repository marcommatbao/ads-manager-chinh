// ============================================================
// Đợt 5 · B — tạo nhóm quảng cáo mới với sự kiện chuẩn (Facebook)
// ============================================================
// Meta cấm đổi sự kiện của nhóm đã chạy (đo 27/09, nguyên văn: "Sau khi đăng
// một nhóm quảng cáo, bạn không thể chỉnh sửa pixel, sự kiện chuyển đổi…").
// Nên đổi sự kiện = tạo nhóm MỚI. Đã đo bằng validate_only 27/09:
//   ✓ tạo nhóm mới sao targeting (bỏ subscriber_universe) + promoted_object chuẩn
//   ✕ /{ad}/copies và deep_copy — nội dung cũ bật standard_enhancements đã ngừng
//   ✓ tạo quảng cáo mới DÙNG LẠI creative_id cũ → giữ đúng bài viết + tương tác
// Nhóm + quảng cáo tạo ở trạng thái TẠM DỪNG; bật chạy là việc riêng.

import { metaGet, metaPost, adAccountId } from "./meta-graph"
import { retiredPositionsNote, writableTargeting } from "./meta-placements"
import type { CaseAction, MetaChange, ReadbackRow } from "./store"
import type { MetaEvidence } from "./types"
import { EVENTS_PER_WEEK_TO_LEARN } from "./causes-meta"
import { isInstantForm, isLeadOptimized } from "./goal-kind"
import { makeT, type TFunction } from "@/lib/i18n/translate"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Sự kiện chuẩn theo độ sâu phễu: enum custom_event_type ↔ tên trên pixel. */
export const STANDARD_FUNNEL = [
  { event: "PURCHASE", name: "Purchase", label: "Mua hàng" },
  { event: "ADD_PAYMENT_INFO", name: "AddPaymentInfo", label: "Thêm thông tin thanh toán" },
  { event: "INITIATED_CHECKOUT", name: "InitiateCheckout", label: "Bắt đầu thanh toán" },
  { event: "ADD_TO_CART", name: "AddToCart", label: "Thêm vào giỏ" },
  { event: "LEAD", name: "Lead", label: "Khách hàng tiềm năng" },
  { event: "COMPLETE_REGISTRATION", name: "CompleteRegistration", label: "Hoàn tất đăng ký" },
] as const

/** Đợt 23 (3d): chiến dịch thu lead — sự kiện kết quả cuối là Lead (Hoàn tất đăng ký là phương án thay). */
export const LEAD_FUNNEL = [
  { event: "LEAD", name: "Lead", label: "Khách hàng tiềm năng" },
  { event: "COMPLETE_REGISTRATION", name: "CompleteRegistration", label: "Hoàn tất đăng ký" },
] as const

const STANDARD_EVENT_LABEL_KEYS: Record<string, true> = { PURCHASE: true, ADD_PAYMENT_INFO: true, INITIATED_CHECKOUT: true, ADD_TO_CART: true, LEAD: true, COMPLETE_REGISTRATION: true }

/** Tối đa bao nhiêu quảng cáo tạo lại (lượt gọi Meta ~60/giờ). */
export const MAX_ADS_TO_RECREATE = 10

/**
 * Chọn sự kiện CHUẨN cho nhóm mới từ số 7 ngày trên pixel — hàm thuần.
 * Sâu nhất mà ≥ 50/tuần; không có → sự kiện có nhiều lượt nhất, gắn lowSignal.
 * Chỉ tên chuẩn (Purchase…), không bao giờ chọn tên tự đặt.
 */
export function chooseEvent(last7: Record<string, number>, funnel: readonly { event: string; name: string; label: string }[] = STANDARD_FUNNEL, t: TFunction = makeT("vi")): { pick: { event: string; label: string; perWeek: number }; alternatives: { event: string; label: string; perWeek: number }[]; lowSignal: boolean } {
  const rows = funnel.map((f) => ({ event: f.event, label: f.event in STANDARD_EVENT_LABEL_KEYS ? t(`libcase.c.ev.${f.event}` as never) : f.label, perWeek: last7[f.name] ?? 0 }))
  const alternatives = rows.filter((r) => r.perWeek > 0)
  const ok = rows.find((r) => r.perWeek >= EVENTS_PER_WEEK_TO_LEARN)
  if (ok) return { pick: ok, alternatives, lowSignal: false }
  const best = [...alternatives].sort((a, b) => b.perWeek - a.perWeek)[0]
  return { pick: best ?? rows[0], alternatives, lowSignal: true }
}

let seq = 0
const aid = (p: string) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`

/** Đề xuất việc tạo nhóm mới — gọi từ actions-meta khi nguyên nhân là sự kiện tối ưu/học thất bại. */
export function proposeCreateAdset(ev: MetaEvidence, opts: { viewHeavy?: boolean; leads?: boolean } = {}, t: TFunction = makeT("vi")): CaseAction | null {
  if (!ev.pixel) return null
  if (opts.leads) return proposeLeadAdset(ev, t)
  const source = ev.adsets.filter((a) => a.status === "ACTIVE" && a.cost > 0).sort((a, b) => b.cost - a.cost)[0]
  if (!source) return null
  const { pick, alternatives, lowSignal } = chooseEvent(ev.pixel.last7, STANDARD_FUNNEL, t)
  // Đợt 12: nhóm nguồn đang tính cả chỉ-xem mà đơn chủ yếu là chỉ-xem → nhóm mới chỉ tính lượt bấm (kể cả khi sự kiện đã đúng).
  const clickOnly = !!opts.viewHeavy && (source.attributionSpec ?? []).some((s) => s.eventType === "VIEW_THROUGH")
  if (source.optEvent.type === pick.event && source.learning.status !== "FAIL" && !clickOnly) return null
  const warnings = [
    t("libcase.c.na.paused"),
    t("libcase.c.na.relearn"),
    t("libcase.c.na.recreated"),
  ]
  if (Object.keys(source.targeting).includes("subscriber_universe")) warnings.push(t("libcase.c.na.whatsapp"))
  const retiredNote = retiredPositionsNote(writableTargeting(source.targeting as Record<string, unknown>).retired, t)
  if (retiredNote) warnings.push(retiredNote)
  if (clickOnly) warnings.push(t("libcase.c.na.clickOnlyWarn"))
  if (lowSignal) warnings.unshift(t("libcase.c.na.lowSignal", { need: EVENTS_PER_WEEK_TO_LEARN }))
  return {
    id: aid("newadset"), type: "CREATE_ADSET_WITH_EVENT", selected: false,
    sourceAdsetId: source.id, sourceAdsetName: source.name, pixelId: ev.pixel.pixelId,
    event: pick.event, eventLabel: pick.label, perWeek: pick.perWeek, lowSignal, alternatives, warnings,
    label: t("libcase.c.na.label", { event: pick.label, click: clickOnly ? t("libcase.c.na.clickOnlyLabel") : "", src: source.name }), clickOnly,
  }
}

/**
 * Đợt 23 (3d): chiến dịch THU LEAD — nhóm mới tối ưu theo sự kiện Lead của pixel trên trang web, sao từ nhóm tốn tiền nhất
 * CHƯA tối ưu theo lead. Nhóm dùng form trên Meta thì bỏ qua (nhóm mới phải chọn form — giao người). Hàm thuần.
 */
export function proposeLeadAdset(ev: MetaEvidence, t: TFunction = makeT("vi")): CaseAction | null {
  if (!ev.pixel) return null
  const running = ev.adsets.filter((a) => a.status === "ACTIVE" && a.cost > 0).sort((a, b) => b.cost - a.cost)
  const source = running.find((a) => !isInstantForm(a) && (!isLeadOptimized(a) || a.learning.status === "FAIL"))
  if (!source) return null
  const { pick, alternatives, lowSignal } = chooseEvent(ev.pixel.last7, LEAD_FUNNEL, t)
  if (pick.perWeek <= 0) return null // pixel không ghi lead nào — tạo nhóm mới chẳng có gì để học
  if (source.optEvent.type === pick.event && source.learning.status !== "FAIL") return null
  const changesGoal = source.optimizationGoal !== "OFFSITE_CONVERSIONS"
  const warnings = [
    t("libcase.c.na.paused"),
    t("libcase.c.na.relearn"),
    t("libcase.c.na.recreatedLead"),
  ]
  if (changesGoal) warnings.push(t("libcase.c.na.goal", { event: source.optEvent.label }))
  if (Object.keys(source.targeting).includes("subscriber_universe")) warnings.push(t("libcase.c.na.whatsapp"))
  const retiredNote = retiredPositionsNote(writableTargeting(source.targeting as Record<string, unknown>).retired, t)
  if (retiredNote) warnings.push(retiredNote)
  if (lowSignal) warnings.unshift(t("libcase.c.na.lowSignalLead", { need: EVENTS_PER_WEEK_TO_LEARN }))
  return {
    id: aid("newadset"), type: "CREATE_ADSET_WITH_EVENT", selected: false,
    sourceAdsetId: source.id, sourceAdsetName: source.name, pixelId: ev.pixel.pixelId,
    event: pick.event, eventLabel: pick.label, perWeek: pick.perWeek, lowSignal, alternatives, warnings,
    label: t("libcase.c.na.labelLead", { event: pick.label, src: source.name }),
    ...(changesGoal ? { forceGoal: "OFFSITE_CONVERSIONS" as const } : {}),
  }
}

/** Thân lệnh tạo nhóm mới từ nhóm nguồn — hàm thuần. */
export const CLICK_ONLY_SPEC = [{ event_type: "CLICK_THROUGH", window_days: 7 }]
export function buildNewAdsetBody(src: Row, opts: { pixelId: string; event: string; name: string; clickOnly?: boolean; forceGoal?: "OFFSITE_CONVERSIONS" }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: opts.name, campaign_id: String(src.campaign_id), status: "PAUSED",
    targeting: writableTargeting((src.targeting ?? {}) as Record<string, unknown>).body,
    optimization_goal: src.optimization_goal, billing_event: src.billing_event,
    promoted_object: { pixel_id: opts.pixelId, custom_event_type: opts.event },
  }
  for (const k of ["attribution_spec", "destination_type", "bid_strategy", "bid_amount", "daily_budget", "lifetime_budget", "end_time"]) {
    if (src[k] !== undefined && src[k] !== null && src[k] !== "" && src[k] !== "0") body[k] = src[k]
  }
  // Đợt 12: Meta cấm sửa cài đặt ghi nhận của nhóm đã tạo (đo 29/09: "Không còn hỗ trợ cập nhật khoảng thời gian ghi nhận sau
  // khi tạo nhóm quảng cáo") → muốn chỉ tính lượt bấm thì nhóm MỚI đặt ngay lúc tạo.
  if (opts.clickOnly) body.attribution_spec = CLICK_ONLY_SPEC
  // Đợt 23 (3d): nhóm nguồn tối ưu click/lượt xem… → nhóm mới đổi hẳn sang chuyển đổi trên web (giữ nguyên tối ưu cũ + sự kiện
  // pixel là cặp Meta từ chối). Bước Kiểm trước của Meta (validate_only) chặn nếu tổ hợp không hợp lệ — chưa tạo gì.
  if (opts.forceGoal) { body.optimization_goal = opts.forceGoal; body.billing_event = "IMPRESSIONS"; body.destination_type = "WEBSITE"; delete body.bid_amount }
  return body
}

const ddmm = () => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(new Date())

export async function readSource(adsetId: string) {
  const src = await metaGet<Row>(adsetId, { fields: "id,name,campaign_id,status,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,attribution_spec,destination_type,daily_budget,lifetime_budget,end_time,promoted_object" })
  const ads = ((await metaGet<Row>(`${adsetId}/ads`, { fields: "id,name,status,creative{id}", limit: "50" })).data ?? []) as Row[]
  const active = ads.filter((a) => a.status === "ACTIVE" && a.creative?.id).slice(0, MAX_ADS_TO_RECREATE)
  return { src, ads: active, skipped: ads.filter((a) => a.status === "ACTIVE").length - active.length }
}

export interface D5Result { changes: MetaChange[]; readback: ReadbackRow[]; errors: string[]; warnings: string[] }

/** Chạy các việc Đợt 5 đã chọn. validateOnly = chỉ nhờ Meta kiểm. */
export async function executeD5(actions: CaseAction[], campaignId: string, validateOnly: boolean): Promise<D5Result> {
  const out: D5Result = { changes: [], readback: [], errors: [], warnings: [] }
  for (const a of actions.filter((x) => x.selected)) {
    if (a.type === "CREATE_ADSET_WITH_EVENT") await createOne(a, campaignId, validateOnly, out)
    else if (a.type === "ACTIVATE_NEW_ADSET") await activateOne(a, validateOnly, out)
    if (out.errors.length) break
  }
  return out
}

async function createOne(a: Extract<CaseAction, { type: "CREATE_ADSET_WITH_EVENT" }>, campaignId: string, validateOnly: boolean, out: D5Result) {
  // Thiết kế Đợt 5: sự kiện không đủ 50/tuần → phải xác nhận mới GHI (Kiểm trước vẫn cho chạy).
  if (!validateOnly && a.lowSignal && !a.lowSignalAck) { out.errors.push(`“${a.label}”: sự kiện chỉ ${a.perWeek ?? 0} lượt/tuần (< ${EVENTS_PER_WEEK_TO_LEARN}) — tick xác nhận ở bước 5 trước khi tạo.`); return }
  let s: Awaited<ReturnType<typeof readSource>>
  try { s = await readSource(a.sourceAdsetId) } catch (e) { out.errors.push(`Không đọc được nhóm nguồn: ${e instanceof Error ? e.message : String(e)}`); return }
  if (String(s.src.campaign_id) !== campaignId) { out.errors.push("Nhóm nguồn không thuộc chiến dịch của phiên"); return }
  if (!s.ads.length) { out.errors.push("Nhóm nguồn không có quảng cáo đang chạy nào để tạo lại"); return }
  if (s.skipped > 0) out.warnings.push(`Chỉ tạo lại ${s.ads.length} quảng cáo đầu — ${s.skipped} quảng cáo còn lại phải thêm tay.`)
  const name = `${String(s.src.name).slice(0, 170)} · ${a.eventLabel}${a.clickOnly ? " · chỉ bấm" : ""} · AdsCommand ${ddmm()}`
  const body = buildNewAdsetBody(s.src, { pixelId: a.pixelId, event: a.event, name, clickOnly: a.clickOnly, forceGoal: a.forceGoal })
  const act = `act_${adAccountId()}`
  // Kiểm trước: tạo nhóm + tạo từng quảng cáo (dùng nhóm NGUỒN làm đích thử — nhóm mới chưa tồn tại).
  try {
    await metaPost(`${act}/adsets`, body, true)
    for (const ad of s.ads) await metaPost(`${act}/ads`, { name: String(ad.name), adset_id: a.sourceAdsetId, creative: { creative_id: String(ad.creative.id) }, status: "PAUSED" }, true)
  } catch (e) { out.errors.push(`Meta từ chối khi kiểm “${a.label}” — CHƯA tạo gì: ${e instanceof Error ? e.message : String(e)}`); return }
  if (validateOnly) {
    out.warnings.push("Kiểm quảng cáo dùng nhóm nguồn làm đích thử vì nhóm mới chưa tồn tại. Bước kiểm của Meta KHÔNG kiểm quyền ghi.")
    out.readback.push({ label: `Dự kiến · ${a.label}`, before: "—", after: "chưa tạo", expected: `Nhóm TẠM DỪNG · ${a.eventLabel} · ${s.ads.length} quảng cáo`, ok: true })
    return
  }
  let newId: string
  try { newId = String((await metaPost(`${act}/adsets`, body, false)).id) } catch (e) { out.errors.push(`Lỗi khi tạo nhóm: ${e instanceof Error ? e.message : String(e)}`); return }
  const change: Extract<MetaChange, { kind: "adset_created" }> = { kind: "adset_created", id: newId, name, adIds: [], sourceAdsetId: a.sourceAdsetId, event: a.event, after: "PAUSED" }
  out.changes.push(change) // ghi nhật ký NGAY khi có nhóm, để hoàn tác được kể cả khi tạo quảng cáo hỏng giữa chừng
  for (const ad of s.ads) {
    try { change.adIds.push(String((await metaPost(`${act}/ads`, { name: String(ad.name), adset_id: newId, creative: { creative_id: String(ad.creative.id) }, status: "PAUSED" }, false)).id)) }
    catch (e) { out.errors.push(`Lỗi khi tạo quảng cáo “${ad.name}” — dừng các quảng cáo sau: ${e instanceof Error ? e.message : String(e)}`); break }
  }
  try {
    const n = await metaGet<Row>(newId, { fields: "status,promoted_object,attribution_spec,ads.limit(50){id}" })
    const evOk = n.promoted_object?.custom_event_type === a.event
    out.readback.push(
      { label: `Nhóm mới “${name}”`, before: "—", after: String(n.status), expected: "PAUSED", ok: n.status === "PAUSED" },
      { label: "Sự kiện tối ưu nhóm mới", before: "—", after: String(n.promoted_object?.custom_event_type ?? "?"), expected: a.event, ok: evOk },
      { label: "Số quảng cáo tạo lại", before: "—", after: String(n.ads?.data?.length ?? 0), expected: String(s.ads.length), ok: (n.ads?.data?.length ?? 0) === s.ads.length },
      ...(a.clickOnly ? [{ label: "Cài đặt ghi nhận nhóm mới", before: "—", after: JSON.stringify(n.attribution_spec ?? null), expected: "chỉ lượt bấm 7 ngày", ok: JSON.stringify((n.attribution_spec ?? []).map((x: Row) => [x.event_type, Number(x.window_days)])) === JSON.stringify([["CLICK_THROUGH", 7]]) }] : []),
    )
  } catch (e) { out.errors.push(`Đã tạo nhưng không đọc lại được: ${e instanceof Error ? e.message : String(e)}`) }
}

async function activateOne(a: Extract<CaseAction, { type: "ACTIVATE_NEW_ADSET" }>, validateOnly: boolean, out: D5Result) {
  const ops: { id: string; kind: "adset_status" | "ad_status"; name: string; before: string; after: string }[] = [
    { id: a.newAdsetId, kind: "adset_status", name: "Nhóm mới", before: "PAUSED", after: "ACTIVE" },
    ...a.newAdIds.map((id, i) => ({ id, kind: "ad_status" as const, name: `Quảng cáo ${i + 1} của nhóm mới`, before: "PAUSED", after: "ACTIVE" })),
    ...(a.pauseSource ? [{ id: a.sourceAdsetId, kind: "adset_status" as const, name: "Nhóm cũ", before: "ACTIVE", after: "PAUSED" }] : []),
  ]
  // Đọc trạng thái thật trước; lệch với dự kiến → bỏ qua mục đó.
  const cur = new Map<string, string>()
  try {
    const r = await metaGet<Record<string, Row>>("", { ids: ops.map((o) => o.id).join(","), fields: "id,status" })
    for (const v of Object.values(r)) cur.set(String(v.id), String(v.status))
  } catch (e) { out.errors.push(`Không đọc được trạng thái: ${e instanceof Error ? e.message : String(e)}`); return }
  const todo = ops.filter((o) => {
    const c = cur.get(o.id)
    if (c === o.after) { out.warnings.push(`${o.name}: đã ${o.after === "ACTIVE" ? "chạy" : "tạm dừng"} sẵn — bỏ qua.`); return false }
    if (c !== o.before) { out.warnings.push(`${o.name}: đang là ${c ?? "?"} (khác dự kiến) — bỏ qua.`); return false }
    return true
  })
  try { for (const o of todo) await metaPost(o.id, { status: o.after }, true) } catch (e) { out.errors.push(`Meta từ chối khi kiểm — CHƯA ghi gì: ${e instanceof Error ? e.message : String(e)}`); return }
  if (validateOnly) { out.readback.push(...todo.map((o) => ({ label: `Dự kiến · ${o.name}`, before: o.before, after: "chưa ghi", expected: o.after, ok: true }))); return }
  // Quảng cáo trước, nhóm sau: nhóm bật lên đã có quảng cáo chạy được.
  const ordered = [...todo.filter((o) => o.kind === "ad_status"), ...todo.filter((o) => o.kind === "adset_status")]
  for (const o of ordered) {
    try { await metaPost(o.id, { status: o.after }, false); out.changes.push({ kind: o.kind, id: o.id, name: o.name, before: o.before, after: o.after }) }
    catch (e) { out.errors.push(`Lỗi khi đổi “${o.name}”: ${e instanceof Error ? e.message : String(e)}`); break }
  }
  try {
    const r = await metaGet<Record<string, Row>>("", { ids: ordered.map((o) => o.id).join(","), fields: "id,status" })
    for (const o of ordered) out.readback.push({ label: o.name, before: o.before, after: String(r[o.id]?.status ?? "?"), expected: o.after, ok: r[o.id]?.status === o.after })
  } catch (e) { out.errors.push(`Đã ghi nhưng không đọc lại được: ${e instanceof Error ? e.message : String(e)}`) }
}

/** Hoàn tác các thay đổi Đợt 5. Nhóm tạo mới: chưa phân phối → xoá; đã phân phối → tạm dừng (giữ số liệu). */
export async function undoD5(changes: MetaChange[]): Promise<string[]> {
  const report: string[] = []
  for (const ch of [...changes].reverse()) {
    try {
      if (ch.kind === "adset_created") {
        const ins = await metaGet<Row>(`${ch.id}/insights`, { fields: "impressions", date_preset: "maximum" })
        const shown = Number(ins.data?.[0]?.impressions ?? 0)
        if (shown === 0) {
          for (const adId of ch.adIds) await metaPost(adId, { status: "DELETED" }, false)
          await metaPost(ch.id, { status: "DELETED" }, false)
          report.push(`${ch.name}: chưa phân phối → đã xoá nhóm và ${ch.adIds.length} quảng cáo.`)
        } else {
          await metaPost(ch.id, { status: "PAUSED" }, false)
          report.push(`${ch.name}: đã phân phối ${shown.toLocaleString("vi-VN")} lượt hiển thị → chỉ tạm dừng (giữ số liệu).`)
        }
      } else if (ch.kind === "ad_status") {
        const cur = String((await metaGet<Row>(ch.id, { fields: "status" })).status)
        if (cur !== ch.after) { report.push(`${ch.name}: đang là ${cur}, khác mức tool đặt — giữ nguyên.`); continue }
        await metaPost(ch.id, { status: ch.before }, false)
        report.push(`${ch.name}: đã trả về ${ch.before}.`)
      }
    } catch (e) {
      report.push(`${ch.name}: hoàn tác thất bại — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return report
}
