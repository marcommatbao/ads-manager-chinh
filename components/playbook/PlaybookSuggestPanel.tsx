"use client";

// ============================================================
// Đợt 7b — panel "📒 Từ Sổ kinh nghiệm" cho wizard tạo chiến dịch Meta
// ============================================================
// Đọc gợi ý qua usePlaybookSuggest (CHỈ ĐỌC). Panel này SỞ HỮU việc quyết định
// áp/gỡ từng gợi ý, nhưng KHÔNG sở hữu state đích (tuổi/sở thích/sự kiện —
// những state đó do page.tsx quản lý) — mọi thay đổi đi qua callback prop.
//
// Vị trí/sự kiện "Nên tránh" mang sẵn entryId + status từ API: status auto/approved
// → mặc định BỎ vị trí khi tạo; suggested → chỉ hiện, mặc định KHÔNG bỏ. Người dùng
// đảo mặc định của dòng auto/approved = trái khuyến nghị (ghi vào overriddenAvoidIds).

import { useEffect, useRef, useState } from "react";
import { Copy, Check, Undo2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { usePlaybookSuggest } from "@/hooks/usePlaybookSuggest";
import { placementLabel } from "@/lib/case/meta-placements";
import type { ConversionEventOption, PixelEventsPayload } from "@/lib/meta-pixel-events";
import { optionToSelection, type ConversionEventSelection } from "@/components/creative/ConversionEventPicker";
import type { MetaSuggestions, SuggestItem } from "@/lib/playbook/suggest";
import useSWR from "swr";

const CONTENT_KIND_VI: Record<string, MessageKey> = { ad_format: "overview.playbook.suggest.kindFormat", hook: "overview.playbook.suggest.kindHook", headline: "overview.playbook.suggest.kindHeadline", cta: "overview.playbook.suggest.kindCta" };
const isStrongAvoid = (status: string) => status === "auto" || status === "approved";

export interface PlaybookLaunchState {
  keptEntryIds: string[];
  excludePlacements: string[];
  overriddenAvoidIds: string[];
}

export interface PlaybookSuggestPanelProps {
  /** false khi AI còn đang tra sở thích của phân khúc — lúc tra xong page.tsx GHI ĐÈ cả
   *  editedInterestsMap, nên điền trước lúc đó là mất. */
  interestsReady: boolean;
  /** Đổi mỗi lần sở thích được tra lại (tạo lại phân khúc) → panel điền lại từ đầu. */
  resetKey: unknown;
  company: string;
  /** Mã sản phẩm wizard (kebab-case, vd "ten-mien"). Rỗng = chưa chọn sản phẩm. */
  product: string;
  /** Index (trong audienceData.audienceSegments) của các segment đang được chọn để launch. */
  segmentIndices: number[];
  /** null = segment CHƯA bị người dùng (hay panel) chỉnh tuổi. */
  getSegmentAge: (segIdx: number) => { ageMin: number; ageMax: number } | null;
  applyAge: (segIdx: number, ageMin: number, ageMax: number) => void;
  undoAge: (segIdx: number) => void;
  /** ID sở thích ĐANG có của segment (đã resolve hoặc đã chỉnh tay). */
  getSegmentInterestIds: (segIdx: number) => string[];
  appendInterests: (segIdx: number, interests: { id: string; name: string }[]) => void;
  removeInterests: (segIdx: number, ids: string[]) => void;
  pixelId: string;
  conversionEvent: ConversionEventSelection | null;
  onSetConversionEvent: (sel: ConversionEventSelection | null) => void;
  onStateChange: (state: PlaybookLaunchState) => void;
}

const fetcher = async (url: string): Promise<PixelEventsPayload> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function ConfidenceChip({ c }: { c: "high" | "medium" }) {
  const t = useT();
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold shrink-0",
      c === "high" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
      {c === "high" ? t("overview.playbook.suggest.confHigh") : t("overview.playbook.suggest.confMed")}
    </span>
  );
}

function WhyLine({ why }: { why: string }) {
  return <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{why}</p>;
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title={t("overview.playbook.suggest.copy")}
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="shrink-0 text-slate-300 hover:text-slate-600">
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export default function PlaybookSuggestPanel({
  company, product, segmentIndices,
  getSegmentAge, applyAge, undoAge,
  getSegmentInterestIds, appendInterests, removeInterests,
  pixelId, conversionEvent, onSetConversionEvent,
  onStateChange, interestsReady, resetKey,
}: PlaybookSuggestPanelProps) {
  const t = useT();
  const { suggestions, loading, error } = usePlaybookSuggest(company, "facebook", product);

  // Danh sách sự kiện thật của Pixel — CÙNG khoá SWR với ConversionEventPicker
  // nên không tốn thêm lượt gọi nếu đã đọc ở Bước 1.
  const { data: pixelData } = useSWR<PixelEventsPayload>(
    pixelId ? `/api/creative/pixel-events?pixelId=${encodeURIComponent(pixelId)}` : null, fetcher,
    { revalidateOnFocus: false },
  );
  const findOption = (want: { pixelEvent?: string; customEventName?: string }): ConversionEventOption | null => {
    const opts = pixelData?.options ?? [];
    if (want.pixelEvent) return opts.find((o) => o.kind === "standard" && o.enumValue === want.pixelEvent) ?? null;
    if (want.customEventName) {
      const n = want.customEventName.trim().toLowerCase();
      return opts.find((o) => o.kind === "custom_event" && (o.pixelEventName ?? "").trim().toLowerCase() === n) ?? null;
    }
    return null;
  };

  // ── Sổ theo dõi những gì PANEL đã áp (để Hoàn tác đúng phần đã thêm, không
  // đụng vào phần người dùng tự làm trước/sau đó). ──
  const [ageApplied, setAgeApplied] = useState<Map<string, number[]>>(new Map()); // entryId -> segIdx đã điền
  const [interestsApplied, setInterestsApplied] = useState<Map<string, Map<number, string[]>>>(new Map()); // entryId -> segIdx -> id đã thêm
  const [optEventApplied, setOptEventApplied] = useState<string | null>(null); // entryId đang áp, null = chưa/đã gỡ
  const [uncheckedPlacements, setUncheckedPlacements] = useState<Set<string>>(new Set());
  const [keptExtra, setKeptExtra] = useState<Set<string>>(new Set()); // entryId đã "Thêm" (không qua auto-fill)

  const autoFilledFor = useRef<string | null>(null);

  // ── Áp một gợi ý TUỔI vào mọi segment CHƯA bị chỉnh — dùng chung cho cả
  // auto-fill (apply) lẫn nút "Thêm" (suggest). ──
  const applyAgeSuggestion = (entryId: string, min: number, max: number) => {
    const touched: number[] = [];
    for (const idx of segmentIndices) {
      if (getSegmentAge(idx)) continue; // đã có (người dùng hoặc panel) — không đè
      applyAge(idx, min, max);
      touched.push(idx);
    }
    if (touched.length) setAgeApplied((prev) => new Map(prev).set(entryId, touched));
  };
  const undoAgeSuggestion = (entryId: string) => {
    const segs = ageApplied.get(entryId) ?? [];
    for (const idx of segs) undoAge(idx);
    setAgeApplied((prev) => { const n = new Map(prev); n.delete(entryId); return n; });
  };

  const applyInterestSuggestion = (entryId: string, interests: { id: string; name: string }[]) => {
    const perSeg = new Map<number, string[]>();
    for (const idx of segmentIndices) {
      const current = new Set(getSegmentInterestIds(idx));
      const fresh = interests.filter((i) => !current.has(i.id));
      if (!fresh.length) continue;
      appendInterests(idx, fresh);
      perSeg.set(idx, fresh.map((f) => f.id));
    }
    if (perSeg.size) setInterestsApplied((prev) => new Map(prev).set(entryId, perSeg));
  };
  const undoInterestSuggestion = (entryId: string) => {
    const perSeg = interestsApplied.get(entryId);
    if (perSeg) for (const [idx, ids] of perSeg) removeInterests(idx, ids);
    setInterestsApplied((prev) => { const n = new Map(prev); n.delete(entryId); return n; });
  };

  const applyOptEventSuggestion = (entryId: string, want: { pixelEvent?: string; customEventName?: string }) => {
    const opt = findOption(want);
    if (!opt) return false;
    onSetConversionEvent(optionToSelection(opt));
    setOptEventApplied(entryId);
    return true;
  };
  const undoOptEventSuggestion = () => { onSetConversionEvent(null); setOptEventApplied(null); };

  // Phân khúc/sở thích được tra lại → mọi thứ panel đã điền đã bị page.tsx ghi đè → điền lại.
  const lastResetKey = useRef<unknown>(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    autoFilledFor.current = null;
    setAgeApplied(new Map());
    setInterestsApplied(new Map());
  }, [resetKey]);

  // ── Auto-fill MỘT LẦN cho mỗi (company, product), khi segment + sở thích AI + sự kiện Pixel đã sẵn sàng. ──
  useEffect(() => {
    if (!suggestions || !segmentIndices.length || !interestsReady) return;
    // Có gợi ý sự kiện mà danh sách sự kiện Pixel chưa tải → chờ, không thì bỏ lỡ vĩnh viễn.
    if (suggestions.apply.meta.optEvent && conversionEvent === null && pixelId && !pixelData) return;
    const key = `${company}|${product}`;
    if (autoFilledFor.current === key) return;
    autoFilledFor.current = key;
    const a = suggestions.apply.meta;
    if (a.age) applyAgeSuggestion(a.age.entryId, a.age.min, a.age.max);
    for (const it of a.interests) applyInterestSuggestion(it.entryId, it.interests);
    if (a.optEvent && conversionEvent === null) {
      applyOptEventSuggestion(a.optEvent.entryId, { pixelEvent: a.optEvent.pixelEvent, customEventName: a.optEvent.customEventName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, segmentIndices.length, company, product, interestsReady, pixelData, resetKey]);

  // ── Vị trí nên tránh: reset lựa chọn tay khi đổi (công ty, sản phẩm). ──
  const placementsInitFor = useRef<string | null>(null);
  useEffect(() => {
    if (!suggestions) return;
    const key = `${company}|${product}`;
    if (placementsInitFor.current === key) return;
    placementsInitFor.current = key;
    setUncheckedPlacements(new Set());
  }, [suggestions, company, product]);

  // ── Gộp & báo lên page.tsx mỗi khi có gì đổi. ──
  useEffect(() => {
    if (!suggestions) { onStateChange({ keptEntryIds: [], excludePlacements: [], overriddenAvoidIds: [] }); return; }
    const kept = new Set<string>([...ageApplied.keys(), ...interestsApplied.keys(), ...keptExtra.values()]);
    if (optEventApplied) kept.add(optEventApplied);
    const excludePlacements: string[] = [];
    const overridden = new Set<string>();
    for (const it of suggestions.avoidPlacements) {
      const byDefault = isStrongAvoid(it.status);
      const flipped = uncheckedPlacements.has(it.key);
      if (byDefault !== flipped) excludePlacements.push(it.key);
      if (byDefault && flipped) overridden.add(it.entryId);
    }
    // Sự kiện tối ưu hiện tại trùng "Nên tránh" mà vẫn giữ → override.
    const curVal = conversionEvent?.pixelEvent ?? (conversionEvent?.pixelCustomEventName ? `OTHER:${conversionEvent.pixelCustomEventName}` : null);
    const avoidEv = curVal ? suggestions.avoidOptEvents.find((e) => e.value === curVal) : undefined;
    if (avoidEv) overridden.add(avoidEv.entryId);
    onStateChange({ keptEntryIds: [...kept], excludePlacements, overriddenAvoidIds: [...overridden] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, ageApplied, interestsApplied, keptExtra, optEventApplied, uncheckedPlacements, conversionEvent]);

  if (!product) return null;

  if (error) {
    return (
      <p className="text-[11px] text-slate-400 italic">
        {t("overview.playbook.suggest.loadErr")}
      </p>
    );
  }
  if (loading || !suggestions) {
    return <p className="text-[11px] text-slate-400">{t("overview.playbook.suggest.loading")}</p>;
  }

  const totalItems =
    (suggestions.apply.meta.age ? 1 : 0) + suggestions.apply.meta.interests.length + (suggestions.apply.meta.optEvent ? 1 : 0) +
    (suggestions.suggest.meta.age ? 1 : 0) + suggestions.suggest.meta.interests.length + (suggestions.suggest.meta.optEvent ? 1 : 0) +
    suggestions.avoid.length + suggestions.apply.meta.content.length + suggestions.suggest.meta.content.length;

  if (totalItems === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-400">
        {t("overview.playbook.suggest.none")}{" "}
        <a href="/so-kinh-nghiem" target="_blank" rel="noreferrer" className="text-amber-700 underline">{t("overview.playbook.suggest.viewPlaybook")}</a>
      </div>
    );
  }

  const bothMeta = (pick: (m: MetaSuggestions) => SuggestItem | null | undefined) =>
    ({ apply: pick(suggestions.apply.meta), suggest: pick(suggestions.suggest.meta) });

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-amber-900">{t("overview.playbook.suggest.heading")}</h4>
        <a href="/so-kinh-nghiem" target="_blank" rel="noreferrer" className="text-[10px] text-amber-700 underline">{t("overview.playbook.suggest.viewShort")}</a>
      </div>

      {/* ── Tuổi ── */}
      {(suggestions.apply.meta.age || suggestions.suggest.meta.age) && (
        <div className="space-y-1.5">
          {suggestions.apply.meta.age && (
            <SuggestRow
              label={t("overview.playbook.suggest.age", { min: suggestions.apply.meta.age.min, max: suggestions.apply.meta.age.max })}
              why={suggestions.apply.meta.age.why} confidence={suggestions.apply.meta.age.confidence}
              applied={ageApplied.has(suggestions.apply.meta.age.entryId)}
              onUndo={() => undoAgeSuggestion(suggestions.apply.meta.age!.entryId)}
              autoBadge
            />
          )}
          {suggestions.suggest.meta.age && (
            <SuggestRow
              label={t("overview.playbook.suggest.age", { min: suggestions.suggest.meta.age.min, max: suggestions.suggest.meta.age.max })}
              why={suggestions.suggest.meta.age.why} confidence={suggestions.suggest.meta.age.confidence}
              applied={keptExtra.has(suggestions.suggest.meta.age.entryId)}
              onAdd={() => { applyAgeSuggestion(suggestions.suggest.meta.age!.entryId, suggestions.suggest.meta.age!.min, suggestions.suggest.meta.age!.max); setKeptExtra((p) => new Set(p).add(suggestions.suggest.meta.age!.entryId)); }}
              onUndo={() => { undoAgeSuggestion(suggestions.suggest.meta.age!.entryId); setKeptExtra((p) => { const n = new Set(p); n.delete(suggestions.suggest.meta.age!.entryId); return n; }); }}
            />
          )}
        </div>
      )}

      {/* ── Sở thích ── */}
      {(suggestions.apply.meta.interests.length > 0 || suggestions.suggest.meta.interests.length > 0) && (
        <div className="space-y-1.5">
          {suggestions.apply.meta.interests.map((it) => (
            <SuggestRow key={it.entryId} label={it.label} why={it.why} confidence={it.confidence}
              applied={interestsApplied.has(it.entryId)} onUndo={() => undoInterestSuggestion(it.entryId)} autoBadge />
          ))}
          {suggestions.suggest.meta.interests.map((it) => (
            <SuggestRow key={it.entryId} label={it.label} why={it.why} confidence={it.confidence}
              applied={keptExtra.has(it.entryId)}
              onAdd={() => { applyInterestSuggestion(it.entryId, it.interests); setKeptExtra((p) => new Set(p).add(it.entryId)); }}
              onUndo={() => { undoInterestSuggestion(it.entryId); setKeptExtra((p) => { const n = new Set(p); n.delete(it.entryId); return n; }); }} />
          ))}
        </div>
      )}

      {/* ── Sự kiện tối ưu ── */}
      {(suggestions.apply.meta.optEvent || suggestions.suggest.meta.optEvent) && (() => {
        const { apply: a, suggest: s } = bothMeta((m) => m.optEvent);
        const rows: React.ReactNode[] = [];
        if (a) {
          const opt = findOption({ pixelEvent: (a as { pixelEvent?: string }).pixelEvent, customEventName: (a as { customEventName?: string }).customEventName });
          rows.push(opt
            ? <SuggestRow key="opt-apply" label={a.label} why={a.why} confidence={a.confidence}
                applied={optEventApplied === a.entryId} onUndo={undoOptEventSuggestion} autoBadge />
            : <SuggestRow key="opt-apply-miss" label={a.label} why={t("overview.playbook.suggest.eventMissCustom", { why: a.why })} confidence={a.confidence} applied={false} />);
        }
        if (s) {
          const opt = findOption({ pixelEvent: (s as { pixelEvent?: string }).pixelEvent, customEventName: (s as { customEventName?: string }).customEventName });
          rows.push(opt
            ? <SuggestRow key="opt-suggest" label={s.label} why={s.why} confidence={s.confidence}
                applied={optEventApplied === s.entryId}
                onAdd={conversionEvent === null ? () => applyOptEventSuggestion(s.entryId, { pixelEvent: (s as { pixelEvent?: string }).pixelEvent, customEventName: (s as { customEventName?: string }).customEventName }) : undefined}
                onUndo={optEventApplied === s.entryId ? undoOptEventSuggestion : undefined} />
            : <SuggestRow key="opt-suggest-miss" label={s.label} why={t("overview.playbook.suggest.eventMiss", { why: s.why })} confidence={s.confidence} applied={false} />);
        }
        return <div className="space-y-1.5">{rows}</div>;
      })()}

      {/* ── Nên tránh ── */}
      {suggestions.avoidPlacements.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-red-700 mb-1">{t("overview.playbook.suggest.avoidPlacements")}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.avoidPlacements.map((it) => {
              const k = it.key;
              const checked = isStrongAvoid(it.status) !== uncheckedPlacements.has(k);
              return (
                <label key={k} title={it.why} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2 py-0.5 text-[10px] text-red-700">
                  <input type="checkbox" checked={checked} className="accent-red-600"
                    onChange={() => setUncheckedPlacements((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                  {placementLabel(k)}{isStrongAvoid(it.status) ? "" : t("overview.playbook.suggest.suggestedSuffix")}
                </label>
              );
            })}
          </div>
          <p className="text-[9px] text-slate-400 mt-1">{t("overview.playbook.suggest.avoidNote")}</p>
        </div>
      )}
      {(() => {
        const curVal = conversionEvent?.pixelEvent ?? (conversionEvent?.pixelCustomEventName ? `OTHER:${conversionEvent.pixelCustomEventName}` : null);
        const found = curVal ? suggestions.avoidOptEvents.find((e) => e.value === curVal) : undefined;
        if (!found) return null;
        return (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-800">
              {t("overview.playbook.suggest.avoidEvent", { why: found ? `: ${found.why}` : "" })}
            </p>
          </div>
        );
      })()}

      {/* ── Tham khảo nội dung / vị trí đã thắng / mức ngân sách ── */}
      {(suggestions.apply.meta.content.length > 0 || suggestions.suggest.meta.content.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 mb-1">{t("overview.playbook.suggest.contentTitle")}</p>
          <div className="space-y-1">
            {[...suggestions.apply.meta.content, ...suggestions.suggest.meta.content].map((c, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded bg-white border border-slate-200 px-2 py-1">
                <span className="text-[9px] text-slate-400 shrink-0 w-14">{CONTENT_KIND_VI[c.kind] ? t(CONTENT_KIND_VI[c.kind]) : c.kind}</span>
                <span className="text-[10px] text-slate-700 flex-1">{c.text}</span>
                <CopyButton text={c.text} />
              </div>
            ))}
          </div>
        </div>
      )}
      {(suggestions.apply.meta.placements.length > 0 || suggestions.suggest.meta.placements.length > 0) && (
        <p className="text-[10px] text-slate-500">
          {t("overview.playbook.suggest.placementsWon", { v: [...suggestions.apply.meta.placements, ...suggestions.suggest.meta.placements].map((p) => p.label).join(", ") })}
        </p>
      )}
      {(suggestions.apply.meta.budgetTier || suggestions.suggest.meta.budgetTier) && (
        <p className="text-[10px] text-slate-500">
          {t("overview.playbook.suggest.budgetTier", { v: String((suggestions.apply.meta.budgetTier ?? suggestions.suggest.meta.budgetTier)?.tier ?? "") })}
        </p>
      )}

      {(suggestions.hiddenNonIncremental > 0 || suggestions.hiddenLegacyMerged > 0) && (
        <p className="text-[9px] text-slate-400">
          {suggestions.hiddenNonIncremental > 0 && t("overview.playbook.suggest.hiddenBrand", { n: suggestions.hiddenNonIncremental })}
          {suggestions.hiddenLegacyMerged > 0 && t("overview.playbook.suggest.hiddenLegacy", { n: suggestions.hiddenLegacyMerged })}
        </p>
      )}
    </div>
  );
}

function SuggestRow({
  label, why, confidence, applied, autoBadge, onAdd, onUndo,
}: {
  label: string; why: string; confidence: "high" | "medium"; applied: boolean;
  autoBadge?: boolean; onAdd?: () => void; onUndo?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-lg bg-white border border-slate-200 px-2.5 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-700">{label}</span>
          <ConfidenceChip c={confidence} />
          {applied && autoBadge && (
            <span className="rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[9px] font-semibold">{t("overview.playbook.suggest.badgePlaybook")}</span>
          )}
          {applied && !autoBadge && (
            <span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[9px] font-semibold">{t("overview.playbook.suggest.added")}</span>
          )}
        </div>
        <WhyLine why={why} />
      </div>
      {applied ? (
        onUndo && (
          <button type="button" onClick={onUndo} className="shrink-0 flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-600">
            <Undo2 className="h-3 w-3" /> {t("overview.playbook.suggest.undo")}
          </button>
        )
      ) : (
        onAdd && (
          <button type="button" onClick={onAdd} className="shrink-0 rounded bg-amber-500 text-amber-950 px-2 py-0.5 text-[10px] font-semibold hover:bg-amber-600">
            {t("overview.playbook.suggest.add")}
          </button>
        )
      )}
    </div>
  );
}
