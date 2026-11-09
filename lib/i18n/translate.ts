import type { Locale } from "./config"
import { MESSAGES, type MessageKey } from "./messages"

export type Vars = Record<string, string | number>
export type TFunction = (key: MessageKey, vars?: Vars) => string

/** t(key, {name}) — thay {name} trong câu. Khoá lạ (không thể xảy ra nhờ kiểu) → trả chính khoá để thấy ngay. */
export function makeT(locale: Locale): TFunction {
  const dict = MESSAGES[locale]
  return (key, vars) => {
    const s = dict[key] ?? MESSAGES.vi[key] ?? key
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s
  }
}
