"use client";

import { cn } from "@/lib/utils";
import { CTA_LABELS_VI, resolveCtaType } from "@/lib/creative-pipeline";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface FBAdPreviewProps {
  pageName?: string;
  pageAvatar?: string; // URL or initials fallback
  primaryText?: string;
  imageUrl?: string;
  headline?: string;
  description?: string;
  cta?: string;
  destinationUrl?: string;
  className?: string;
}

export default function FBAdPreview({
  pageName = "Page Name",
  pageAvatar,
  primaryText = "",
  imageUrl,
  headline = "",
  description = "",
  cta = "LEARN_MORE",
  destinationUrl = "",
  className,
}: FBAdPreviewProps) {
  const t = useT();
  // Resolve through the same canonical mapping used at launch time so the
  // preview always shows the CTA button Facebook will actually render —
  // previously this looked up a separate, out-of-sync label table keyed by
  // the underscored Meta enum while `cta` was passed as raw AI text like
  // "Get Offer", so the lookup silently missed every time.
  const ctaType = resolveCtaType(cta);
  const ctaKey = `panels.fbpreview.cta.${ctaType}` as MessageKey;
  const ctaText = t(ctaKey);
  const ctaLabel = ctaText === ctaKey ? CTA_LABELS_VI[ctaType] : ctaText;
  const domain = (() => {
    try { return new URL(destinationUrl).hostname.replace("www.", ""); } catch { return destinationUrl; }
  })();

  return (
    <div className={cn("w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden font-sans", className)}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
        {pageAvatar ? (
          <img src={pageAvatar} alt={pageName} className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold shrink-0">
            {pageName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 truncate">{pageName}</p>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-500">{t("panels.fbpreview.sponsored")}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[11px] text-slate-400">🌐</span>
          </div>
        </div>
        <button className="text-slate-400 text-lg leading-none">···</button>
      </div>

      {/* Primary text */}
      {primaryText && (
        <p className="px-3 pb-2 text-[13px] text-slate-800 leading-snug whitespace-pre-wrap line-clamp-3">
          {primaryText}
        </p>
      )}

      {/* Image / placeholder */}
      <div className="w-full bg-slate-100 aspect-[1.91/1] flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={t("panels.fbpreview.adAlt")} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center text-slate-400">
            <svg className="h-10 w-10 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 16l5-5 4 4 3-3 6 6" />
              <circle cx="8.5" cy="8.5" r="1.5" />
            </svg>
            <span className="text-xs">{t("panels.fbpreview.imagePlaceholder")}</span>
          </div>
        )}
      </div>

      {/* Headline + CTA bar */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {domain && (
            <p className="text-[10px] uppercase tracking-wide text-slate-400 truncate">{domain}</p>
          )}
          {headline && (
            <p className="text-[13px] font-bold text-slate-900 truncate">{headline}</p>
          )}
          {description && (
            <p className="text-[11px] text-slate-500 truncate">{description}</p>
          )}
        </div>
        <button className="shrink-0 rounded-md bg-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-300 transition-colors whitespace-nowrap">
          {ctaLabel}
        </button>
      </div>

      {/* Reactions row */}
      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-slate-400">
        <div className="flex items-center gap-1 text-[11px]">
          <span>👍</span><span>❤️</span>
          <span className="ml-1">123</span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span>{t("panels.fbpreview.comments")}</span>
          <span>{t("panels.fbpreview.shares")}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center border-t border-slate-100 divide-x divide-slate-100">
        {(["panels.fbpreview.like", "panels.fbpreview.comment", "panels.fbpreview.share"] as MessageKey[]).map((label) => (
          <button
            key={label}
            className="flex-1 py-2 text-[12px] font-medium text-slate-500 hover:bg-slate-50 transition-colors"
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
