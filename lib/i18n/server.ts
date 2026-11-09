// Máy chủ: đọc ngôn ngữ từ cookie (layout gốc, component server, route).
import { cookies } from "next/headers"
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config"
import { makeT, type TFunction } from "./translate"

export async function getLocale(): Promise<Locale> {
  try {
    const v = (await cookies()).get(LOCALE_COOKIE)?.value
    return isLocale(v) ? v : defaultLocale()
  } catch {
    return defaultLocale() // ngoài phạm vi yêu cầu (vd lúc build)
  }
}

export async function getT(): Promise<TFunction> {
  return makeT(await getLocale())
}
