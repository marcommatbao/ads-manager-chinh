// Sổ kinh nghiệm lưu nhãn / ghi chú bằng tiếng Việt (data/playbook/*.json) → dịch lúc ĐỌC cho giao diện. Logic (suggest.ts) vẫn chạy
// trên bản tiếng Việt gốc (nó so khớp "Sở thích: " …) — chỉ phần HIỂN THỊ đi qua các hàm này. Câu lạ (tên sở thích / vị trí …) giữ nguyên.
import type { TFunction } from "@/lib/i18n/translate"
import { localizeText } from "@/lib/inbox/template"

const PB = "libcase.w.pat.pb."
const isVi = (t: TFunction) => t("libcase.w.numLocale") === "vi-VN"

export function localizeEntryLabel(label: string, t: TFunction): string {
  if (isVi(t) || !label) return label
  // Dòng gộp nhiều đặc điểm nối bằng " + " (trừ "Bộ sở thích …" đã có khuôn riêng) → dịch từng phần.
  if (label.includes(" + ") && !label.startsWith("Bộ sở thích")) return label.split(" + ").map((p) => localizeText(p, PB, t)).join(" + ")
  return localizeText(label, PB, t)
}
export const localizePlaybookNote = (note: string, t: TFunction) => localizeText(note, "libcase.w.pat.pbnote.", t)
export const localizeProduct = (p: string, t: TFunction) => localizeText(p, "libcase.w.pat.lit.", t)
export const localizeOutcomeWhy = (why: string, t: TFunction) => localizeText(why, "libcase.w.pat.pbwhy.", t)

/** Một dòng Sổ → bản hiển thị (nhãn / ghi chú / sản phẩm / đặc điểm con). */
export function localizeEntry<E extends { label: string; note?: string; product: string; parts?: { value: string; label: string }[] }>(e: E, t: TFunction): E {
  if (isVi(t)) return e
  return {
    ...e,
    label: localizeEntryLabel(e.label, t),
    product: localizeProduct(e.product, t),
    ...(e.note ? { note: localizePlaybookNote(e.note, t) } : {}),
    ...(e.parts ? { parts: e.parts.map((p) => ({ ...p, label: localizeEntryLabel(p.label, t) })) } : {}),
  } as E
}
