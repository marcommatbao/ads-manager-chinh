import { makeT, type TFunction } from "@/lib/i18n/translate"
// Nhãn phán quyết đo lại — tách khỏi outcome.ts để trang trình duyệt dùng được (outcome.ts kéo client Google Ads / Meta).
export type Verdict = "tot" | "xau" | "khong_doi" | "chua_ro"
export const VERDICT_LABEL: Record<Verdict, string> = { tot: "✓ Tốt", xau: "✕ Xấu", khong_doi: "= Không đổi", chua_ro: "○ Chưa rõ" }

export const verdictLabel = (v: Verdict, t: TFunction = makeT("vi")): string => (v in VERDICT_LABEL ? t(`libcase.verdict.${v}` as never) : String(v))
