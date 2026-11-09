"use client";

import { Card, CardContent } from "@/components/ui/card";
import PlatformBadge from "@/components/PlatformBadge";
import { cn } from "@/lib/utils";
import type { AdCreative } from "@/types/ads.types";
import { ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";

interface CreativePreviewProps {
  creative: AdCreative;
  className?: string;
}

export default function CreativePreview({
  creative,
  className,
}: CreativePreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = `${creative.headline}\n\n${creative.primaryText}\n\n${creative.description}\n\nCTA: ${creative.cta}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card
      className={cn(
        "group border border-slate-200 bg-white shadow-sm rounded-xl transition-all duration-200 hover:shadow-md overflow-hidden",
        className
      )}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={creative.platform} />
          <span className="text-xs text-slate-400 capitalize">{creative.format}</span>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
            title="Preview"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <CardContent className="p-5 space-y-2">
        {/* Headline */}
        <h4 className="text-base font-bold text-slate-800 leading-snug">
          {creative.headline}
        </h4>

        {/* Primary Text */}
        {creative.primaryText && (
          <p className="text-sm text-slate-700 leading-relaxed">
            {creative.primaryText}
          </p>
        )}

        {/* Description */}
        <p className="text-sm text-slate-500 leading-relaxed">
          {creative.description}
        </p>

        {/* CTA */}
        <div className="pt-1">
          <span className="inline-flex items-center rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm">
            {creative.cta}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
