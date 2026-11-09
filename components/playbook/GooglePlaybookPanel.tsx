"use client";

// ============================================================
// Đợt 7b — panel "📒 Từ Sổ kinh nghiệm" cho tab Keywords của Google Ads
// ============================================================
// Chủ đề (themes) + từ khoá đi qua onAddKeyword (đã có sẵn PATCH lưu XUỐNG
// ĐĨA — xem GoogleCreativePanel.patchKeywords), nên launch Search/PMax đọc
// đúng bản đã thêm (PMax lấy "Search Themes" từ CHÍNH danh sách từ khoá này).
//
// Từ phủ định: màn này chỉ sửa được state trình duyệt (chưa có API lưu
// negativeKeywords xuống creative), nên phủ định lấy từ Sổ được GỬI KÈM lệnh tạo
// qua `extraNegativeKeywords` (route Search gộp vào danh sách đã lưu). Nút xoá
// phủ định CÓ SẴN của app vẫn chỉ đổi state trình duyệt — lỗ cũ, ngoài 7b.

import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { usePlaybookSuggest } from "@/hooks/usePlaybookSuggest";

export interface GooglePlaybookLaunchState {
  keptEntryIds: string[];
  overriddenAvoidIds: string[];
  /** Từ phủ định lấy từ Sổ — gửi kèm lệnh tạo Search (route không đọc được phủ định sửa ở màn này). */
  extraNegativeKeywords: string[];
}

interface ExistingKeyword { keyword: string; matchType?: string }
interface NegativeItem { keyword: string; source?: string; entryId?: string }

export interface GooglePlaybookPanelProps {
  company: string;
  /** Mã sản phẩm wizard kebab-case (vd "ten-mien"), rỗng nếu không map được. */
  productKey: string;
  /** ID creative đã sinh — null = chưa sinh nội dung, chưa thêm được gì (chưa có nơi lưu). */
  resultId: string | null;
  existingKeywords: ExistingKeyword[];
  onAddKeyword: (text: string, matchType: string) => void | Promise<void>;
  negatives: NegativeItem[];
  onAddNegative: (item: NegativeItem) => void;
  onRemoveNegativeByEntry: (entryId: string, keyword: string) => void;
  landingUrl: string | null;
  onUseLandingUrl: (url: string) => void;
  onStateChange: (s: GooglePlaybookLaunchState) => void;
}

function ConfidenceChip({ c }: { c: "high" | "medium" }) {
  const t = useT();
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold shrink-0",
      c === "high" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
      {c === "high" ? t("overview.playbook.google.confHigh") : t("overview.playbook.google.confMed")}
    </span>
  );
}

export default function GooglePlaybookPanel({
  company, productKey, resultId, existingKeywords, onAddKeyword,
  negatives, onAddNegative, onRemoveNegativeByEntry,
  landingUrl, onUseLandingUrl, onStateChange,
}: GooglePlaybookPanelProps) {
  const t = useT();
  const { suggestions, loading, error } = usePlaybookSuggest(company, "google", productKey);

  const [kept, setKept] = useState<Set<string>>(new Set());
  const autoFilledFor = useRef<string | null>(null);

  const hasKeyword = (text: string) => existingKeywords.some((k) => k.keyword.trim().toLowerCase() === text.trim().toLowerCase());
  const hasNegative = (entryId: string, text: string) => negatives.some((n) => n.entryId === entryId && n.keyword === text);

  const addTheme = (entryId: string, text: string) => { onAddKeyword(text, "PHRASE"); setKept((p) => new Set(p).add(entryId)); };
  const addKw = (entryId: string, text: string, matchType: string) => { onAddKeyword(text, matchType); setKept((p) => new Set(p).add(entryId)); };
  const addNeg = (entryId: string, text: string) => { onAddNegative({ keyword: text, source: "playbook", entryId }); };
  const undoNeg = (entryId: string, keyword: string) => { onRemoveNegativeByEntry(entryId, keyword); };

  // Auto-fill 1 lần cho mỗi (company, productKey, resultId) — cần resultId vì
  // chưa sinh creative thì chưa có nơi lưu thêm từ khoá.
  useEffect(() => {
    if (!suggestions || !resultId) return;
    const key = `${company}|${productKey}|${resultId}`;
    if (autoFilledFor.current === key) return;
    autoFilledFor.current = key;
    // TUẦN TỰ: mỗi lần thêm là một PATCH trả về CẢ danh sách — chạy song song thì phản hồi về
    // lệch thứ tự ghi đè danh sách trên màn (PMax lấy Search Themes từ chính danh sách này).
    const ops = [
      ...suggestions.apply.google.themes.filter((t) => !hasKeyword(t.text)).map((t) => ({ id: t.entryId, text: t.text, mt: "PHRASE" })),
      ...suggestions.apply.google.keywords.filter((k) => !hasKeyword(k.text)).map((k) => ({ id: k.entryId, text: k.text, mt: k.matchType })),
    ];
    void (async () => { for (const o of ops) { await onAddKeyword(o.text, o.mt); setKept((p) => new Set(p).add(o.id)); } })();
    for (const n of suggestions.negatives) {
      if ((n.status === "auto" || n.status === "approved") && !hasNegative(n.entryId, n.text)) addNeg(n.entryId, n.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, resultId, company, productKey]);

  useEffect(() => {
    if (!suggestions) { onStateChange({ keptEntryIds: [], overriddenAvoidIds: [], extraNegativeKeywords: [] }); return; }
    // Phủ định Sổ khuyên thêm (auto/approved) mà giờ KHÔNG có trong danh sách hiện tại = người dùng đã gỡ → override.
    const overridden = new Set<string>();
    const keptNeg: string[] = [];
    for (const n of suggestions.negatives) {
      if (hasNegative(n.entryId, n.text)) keptNeg.push(n.entryId);
      else if (n.status === "auto" || n.status === "approved") overridden.add(n.entryId);
    }
    // Phủ định từ Sổ phải đi KÈM lệnh tạo: route đọc phủ định từ creative đã lưu, màn này không ghi xuống đó.
    const extraNegativeKeywords = negatives.filter((n) => n.source === "playbook").map((n) => String(n.keyword));
    // Chỉ tính dòng mà từ khoá của nó CÒN trong danh sách — người dùng xoá từ khoá đi thì không còn là "đã dùng".
    const all = [...suggestions.apply.google.themes, ...suggestions.suggest.google.themes, ...suggestions.apply.google.keywords, ...suggestions.suggest.google.keywords];
    const keptKw = all.filter((t) => kept.has(t.entryId) && hasKeyword(t.text)).map((t) => t.entryId);
    onStateChange({ keptEntryIds: [...new Set([...keptKw, ...keptNeg])], overriddenAvoidIds: [...overridden], extraNegativeKeywords });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, kept, negatives, existingKeywords]);

  if (!productKey) return null;
  if (error) return <p className="text-[11px] text-slate-400 italic">{t("overview.playbook.google.loadErr")}</p>;
  if (loading || !suggestions) return <p className="text-[11px] text-slate-400">{t("overview.playbook.google.loading")}</p>;

  const themes = [...suggestions.apply.google.themes, ...suggestions.suggest.google.themes];
  const kws = [...suggestions.apply.google.keywords, ...suggestions.suggest.google.keywords];
  const negs = suggestions.negatives;
  const timing = [...suggestions.apply.google.timing, ...suggestions.suggest.google.timing];
  const landings = [...suggestions.apply.google.landings, ...suggestions.suggest.google.landings];

  if (!themes.length && !kws.length && !negs.length && !timing.length && !landings.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-400">
        {t("overview.playbook.google.none")}{" "}
        <a href="/so-kinh-nghiem" target="_blank" rel="noreferrer" className="text-red-700 underline">{t("overview.playbook.google.viewPlaybook")}</a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-amber-900">{t("overview.playbook.google.heading")}</h4>
        <a href="/so-kinh-nghiem" target="_blank" rel="noreferrer" className="text-[10px] text-amber-700 underline">{t("overview.playbook.google.viewShort")}</a>
      </div>
      {!resultId && (
        <p className="text-[10px] text-slate-400">{t("overview.playbook.google.needResult")}</p>
      )}

      {(themes.length > 0 || kws.length > 0) && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 mb-1">{t("overview.playbook.google.winning")}</p>
          <div className="flex flex-wrap gap-1.5">
            {themes.map((th) => {
              const already = hasKeyword(th.text);
              return (
                <button key={`${th.entryId}|${th.text}`} type="button" disabled={!resultId || already}
                  onClick={() => addTheme(th.entryId, th.text)}
                  title={t("overview.playbook.google.themeTitle", { why: th.why, theme: th.theme })}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                    already ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-slate-200 text-slate-600 hover:border-amber-300")}>
                  {already && "✓ "}{th.text} <ConfidenceChip c={th.confidence} />
                </button>
              );
            })}
            {kws.map((k) => {
              const already = hasKeyword(k.text);
              return (
                <button key={`${k.entryId}|${k.text}`} type="button" disabled={!resultId || already}
                  onClick={() => addKw(k.entryId, k.text, k.matchType)}
                  title={k.why}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                    already ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-slate-200 text-slate-600 hover:border-amber-300")}>
                  {already && "✓ "}{k.text} <span className="text-slate-400">[{k.matchType}]</span> <ConfidenceChip c={k.confidence} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {negs.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-red-700 mb-1">{t("overview.playbook.google.negHeading")}</p>
          <div className="flex flex-wrap gap-1.5">
            {negs.map((n) => {
              const status = suggestions.avoid.find((a) => a.entryId === n.entryId)?.status;
              const confidence = suggestions.avoid.find((a) => a.entryId === n.entryId)?.confidence ?? "medium";
              const added = hasNegative(n.entryId, n.text);
              return (
                <span key={`${n.entryId}|${n.text}`} title={n.why}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                    added ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-slate-200 text-slate-500")}>
                  {n.text} <ConfidenceChip c={confidence} />
                  {added ? (
                    <button type="button" onClick={() => undoNeg(n.entryId, n.text)} className="text-slate-400 hover:text-red-700"><Undo2 className="h-3 w-3" /></button>
                  ) : (
                    resultId && (status === "auto" || status === "approved" || status === "suggested") && (
                      <button type="button" onClick={() => addNeg(n.entryId, n.text)} className="text-amber-700 font-semibold hover:text-amber-800">{t("overview.playbook.google.add")}</button>
                    )
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {landings.length > 0 && landingUrl !== landings[0].url && (
        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 flex items-center justify-between gap-2">
          <p className="text-[10px] text-slate-600">{t("overview.playbook.google.landing")} <b>{landings[0].url}</b></p>
          <button type="button" onClick={() => onUseLandingUrl(landings[0].url)}
            className="shrink-0 rounded bg-amber-500 text-amber-950 px-2 py-0.5 text-[10px] font-semibold hover:bg-amber-600">
            {t("overview.playbook.google.useLink")}
          </button>
        </div>
      )}

      {timing.length > 0 && (
        <p className="text-[10px] text-slate-500">
          {t("overview.playbook.google.timing", { v: timing.map((x) => x.value).join(", ") })}
        </p>
      )}

      {(suggestions.hiddenNonIncremental > 0 || suggestions.hiddenLegacyMerged > 0) && (
        <p className="text-[9px] text-slate-400">
          {suggestions.hiddenNonIncremental > 0 && t("overview.playbook.google.hiddenBrand", { n: suggestions.hiddenNonIncremental })}
          {suggestions.hiddenLegacyMerged > 0 && t("overview.playbook.google.hiddenLegacy", { n: suggestions.hiddenLegacyMerged })}
        </p>
      )}
    </div>
  );
}
