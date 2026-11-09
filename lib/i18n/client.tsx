"use client"
// Client: ngôn ngữ ban đầu do layout gốc (máy chủ) truyền xuống → không nháy chữ lúc tải trang.
import { createContext, useCallback, useContext, useMemo } from "react"
import { useRouter } from "next/navigation"
import { INTL_LOCALE, LOCALE_COOKIE, type Locale } from "./config"
import { makeT, type TFunction } from "./translate"

const Ctx = createContext<Locale>("vi")

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>
}

export function useLocale(): Locale {
  return useContext(Ctx)
}

export function useT(): TFunction {
  const locale = useContext(Ctx)
  return useMemo(() => makeT(locale), [locale])
}

/** Mã Intl theo ngôn ngữ đang chọn — dùng cho toLocaleString / Intl.NumberFormat ở các màn đã dịch. */
export function useIntlLocale(): string {
  return INTL_LOCALE[useContext(Ctx)]
}

/** Đổi ngôn ngữ: ghi cookie 1 năm rồi refresh (máy chủ render lại theo ngôn ngữ mới, không rời trang). */
export function useSetLocale(): (next: Locale) => void {
  const router = useRouter()
  return useCallback((next: Locale) => {
    const secure = location.protocol === "https:" ? "; Secure" : ""
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    router.refresh()
  }, [router])
}
