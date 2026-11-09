// ============================================================
// Đợt 26d — Tạm dừng nhóm "Kém rõ rệt" ngay trên trang So sánh tệp
// ============================================================
// Máy chủ KHÔNG tin trình duyệt: chấm lại kết quả so sánh (đệm 10 phút, không tốn lượt gọi) → nhóm phải còn "kém rõ rệt",
// rồi đọc trạng thái THẬT trên Meta: nhóm còn chạy, đúng chiến dịch, và chiến dịch còn ít nhất một nhóm khác đang chạy
// (dừng nhóm cuối = dừng cả chiến dịch → việc đó làm ở bảng Chiến dịch, không làm lén ở đây).
// Ghi qua Meta bằng Kiểm trước (validate_only) rồi mới ghi thật; đọc lại xác nhận; ghi nhật ký cấp NHÓM (adset.pause, có
// trạng thái trước/sau) → hiện ở "Đã làm & kết quả", đo lại 7/14 ngày và bấm Hoàn tác được.
import { metaGet, metaPost } from "@/lib/case/meta-graph"
import { recordCampaignMutation } from "@/lib/mutation-guard"
import type { CompareResult } from "./audience-compare-fetch"
import type { RankedAdset } from "./audience-compare"

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export type PauseCheck = { ok: true; row: RankedAdset } | { ok: false; reason: string }

/** HÀM THUẦN — nhóm này có được tạm dừng từ trang So sánh tệp không (theo kết quả so sánh). */
export function checkPausable(result: CompareResult, adsetId: string): PauseCheck {
  const row = result.groups.flatMap((g) => g.rows).find((r) => r.id === adsetId)
  if (!row) return { ok: false, reason: "Nhóm này không có trong kết quả so sánh — so lại rồi thử lại" }
  if (!row.clearlyWorse) return { ok: false, reason: "Nhóm này không còn “kém rõ rệt” theo số mới nhất — không tạm dừng" }
  if (row.status !== "ACTIVE") return { ok: false, reason: `Nhóm đang ở trạng thái ${row.status} — không cần tạm dừng` }
  return { ok: true, row }
}

/** HÀM THUẦN — đối chiếu trạng thái thật trên Meta. */
export function checkLive(adsetId: string, live: { id: string; status: string }[]): string | null {
  const me = live.find((a) => a.id === adsetId)
  if (!me) return "Không thấy nhóm này trong chiến dịch trên Meta (đã bị chuyển/xoá?)"
  if (me.status !== "ACTIVE") return `Trên Meta nhóm đang là ${me.status} — có người đã đổi trước đó, không ghi đè`
  if (!live.some((a) => a.id !== adsetId && a.status === "ACTIVE")) return "Đây là nhóm cuối cùng còn chạy trong chiến dịch — dừng nhóm này là dừng cả chiến dịch. Muốn vậy thì tắt chiến dịch ở bảng Chiến dịch."
  return null
}

export interface PauseOutcome { adsetId: string; adsetName: string; campaignId: string; campaignName: string; before: string; after: string }

/** Tạm dừng thật trên Meta (sau khi đã qua checkPausable). Ném lỗi kèm câu tiếng Việt khi không ghi. */
export async function pauseClearlyWorse(row: RankedAdset, company: string, actor: string): Promise<PauseOutcome> {
  const camp = await metaGet<Row>(row.campaignId, { fields: "id,name,adsets.limit(100){id,status}" })
  const live = ((camp.adsets?.data ?? []) as Row[]).map((a) => ({ id: String(a.id), status: String(a.status) }))
  const why = checkLive(row.id, live)
  if (why) throw new PauseRefused(why)
  try { await metaPost(row.id, { status: "PAUSED" }, true) }
  catch (e) { throw new PauseRefused(`Meta từ chối khi kiểm — CHƯA ghi gì: ${e instanceof Error ? e.message : String(e)}`) }
  await metaPost(row.id, { status: "PAUSED" }, false)
  // Ghi nhật ký NGAY sau khi Meta nhận lệnh (kể cả khi đọc lại lỗi) — để luôn hoàn tác được.
  recordCampaignMutation({
    source: { type: "human_manual", actor }, event: "adset.pause", company, campaignId: row.id, campaignName: row.name,
    rationale: "Tạm dừng nhóm “kém rõ rệt” từ trang So sánh tệp", notes: row.flags.find((f) => f.startsWith("Kém rõ rệt") || f.includes("kém rõ rệt")),
    platform: "meta", change: { field: "status", before: "ACTIVE", after: "PAUSED" },
    entityType: "adset", parentId: row.campaignId, parentName: row.campaignName,
  })
  const after = String((await metaGet<Row>(row.id, { fields: "status" })).status ?? "?")
  return { adsetId: row.id, adsetName: row.name, campaignId: row.campaignId, campaignName: String(camp.name ?? row.campaignName), before: "ACTIVE", after }
}

export class PauseRefused extends Error {}
