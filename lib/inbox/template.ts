// Dịch NGƯỢC câu đã lưu bằng tiếng Việt (data/*.json do cron/job sinh) sang ngôn ngữ người xem — HÀM THUẦN.
// Cách làm: các khoá từ điển cùng nhóm (tiền tố) có bản vi là KHUÔN câu ("Bản tách \"{n}\" nên hoàn tác …"); câu đã lưu khớp
// khuôn nào thì lấy phần biến rồi dựng lại bằng t(khoá, biến). Không khớp khuôn nào → trả NGUYÊN câu (tiếng Việt) — không bao giờ mất chữ.
// Quy ước tên biến: kết thúc bằng "N" = số nguyên ("cntN"); kết thúc bằng "R" = dịch đệ quy bằng cùng nhóm; còn lại = bất kỳ.
import { vi, type MessageKey } from "@/lib/i18n/messages"
import type { TFunction } from "@/lib/i18n/translate"

interface Compiled { key: MessageKey; re: RegExp; vars: string[]; weight: number }
const cache = new Map<string, Compiled[]>()
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function compile(prefix: string): Compiled[] {
  const hit = cache.get(prefix)
  if (hit) return hit
  const out: Compiled[] = []
  for (const [key, text] of Object.entries(vi)) {
    if (!key.startsWith(prefix)) continue
    const parts = text.split(/\{(\w+)\}/)
    const vars: string[] = []
    let src = "^", weight = 0
    parts.forEach((p, i) => {
      if (i % 2 === 0) { src += esc(p); weight += p.length }
      else { vars.push(p); src += p.endsWith("N") ? "(-?\\d+)" : "(.*?)" }
    })
    out.push({ key: key as MessageKey, re: new RegExp(src + "$", "s"), vars, weight })
  }
  out.sort((a, b) => b.weight - a.weight)
  cache.set(prefix, out)
  return out
}

const LIT = "libcase.w.pat.lit."
/** Số tiền / số có dấu chấm nghìn kiểu Việt → kiểu của ngôn ngữ đích (chỉ đổi khi ngôn ngữ đích không dùng dấu chấm nghìn). */
export function fixNumbers(s: string, t: TFunction): string {
  if (t("libcase.w.numLocale") === "vi-VN") return s
  return s.replace(/(?<![\d.])\d{1,3}(?:\.\d{3})+(?![\d.])/g, (m) => m.replace(/\./g, ","))
}
function fixVar(v: string, t: TFunction): string {
  const lit = compile(LIT).find((c) => c.vars.length === 0 && vi[c.key] === v)
  return lit ? t(lit.key) : fixNumbers(v, t)
}

/** Câu `text` đã lưu (vi) → ngôn ngữ của `t` theo khuôn trong các nhóm `prefixes`. Không khớp → trả nguyên. */
export function localizeText(text: string, prefixes: string | string[], t: TFunction): string {
  if (!text || t("libcase.w.numLocale") === "vi-VN") return text // tiếng Việt: giữ nguyên byte
  for (const prefix of Array.isArray(prefixes) ? prefixes : [prefixes]) {
    for (const c of compile(prefix)) {
      const m = c.re.exec(text)
      if (!m) continue
      const vars: Record<string, string> = {}
      c.vars.forEach((name, i) => {
        const raw = m[i + 1]
        vars[name] = name.endsWith("R") ? localizeText(raw, prefixes, t) : fixVar(raw, t)
      })
      return t(c.key, vars)
    }
  }
  return text
}
