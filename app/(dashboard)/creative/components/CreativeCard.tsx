"use client";

import { useState } from "react";
import {
  Copy, Heart, RefreshCw, Trash2, CheckCircle,
  Check, Edit3, BookOpen, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdCreative, Platform } from "@/types/ads.types";
import { useAdsStore } from "@/store/useAdsStore";
import { useT } from "@/lib/i18n/client";
import { ScoreBadge, CreativePlatformBadge } from "./ScoreBadge";

// ─────────────────────────────────────────────
// Link Campaign Mini-Modal (used in step 3)
// ─────────────────────────────────────────────

function LinkCampaignMini({
  creativeId, onClose, onLinked,
}: { creativeId: string; onClose: () => void; onLinked: (name: string) => void }) {
  const t = useT();
  const { campaigns } = useAdsStore();
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState(false);

  const active = campaigns
    .filter((c) => c.status === "ACTIVE")
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  async function handleLink(campaignId: string, campaignName: string) {
    setLinking(true);
    await fetch("/api/creatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", id: creativeId, campaign_id: campaignId, campaign_name: campaignName }),
    });
    setLinking(false);
    onLinked(campaignName);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{t("creative.wizard.card.linkTitle")}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <Input placeholder={t("creative.wizard.card.searchCampaign")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-sm" />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {active.length === 0 ? (
              <p className="text-center text-xs text-slate-400 py-4">{t("creative.wizard.card.noActive")}</p>
            ) : active.map((c) => (
              <button key={c.id} onClick={() => handleLink(c.id, c.name)} disabled={linking}
                className="w-full text-left rounded-lg border border-slate-200 px-3 py-2 text-xs hover:border-amber-300 hover:bg-amber-50/50 transition-colors">
                <p className="font-semibold text-slate-700 truncate">{c.name}</p>
                <p className="text-slate-400 mt-0.5">{c.platform} · CTR {c.metrics.ctr.toFixed(2)}%</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CreativeCard
// ─────────────────────────────────────────────

export function CreativeCard({
  creative, onCopy, onSave, onRemove, onRegenerate, onUpdate, isSaved = false,
  product, selectedTones, segment,
}: {
  creative: AdCreative; onCopy: () => void; onSave?: () => void;
  onRemove?: () => void; onRegenerate?: () => void; onUpdate?: (updated: Partial<AdCreative>) => void;
  isSaved?: boolean;
  product?: string; selectedTones?: string[]; segment?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [savedToLib, setSavedToLib] = useState(false);
  const [linkedCampaign, setLinkedCampaign] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [savingToLib, setSavingToLib] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    headline: creative.headline,
    primaryText: creative.primaryText,
    description: creative.description,
    cta: creative.cta,
  });
  const isFb = creative.platform === "facebook";

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSaveToLibrary() {
    if (savedToLib || savingToLib) return;
    setSavingToLib(true);
    try {
      const res = await fetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          creative: {
            id: creative.id,
            headline: creative.headline,
            primary_text: creative.primaryText ?? "",
            description: creative.description ?? "",
            cta: creative.cta ?? "Tìm hiểu thêm",
            tone_of_voice: selectedTones ?? [],
            product: product ?? "",
            segment: segment ?? "",
            platform: creative.platform,
            ai_quality_score: creative.score ?? 0, // 0 = chưa chấm (không bịa điểm 5)
            predicted_ctr_range: "", // không có dự đoán CTR thật — trước 07/10 gõ cứng "1.5-2.5%"
            status: "draft",
            generated_by: "ai",
            company: (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("company")) || null,
          },
        }),
      });
      if (res.ok) setSavedToLib(true);
    } finally {
      setSavingToLib(false);
    }
  }

  return (
    <div className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <CreativePlatformBadge platform={creative.platform} />
        <ScoreBadge score={creative.score} />
      </div>

      <div className="flex-1 space-y-3 text-sm">
        {isFb ? (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">📝 Primary Text</p>
              <p className="text-slate-700 leading-relaxed">{creative.primaryText}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">📌 Headline</p>
              <p className="font-bold text-slate-800">{creative.headline}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">📄 Description</p>
              <p className="text-slate-600">{creative.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">🎯 CTA</span>
              <span className="rounded-md bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white">{creative.cta}</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Headlines</p>
              <p className="font-bold text-amber-800">{creative.headline}</p>
              {creative.primaryText && <p className="text-slate-600 text-xs mt-0.5">{creative.primaryText}</p>}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">Description</p>
              <p className="text-slate-700 leading-relaxed">{creative.description}</p>
            </div>
          </>
        )}

        {creative.reason && (
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs italic text-slate-400">
            💡 {creative.reason}
          </p>
        )}

        {/* Library save status */}
        {savedToLib && (
          <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            {t("creative.wizard.card.savedToLib")}{linkedCampaign ? ` · ${t("creative.wizard.card.linked", { name: linkedCampaign })}` : ""}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
        <button onClick={handleCopy} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700">
          {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </button>

        <button
          onClick={handleSaveToLibrary}
          disabled={savedToLib || savingToLib}
          className={cn(
            "flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
            savedToLib
              ? "text-emerald-600 bg-emerald-50"
              : "text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700"
          )}
        >
          <BookOpen className="h-3.5 w-3.5" />
          {savedToLib ? t("creative.wizard.card.saved") : savingToLib ? t("creative.wizard.card.saving") : t("creative.wizard.card.saveLib")}
        </button>

        {savedToLib && (
          <button
            onClick={() => setShowLinkModal(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-800"
          >
            <Link2 className="h-3.5 w-3.5" />
            {linkedCampaign ? "Re-link" : t("creative.wizard.card.linkCampaign")}
          </button>
        )}

        {onSave && (
          <button onClick={onSave} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700">
            <Heart className="h-3.5 w-3.5" /> Save
          </button>
        )}
        {onUpdate && !editing && (
          <button onClick={() => { setEditing(true); setEditData({ headline: creative.headline, primaryText: creative.primaryText, description: creative.description, cta: creative.cta }); }} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-800">
            <Edit3 className="h-3.5 w-3.5" /> {t("creative.wizard.card.edit")}
          </button>
        )}
        {onRegenerate && (
          <button onClick={onRegenerate} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700">
            <RefreshCw className="h-3.5 w-3.5" /> Redo
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>

      {showLinkModal && (
        <LinkCampaignMini
          creativeId={creative.id}
          onClose={() => setShowLinkModal(false)}
          onLinked={(name) => setLinkedCampaign(name)}
        />
      )}

      {/* ── Inline Editor Modal ── */}
      {editing && (
        <div className="mt-3 mx-3 mb-3 rounded-xl border-2 border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-800 flex items-center gap-1"><Edit3 className="h-3.5 w-3.5" /> {t("creative.wizard.card.editTitle")}</p>
            <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">✕ {t("creative.wizard.card.cancel")}</button>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Headline</label>
              <input type="text" value={editData.headline} onChange={e => setEditData(d => ({ ...d, headline: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            {isFb && (
              <div>
                <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Primary Text</label>
                <textarea rows={3} value={editData.primaryText} onChange={e => setEditData(d => ({ ...d, primaryText: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none" />
              </div>
            )}
            <div>
              <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">Description</label>
              <input type="text" value={editData.description} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 mb-0.5 block">CTA</label>
              <input type="text" value={editData.cta} onChange={e => setEditData(d => ({ ...d, cta: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditing(false)}>{t("creative.wizard.card.cancel")}</Button>
            <Button size="sm" className="gap-1 text-xs bg-amber-500 hover:bg-amber-600 text-amber-950" onClick={() => {
              onUpdate?.(editData);
              setEditing(false);
            }}>
              <Check className="h-3 w-3" /> {t("creative.wizard.card.saveChanges")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
