// ============================================================
// Vị trí hiển thị Meta: tên trong báo cáo ↔ tên trong targeting
// ============================================================
// Báo cáo (insights breakdowns=publisher_platform,platform_position) và
// targeting của nhóm quảng cáo dùng HAI bộ tên khác nhau: báo cáo nói
// "instagram / feed", targeting nói instagram_positions: ["stream"]; báo cáo nói
// "facebook_stories", targeting nói facebook_positions: ["story"]. Loại một vị trí
// phải dịch đúng tên, dịch sai thì Meta từ chối hoặc — tệ hơn — loại nhầm chỗ khác.
// Vị trí không có trong bảng → không loại được bằng tool (báo, không đoán).

import { META_GRAPH_VERSION } from "@/lib/meta/graph-version"
import { makeT, type TFunction } from "@/lib/i18n/translate"

export type PlacementField =
  | "facebook_positions" | "instagram_positions" | "audience_network_positions" | "messenger_positions"

export interface PlacementTarget { platform: string; field: PlacementField; value: string }

const MAP: Record<string, PlacementTarget> = {
  "facebook:feed": { platform: "facebook", field: "facebook_positions", value: "feed" },
  "facebook:right_hand_column": { platform: "facebook", field: "facebook_positions", value: "right_hand_column" },
  "facebook:marketplace": { platform: "facebook", field: "facebook_positions", value: "marketplace" },
  "facebook:video_feeds": { platform: "facebook", field: "facebook_positions", value: "video_feeds" },
  "facebook:facebook_stories": { platform: "facebook", field: "facebook_positions", value: "story" },
  "facebook:search": { platform: "facebook", field: "facebook_positions", value: "search" },
  "facebook:instream_video": { platform: "facebook", field: "facebook_positions", value: "instream_video" },
  "facebook:facebook_reels": { platform: "facebook", field: "facebook_positions", value: "facebook_reels" },
  "facebook:facebook_reels_overlay": { platform: "facebook", field: "facebook_positions", value: "facebook_reels_overlay" },
  "facebook:facebook_profile_feed": { platform: "facebook", field: "facebook_positions", value: "profile_feed" },
  "facebook:facebook_notification": { platform: "facebook", field: "facebook_positions", value: "notification" },
  "instagram:feed": { platform: "instagram", field: "instagram_positions", value: "stream" },
  "instagram:instagram_stories": { platform: "instagram", field: "instagram_positions", value: "story" },
  "instagram:instagram_explore": { platform: "instagram", field: "instagram_positions", value: "explore" },
  "instagram:instagram_explore_grid_home": { platform: "instagram", field: "instagram_positions", value: "explore_home" },
  "instagram:instagram_reels": { platform: "instagram", field: "instagram_positions", value: "reels" },
  "instagram:instagram_profile_feed": { platform: "instagram", field: "instagram_positions", value: "profile_feed" },
  "instagram:instagram_search": { platform: "instagram", field: "instagram_positions", value: "ig_search" },
  "instagram:instagram_profile_reels": { platform: "instagram", field: "instagram_positions", value: "profile_reels" },
  "audience_network:an_classic": { platform: "audience_network", field: "audience_network_positions", value: "classic" },
  "audience_network:rewarded_video": { platform: "audience_network", field: "audience_network_positions", value: "rewarded_video" },
  "messenger:messenger_inbox": { platform: "messenger", field: "messenger_positions", value: "messenger_home" },
  "messenger:messenger_stories": { platform: "messenger", field: "messenger_positions", value: "story" },
}

const LABEL: Record<string, string> = {
  "facebook:feed": "Facebook · Bảng tin", "facebook:facebook_reels": "Facebook · Reels",
  "facebook:facebook_reels_overlay": "Facebook · Quảng cáo trên Reels", "facebook:facebook_stories": "Facebook · Tin",
  "facebook:instream_video": "Facebook · Video trong luồng", "facebook:marketplace": "Facebook · Marketplace",
  "facebook:search": "Facebook · Kết quả tìm kiếm", "facebook:video_feeds": "Facebook · Bảng tin video",
  "facebook:right_hand_column": "Facebook · Cột bên phải", "facebook:facebook_profile_feed": "Facebook · Bảng tin trang cá nhân",
  "facebook:facebook_notification": "Facebook · Thông báo",
  "instagram:feed": "Instagram · Bảng tin", "instagram:instagram_reels": "Instagram · Reels", "instagram:instagram_stories": "Instagram · Tin",
  "instagram:instagram_explore": "Instagram · Khám phá", "instagram:instagram_explore_grid_home": "Instagram · Trang chủ Khám phá",
  "instagram:instagram_profile_feed": "Instagram · Bảng tin trang cá nhân", "instagram:instagram_search": "Instagram · Tìm kiếm",
  "instagram:instagram_profile_reels": "Instagram · Reels trang cá nhân",
  "audience_network:an_classic": "Audience Network", "audience_network:rewarded_video": "Audience Network · Video có thưởng",
  "messenger:messenger_inbox": "Messenger · Hộp thư", "messenger:messenger_stories": "Messenger · Tin",
}

export const placementKey = (platform: string, position: string) => `${platform}:${position}`
export const placementTarget = (key: string): PlacementTarget | null => MAP[key] ?? null
export const placementLabel = (key: string, t: TFunction = makeT("vi")) => (key in LABEL ? t(`libcase.c.pl.${key}` as never) : key.replace(":", " · "))
export const isReels = (key: string) => /reels/.test(key)

export const POSITION_FIELDS: PlacementField[] = ["facebook_positions", "instagram_positions", "audience_network_positions", "messenger_positions"]

export type Targeting = Record<string, unknown>

/**
 * Trường targeting Meta TRẢ VỀ khi đọc nhưng app này KHÔNG ghi được. Đo 27/09
 * (validate_only, MBI): gửi lại targeting NGUYÊN TRẠNG cũng bị "(#3) Application
 * does not have the capability"; bỏ `subscriber_universe` (tệp khách WhatsApp)
 * thì qua. Hệ quả: mọi lần ghi targeting từ tool làm MẤT thiết lập này — nơi
 * gọi phải cảnh báo, và hoàn tác cũng không khôi phục được nó.
 */
export const UNWRITABLE_TARGETING_KEYS = ["subscriber_universe"]

/** Số phiên bản chính của Graph API, vd "v25.0" → 25. */
export function graphMajor(version: string = META_GRAPH_VERSION): number {
  return Number(/^v(\d+)/.exec(version)?.[1] ?? 0)
}

/**
 * Vị trí Meta đã KHAI TỬ theo phiên bản (changelog Meta + đo validate_only 26/10/2026, task #7099):
 * - facebook `video_feeds`: lỗi từ v24; messenger `story`: Meta tự bỏ ở mọi phiên bản từ 27/10/2026.
 * - instagram `explore` (lưới Khám phá): v26 TỪ CHỐI ("IG Explore placement is deprecated", subcode 2490589),
 *   nhưng v25 lại BẮT khai `explore` khi có `explore_home` ("please also select Instagram Explore", subcode 2490392).
 *   Hai phiên bản ngược nhau → quy tắc phải theo phiên bản đang gọi, xem applyPlacementRules.
 */
export function retiredPositions(version: string = META_GRAPH_VERSION): Record<string, string[]> {
  const out: Record<string, string[]> = { facebook_positions: ["video_feeds"], messenger_positions: ["story"] }
  if (graphMajor(version) >= 26) out.instagram_positions = ["explore"]
  return out
}

/**
 * Đưa danh sách vị trí về dạng phiên bản `version` chấp nhận. Hàm thuần.
 * - Bỏ vị trí khai tử (`retired`, dạng "instagram_positions:explore"); danh sách rỗng sau khi bỏ → bỏ hẳn trường
 *   (= Meta tự chọn trong nền tảng; gửi mảng rỗng bị từ chối).
 * - Dưới v26: có `explore_home` mà thiếu `explore` → thêm `explore` (Meta bắt đi cặp).
 */
export function applyPlacementRules(t: Targeting, version: string = META_GRAPH_VERSION): { body: Targeting; retired: string[] } {
  const body = { ...t }
  const retired: string[] = []
  for (const [field, gone] of Object.entries(retiredPositions(version))) {
    const cur = body[field]
    if (!Array.isArray(cur)) continue
    const keep = (cur as string[]).filter((p) => !gone.includes(p))
    if (keep.length === cur.length) continue
    for (const p of cur as string[]) if (gone.includes(p)) retired.push(`${field}:${p}`)
    if (keep.length) body[field] = keep
    else delete body[field]
  }
  const ig = body.instagram_positions
  if (graphMajor(version) < 26 && Array.isArray(ig) && ig.includes("explore_home") && !ig.includes("explore")) {
    body.instagram_positions = [...(ig as string[]), "explore"]
  }
  return { body, retired }
}

/**
 * Bản targeting ghi được lên Meta: bỏ trường app không ghi được (`dropped`, vd tệp WhatsApp) rồi áp quy tắc vị trí
 * của phiên bản đang gọi (`retired` = vị trí khai tử đã bỏ).
 */
export function writableTargeting(t: Targeting, version: string = META_GRAPH_VERSION): { body: Targeting; dropped: string[]; retired: string[] } {
  const stripped = { ...t }
  const dropped = UNWRITABLE_TARGETING_KEYS.filter((k) => k in stripped)
  for (const k of dropped) delete stripped[k]
  const { body, retired } = applyPlacementRules(stripped, version)
  return { body, dropped, retired }
}

/** Câu cảnh báo cho người dùng khi writableTargeting bỏ vị trí Meta đã khai tử; null nếu không bỏ gì. */
export function retiredPositionsNote(retired: string[], t: TFunction = makeT("vi")): string | null {
  if (!retired.length) return null
  return t("libcase.c.pl.retired", { list: retired.map((r) => r.replace(":", " → ")).join(", ") })
}

/** Nhóm quảng cáo đang để Meta tự chọn vị trí (không khai nền tảng/vị trí) không. */
export function isAutomaticPlacement(t: Targeting): boolean {
  return !Array.isArray(t.publisher_platforms)
}

/**
 * Targeting mới sau khi loại `exclude` (khoá báo cáo). Hàm thuần.
 *
 * Nền tảng không khai vị trí cụ thể (= mọi vị trí của nền tảng đó) → thay bằng
 * danh sách các vị trí ĐÃ phân phối trong kỳ (`delivered`) trừ vị trí bị loại.
 * Không tự liệt kê "mọi vị trí Meta có": danh sách đó đổi theo thời gian và
 * một giá trị lỗi thời làm Meta từ chối cả lệnh.
 * Đặt vị trí cụ thể = TẮT vị trí tự động (Advantage+) — nơi gọi phải báo điều đó.
 */
export function excludePlacements(t: Targeting, exclude: string[], delivered: string[]): { next: Targeting; unsupported: string[]; changed: boolean } {
  const unsupported = exclude.filter((k) => !MAP[k])
  const drop = exclude.map((k) => MAP[k]).filter(Boolean) as PlacementTarget[]
  const next: Targeting = JSON.parse(JSON.stringify(t))
  const deliveredTargets = delivered.map((k) => MAP[k]).filter(Boolean) as PlacementTarget[]

  let platforms: string[] = Array.isArray(t.publisher_platforms)
    ? [...(t.publisher_platforms as string[])]
    : [...new Set(deliveredTargets.map((d) => d.platform))]
  let changed = false
  for (const field of POSITION_FIELDS) {
    const dropHere = drop.filter((d) => d.field === field)
    if (!dropHere.length) continue
    const platform = dropHere[0].platform
    if (!platforms.includes(platform)) continue
    const current: string[] = Array.isArray(t[field])
      ? [...(t[field] as string[])]
      : [...new Set(deliveredTargets.filter((d) => d.field === field).map((d) => d.value))]
    const kept = current.filter((v) => !dropHere.some((d) => d.value === v))
    if (kept.length === current.length) continue
    changed = true
    if (kept.length) next[field] = kept
    else {
      delete next[field]
      platforms = platforms.filter((p) => p !== platform)
    }
  }
  if (changed) {
    if (!platforms.length) throw new Error("Loại hết vị trí thì nhóm quảng cáo không còn chỗ hiển thị — dùng Dừng nhóm quảng cáo thay vì loại vị trí")
    next.publisher_platforms = platforms
    // Nền tảng giữ lại mà trước đó để "mọi vị trí": ghi rõ các vị trí đã phân phối,
    // nếu không Meta sẽ hiểu khác lần đọc sau (so đọc lại lệch).
    for (const field of POSITION_FIELDS) {
      const p = deliveredTargets.find((d) => d.field === field)?.platform
      if (!p || !platforms.includes(p) || Array.isArray(next[field])) continue
      const vals = [...new Set(deliveredTargets.filter((d) => d.field === field).map((d) => d.value))]
      if (vals.length) next[field] = vals
    }
  }
  return { next, unsupported, changed }
}

/** Tóm tắt vị trí của targeting để so trước/sau — thứ tự không quan trọng. */
export function placementSummary(t: Targeting): string {
  if (isAutomaticPlacement(t)) return "Tự động (Advantage+)"
  const parts = [`nền tảng: ${[...(t.publisher_platforms as string[])].sort().join(", ")}`]
  for (const f of POSITION_FIELDS) if (Array.isArray(t[f])) parts.push(`${f.replace("_positions", "")}: ${[...(t[f] as string[])].sort().join(", ")}`)
  return parts.join(" · ")
}
