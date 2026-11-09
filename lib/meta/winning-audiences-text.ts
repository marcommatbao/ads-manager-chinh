// Tóm tắt nhắm chọn Meta thành câu dễ đọc — tệp THUẦN (không fs), dùng chung kho tệp thắng + AI đánh giá.
/** Tóm tắt nhắm chọn dễ đọc — HÀM THUẦN. */
import { makeT, type TFunction } from "@/lib/i18n/translate"

export function targetingSummary(targeting: Record<string, unknown>, t: TFunction = makeT("vi")): string {
  const x = targeting as { age_min?: number; age_max?: number; genders?: number[]; geo_locations?: { countries?: string[]; regions?: { name?: string }[]; cities?: { name?: string }[] }; flexible_spec?: { interests?: { name: string }[]; behaviors?: { name: string }[] }[]; custom_audiences?: { name?: string; id: string }[]; targeting_automation?: { advantage_audience?: number } }
  const parts: string[] = []
  parts.push(t("libmeta.ts.age", { min: x.age_min ?? 18, max: x.age_max ?? 65 }))
  const g = x.genders ?? []
  parts.push(g.length === 1 ? (g[0] === 1 ? t("libmeta.ts.male") : t("libmeta.ts.female")) : t("libmeta.ts.allGenders"))
  const geo = [...(x.geo_locations?.cities ?? []).map((c) => c.name), ...(x.geo_locations?.regions ?? []).map((r) => r.name), ...(x.geo_locations?.countries ?? [])].filter(Boolean)
  if (geo.length) parts.push(geo.slice(0, 4).join(", ") + (geo.length > 4 ? ` +${geo.length - 4}` : ""))
  const interests = (x.flexible_spec ?? []).flatMap((f) => [...(f.interests ?? []), ...(f.behaviors ?? [])]).map((i) => i.name)
  if (interests.length) parts.push(t("libmeta.ts.interests", { list: interests.slice(0, 5).join(", "), more: interests.length > 5 ? ` +${interests.length - 5}` : "" }))
  if (x.custom_audiences?.length) parts.push(t("libmeta.ts.customAud", { n: x.custom_audiences.length }))
  if (!interests.length && !x.custom_audiences?.length) parts.push(t("libmeta.ts.broad"))
  if (x.targeting_automation?.advantage_audience === 1) parts.push(t("libmeta.ts.advantage"))
  return parts.join(" · ")
}

