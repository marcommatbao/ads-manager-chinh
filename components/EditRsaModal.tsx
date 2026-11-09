"use client";

// RSA-EDIT-1 — edit an existing RSA's headlines/descriptions and push the
// update to Google Ads. Opened from Quality Score Toolkit ("Sửa & cập
// nhật" on a POOR/AVERAGE keyword whose weakest component is fixable via
// ad copy). See docs/mini-specs/RSA-EDIT-1.md.
import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, CheckCircle2, XCircle, Undo2, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/Toast";
import { useGuardedWrite } from "@/components/ConfirmWriteDialog";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface RsaContent {
  adId: string;
  adResourceName: string;
  adGroupId: string;
  status: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
}

interface EditRsaModalProps {
  isOpen: boolean;
  onClose: () => void;
  company: string;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  weakest: "AD_RELEVANCE" | "EXPECTED_CTR";
  keyword: string; // từ khoá của dòng Quality Score vừa bấm
  /** Toàn bộ từ khoá của ad group (QS thấp trước). RSA phục vụ CẢ ad group,
   *  viết lại quanh đúng một từ khoá là tối ưu cho một dòng và bỏ rơi phần còn lại. */
  adGroupKeywords?: string[];
}

// One RSA's editable state — an ad group can have several RSAs, each
// edited/saved independently (no bulk save in this pass, see mini-spec
// §9 Remaining Limits).
interface AdEditState {
  ad: RsaContent;
  headlines: string[];
  descriptions: string[];
  suggesting: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  /** Đã áp bản AI viết — dùng để hiện nút Hoàn tác. */
  aiApplied?: boolean;
  /** Kết quả đọc lại từ Google sau khi ghi: khớp / chưa xác minh được. */
  verified?: "match" | "unchecked";
  verifyNote?: string | null;
}

export function EditRsaModal({ isOpen, onClose, company, adGroupId, adGroupName, campaignId, weakest, keyword, adGroupKeywords }: EditRsaModalProps) {
  // Từ khoá dòng đang xem luôn đứng đầu, rồi tới các từ khoá còn lại của nhóm.
  const keywordsForAi = Array.from(new Set([keyword, ...(adGroupKeywords ?? [])])).filter(Boolean).slice(0, 20);
  const t = useT();
  const { toast } = useToast();
  const guard = useGuardedWrite();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ads, setAds] = useState<AdEditState[]>([]);

  const loadAds = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/google/toolkit/rsa?company=${company}&adGroupId=${adGroupId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? t("panels.rsa.loadFail"));
      const list: RsaContent[] = json.data;
      setAds(list.map((ad) => ({
        ad, headlines: [...ad.headlines], descriptions: [...ad.descriptions],
        suggesting: false, saving: false, saved: false, error: null,
      })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("panels.rsa.connError"));
    } finally {
      setLoading(false);
    }
  }, [company, adGroupId, t]);

  useEffect(() => {
    if (isOpen) loadAds();
  }, [isOpen, loadAds]);

  const patchAd = (adId: string, patch: Partial<AdEditState>) => {
    setAds((prev) => prev.map((a) => (a.ad.adId === adId ? { ...a, ...patch } : a)));
  };

  const handleSuggest = async (adId: string) => {
    const state = ads.find((a) => a.ad.adId === adId);
    if (!state) return;
    patchAd(adId, { suggesting: true, error: null });
    try {
      const res = await fetch("/api/google/toolkit/rsa/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headlines: state.headlines, descriptions: state.descriptions, weakest, keywords: keywordsForAi }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? t("panels.rsa.aiFail"));
      patchAd(adId, {
        headlines: json.data.headlines,
        // AI nay viết cả mô tả. Bản gốc vẫn nằm trong `state.ad` nên nút Hoàn tác
        // lấy lại được — không có đường về thì không ai dám bấm thử.
        descriptions: json.data.descriptions ?? state.descriptions,
        suggesting: false,
        aiApplied: true,
      });
    } catch (err) {
      patchAd(adId, { suggesting: false, error: err instanceof Error ? err.message : t("panels.rsa.connError") });
    }
  };

  /** Trả nội dung về đúng bản đã đọc từ Google lúc mở modal. */
  const handleRevert = (adId: string) => {
    const state = ads.find((a) => a.ad.adId === adId);
    if (!state) return;
    patchAd(adId, {
      headlines: [...state.ad.headlines],
      descriptions: [...state.ad.descriptions],
      aiApplied: false,
      error: null,
      saved: false,
    });
  };

  const handleSave = async (adId: string) => {
    const state = ads.find((a) => a.ad.adId === adId);
    if (!state) return;
    patchAd(adId, { saving: true, error: null, saved: false });
    const summary = [
      ...state.headlines.map((h, i) => t("panels.rsa.headlineN", { n: i + 1, text: h })),
      ...state.descriptions.map((d, i) => t("panels.rsa.descN", { n: i + 1, text: d })),
    ];
    try {
      await guard.run(
        [{
          url: `/api/google/toolkit/rsa/${adId}`,
          method: "PATCH",
          payload: {
            company,
            headlines: state.headlines,
            descriptions: state.descriptions,
            previousHeadlines: state.ad.headlines,
            previousDescriptions: state.ad.descriptions,
            adGroupId,
            campaignId,
            // Lưu vết phải ghi đúng ai viết. Trước đây luôn ghi "manual" kể cả khi
            // nội dung là AI viết — về sau không truy được bản nào do AI đề xuất.
            source: state.aiApplied ? "ai_suggested" : "manual",
          },
          label: t("panels.rsa.writeLabel", { id: adId, h: state.headlines.length, d: state.descriptions.length }),
        }],
        { title: t("panels.rsa.confirmTitle", { id: adId }), company, summary },
        {
          onValidateFail: (message) => patchAd(adId, { saving: false, error: message }),
          onSuccess: (results) => {
            const json = results[0].raw;
            const verified = (json.verified as "match" | "unchecked" | undefined) ?? "unchecked";
            patchAd(adId, { saving: false, saved: true, verified, verifyNote: (json.verifyNote as string | undefined) ?? null });
            // Chỉ khẳng định "đã cập nhật" khi server đã ĐỌC LẠI từ Google và thấy khớp.
            // Ghi xong mà chưa đọc lại được thì nói đúng là chưa xác minh — người dùng
            // biết mà tự kiểm trên Google Ads, thay vì tin một dấu tích không có căn cứ.
            toast(verified === "match"
              ? { title: t("panels.rsa.toastOk"), action: guard.undoAction(company, [results[0].writeId]) }
              : { title: t("panels.rsa.toastUnverified"), variant: "error", action: guard.undoAction(company, [results[0].writeId]) });
          },
          onFailure: (results) => {
            patchAd(adId, { saving: false, error: results[0].error ?? t("panels.rsa.updateFail") });
          },
        }
      );
    } finally {
      patchAd(adId, { saving: false });
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("panels.rsa.title", { name: adGroupName })}</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-5">
          <p className="text-xs text-slate-500">
            {t("panels.rsa.issue")} <span className="font-semibold text-amber-700">{weakest === "AD_RELEVANCE" ? t("panels.rsa.issueRelevance") : t("panels.rsa.issueCtr")}</span>
            {" · "}{t("panels.rsa.mainKeyword")} <span className="font-medium">{keyword}</span>
          </p>
          {keywordsForAi.length > 1 && (
            // Hiện đủ danh sách để người dùng tự kiểm AI có bám đúng từ khoá đang
            // chạy hay không — không thì con chữ AI trả về là thứ không đối chiếu được.
            <p className="text-[10px] text-slate-400 -mt-3">
              {t("panels.rsa.aiFollow", { n: keywordsForAi.length })}{" "}
              <span className="text-slate-600">{keywordsForAi.join(" · ")}</span>
            </p>
          )}

          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-400 gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("panels.rsa.loading")}
            </div>
          )}

          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              ❌ {loadError}
              <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={loadAds}>{t("panels.rsa.retry")}</Button>
            </div>
          )}

          {!loading && !loadError && ads.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">{t("panels.rsa.none")}</p>
          )}

          {ads.map((state) => (
            <div key={state.ad.adId} className={cn("rounded-xl border p-4 space-y-3", state.saved ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200")}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">Ad ID: {state.ad.adId} · {state.ad.status}</p>
                <div className="flex items-center gap-3">
                  {state.aiApplied && !state.saved && (
                    <button onClick={() => handleRevert(state.ad.adId)}
                      className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 underline"
                      title={t("panels.rsa.revertTitle")}>
                      <Undo2 className="h-3 w-3" /> {t("panels.rsa.revert")}
                    </button>
                  )}
                  {/* Dấu tích chỉ hiện khi server đã đọc lại từ Google và thấy khớp.
                      Ghi xong mà chưa đọc lại được thì hiện cảnh báo, không hiện tích —
                      một dấu tích không có căn cứ là thứ tệ nhất ở chỗ này. */}
                  {state.saved && state.verified === "match" && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t("panels.rsa.savedVerified")}
                    </span>
                  )}
                  {state.saved && state.verified !== "match" && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"
                      title={state.verifyNote ?? undefined}>
                      <AlertTriangle className="h-3.5 w-3.5" /> {t("panels.rsa.savedUnverified")}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Headlines ({state.headlines.length})</label>
                {state.headlines.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Textarea
                      value={h}
                      onChange={(e) => {
                        const next = [...state.headlines];
                        next[i] = e.target.value;
                        patchAd(state.ad.adId, { headlines: next, saved: false });
                      }}
                      maxLength={30}
                      rows={1}
                      disabled={state.saving}
                      className="text-xs resize-none min-h-0 py-1.5"
                    />
                    <span className={cn("text-[10px] w-8 text-right shrink-0", h.length > 30 ? "text-red-500" : "text-slate-300")}>{h.length}/30</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Descriptions ({state.descriptions.length})</label>
                {state.descriptions.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Textarea
                      value={d}
                      onChange={(e) => {
                        const next = [...state.descriptions];
                        next[i] = e.target.value;
                        patchAd(state.ad.adId, { descriptions: next, saved: false });
                      }}
                      maxLength={90}
                      rows={2}
                      disabled={state.saving}
                      className="text-xs resize-none"
                    />
                    <span className={cn("text-[10px] w-8 text-right shrink-0 mt-1", d.length > 90 ? "text-red-500" : "text-slate-300")}>{d.length}/90</span>
                  </div>
                ))}
              </div>

              {state.error && (
                <p className="flex items-center gap-1 text-xs text-red-600"><XCircle className="h-3.5 w-3.5 shrink-0" /> {state.error}</p>
              )}

              <div className="flex items-center justify-between pt-1">
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                  onClick={() => handleSuggest(state.ad.adId)}
                  disabled={state.suggesting || state.saving}
                >
                  {state.suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {t("panels.rsa.aiRegen")}
                </Button>
                <Button
                  size="sm"
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-amber-950"
                  onClick={() => handleSave(state.ad.adId)}
                  disabled={state.saving || state.suggesting}
                >
                  {state.saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  {t("panels.rsa.save")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("panels.rsa.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {guard.dialog}
    </>
  );
}
