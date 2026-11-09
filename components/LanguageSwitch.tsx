"use client"
// Nút VI | EN (thanh trên cùng + trang đăng nhập).
import { LOCALES } from "@/lib/i18n/config"
import { useLocale, useSetLocale, useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale()
  const setLocale = useSetLocale()
  const t = useT()
  return (
    <div role="group" aria-label={t("common.language")} className={cn("inline-flex overflow-hidden rounded-md border border-slate-200 text-xs font-semibold", className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          onClick={() => { if (l !== locale) setLocale(l) }}
          className={cn("px-2 py-1 uppercase transition-colors", locale === l ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
        >
          {l === "vi" ? "VI" : "EN"}
        </button>
      ))}
    </div>
  )
}
