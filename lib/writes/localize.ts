// Luồng ghi + kết quả đo lại được LƯU bằng câu tiếng Việt (data/write-feed.json, data/write-outcomes.json) → dịch lúc ĐỌC cho giao diện
// (route /api/writes). Dịch ngược theo khuôn câu cùng nhóm từ điển (xem lib/inbox/template.ts); câu lạ giữ nguyên (tiếng Việt).
import type { TFunction } from "@/lib/i18n/translate"
import { localizeText } from "@/lib/inbox/template"
import { EVENT_LABEL, eventLabel } from "./labels"
import type { WriteEvent } from "./feed"

const WRITE = "libcase.w.pat.write."
const isVi = (t: TFunction) => t("libcase.w.numLocale") === "vi-VN"

/** Nhãn sự kiện decision-memory: "Tên: tạm dừng chiến dịch — ghi chú" → "Tên: paused campaign — ghi chú" (ghi chú giữ nguyên). */
function eventPhrase(label: string, t: TFunction): string | null {
  for (const [code, phrase] of Object.entries(EVENT_LABEL)) {
    const i = label.lastIndexOf(`: ${phrase}`)
    if (i < 0) continue
    const rest = label.slice(i + 2 + phrase.length)
    if (rest === "" || rest.startsWith(" — ")) return `${label.slice(0, i)}: ${eventLabel(code, t)}${rest}`
  }
  return null
}

/** Nhãn một lần ghi (cả nhật ký phiên xử lý: "Tên: 3 phủ định, dừng 1 chiến dịch"). */
export function localizeWriteLabel(label: string, t: TFunction): string {
  if (isVi(t)) return label
  const ev = eventPhrase(label, t)
  if (ev) return ev
  const m = /^(.*): ((?:\d+ phủ định|dừng \d+ chiến dịch|\d+ thay đổi Meta|gắn danh sách chặn)(?:, (?:\d+ phủ định|dừng \d+ chiến dịch|\d+ thay đổi Meta|gắn danh sách chặn))*|thực hiện)$/.exec(label)
  if (m) return `${m[1]}: ${m[2].split(", ").map((p) => localizeText(p, "libcase.w.pat.casepart.", t)).join(", ")}`
  // "N việc: a · b · c …" — chỉ dịch phần đếm, từng việc lấy nguyên văn từ đề xuất.
  return localizeText(label, WRITE, t)
}

export function localizeEvent<T extends WriteEvent>(e: T, t: TFunction): T {
  if (isVi(t)) return e
  return { ...e, sourceLabel: localizeText(e.sourceLabel, WRITE, t), label: localizeWriteLabel(e.label, t), by: localizeText(e.by, WRITE, t) } as T
}

const LINE = /^(CPA [\s\S]+?; đơn -?\d+ → -?\d+\.)(?: ([\s\S]*))?$/
/** Ghi chú kết quả đo lại (WindowResult.note). */
export function localizeOutcomeNote(note: string | undefined | null, t: TFunction): string {
  if (!note || isVi(t)) return note ?? ""
  const m = LINE.exec(note)
  if (m) {
    const line = localizeText(m[1], "libcase.w.pat.outline.", t)
    return m[2] ? `${line} ${localizeText(m[2], "libcase.w.pat.outsuf.", t)}` : line
  }
  return localizeText(note, "libcase.w.pat.outcome.", t)
}
