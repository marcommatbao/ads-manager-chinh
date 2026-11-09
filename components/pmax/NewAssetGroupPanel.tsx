"use client";

// ============================================================
// PMax "🎨 Asset" — E1: Asset group mới theo chủ đề (Gemini viết chữ, mượn
// ảnh/video/logo từ asset group nguồn cùng chiến dịch, tạo ở trạng thái
// TẠM DỪNG — người dùng tự bật).
// ------------------------------------------------------------
// `groups` (để chọn chiến dịch + asset group nguồn) và `newAssetGroups` do
// PmaxAssetsView tải MỘT LẦN qua GET /api/google/pmax/themes (route chung
// với ThemesPanel) và truyền xuống — panel này tự POST khi soạn/kiểm/tạo/đổi
// trạng thái rồi gọi onChanged() để cha tải lại. Đọc/ghi qua lib/pmax/
// themes.ts — module SERVER (kéo google-ads SDK) nên ở đây CHỈ `import type`.
// ============================================================

import { useEffect, useId, useMemo, useState } from "react";
import {
  CheckCircle2, Loader2, Pause, Play, Plus, Sparkles, Trash2, X, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { postJson, ApiError } from "@/components/case/api";
import { datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import type { AssetGroupDraft, NewAssetGroupRecord, ThemeGroup } from "@/lib/pmax/themes";

type Company = string;

/** Trùng lib/pmax/assets.ts TEXT_LIMIT — chỉ để hiện đếm ký tự, không phải luật (server vẫn tự kiểm lại). */
const LIMITS: Record<"HEADLINE" | "LONG_HEADLINE" | "DESCRIPTION", number> = { HEADLINE: 30, LONG_HEADLINE: 90, DESCRIPTION: 90 };

// ── Danh sách chữ sửa được (thêm/xoá dòng, đếm ký tự) ──

function EditableTextList({ label, items, limit, onChange, canEdit }: {
  label: string; items: string[]; limit: number; onChange: (next: string[]) => void; canEdit: boolean;
}) {
  const t = useT();
  const [draftLine, setDraftLine] = useState("");
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-slate-600">{label} ({items.length})</p>
      <div className="space-y-1">
        {items.map((tx, i) => {
          const len = [...tx].length;
          return (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={tx}
                onChange={(e) => onChange(items.map((x, xi) => (xi === i ? e.target.value : x)))}
                disabled={!canEdit}
                className="h-8 flex-1"
              />
              <span className={cn("w-12 shrink-0 text-right text-[10px]", len > limit ? "font-semibold text-red-600" : "text-slate-400")}>{len}/{limit}</span>
              {canEdit && (
                <button type="button" onClick={() => onChange(items.filter((_, xi) => xi !== i))} className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1.5">
          <Input value={draftLine} onChange={(e) => setDraftLine(e.target.value)} placeholder={t("google.pmaxNewGroup.addLine")} className="h-8 flex-1"
            onKeyDown={(e) => { if (e.key === "Enter" && draftLine.trim()) { onChange([...items, draftLine.trim()]); setDraftLine(""); } }} />
          <Button type="button" variant="outline" size="sm" className="h-8 bg-white" disabled={!draftLine.trim()} onClick={() => { onChange([...items, draftLine.trim()]); setDraftLine(""); }}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Search theme dạng chip sửa được ──

function EditableChips({ items, onChange, canEdit }: { items: string[]; onChange: (next: string[]) => void; canEdit: boolean }) {
  const t = useT();
  const [draftChip, setDraftChip] = useState("");
  function add() {
    const v = draftChip.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]); setDraftChip("");
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-slate-600">{t("google.pmaxNewGroup.searchTheme")} ({items.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((tx) => (
          <span key={tx} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700">
            {tx}
            {canEdit && (
              <button type="button" onClick={() => onChange(items.filter((x) => x !== tx))} className="text-slate-400 hover:text-red-600">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1.5">
          <Input value={draftChip} onChange={(e) => setDraftChip(e.target.value)} placeholder={t("google.pmaxNewGroup.addSearchTheme")} className="h-8 flex-1"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" size="sm" className="h-8 bg-white" disabled={!draftChip.trim()} onClick={add}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Đổi trạng thái asset group đã tạo (Bật / Tạm dừng / Gỡ) ──

const ACTION_LABEL: Record<"enable" | "pause" | "remove", MessageKey> = { enable: "google.pmaxNewGroup.actEnable", pause: "google.pmaxNewGroup.actPause", remove: "google.pmaxNewGroup.actRemove" };

function NewAssetGroupRow({ rec, company, canEdit, confirmText, onChanged }: {
  rec: NewAssetGroupRecord; company: Company; canEdit: boolean; confirmText: string; onChanged: () => void;
}) {
  const intl = useIntlLocale();
  const t = useT();
  const confirmId = useId();
  const [action, setAction] = useState<"enable" | "pause" | "remove" | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const created = rec.status === "done" && !!rec.resourceName;
  const removed = !!rec.removedAt;
  const enabled = !!rec.enabledAt && !removed;
  const status = !created ? t("google.pmaxNewGroup.stFailed") : removed ? t("google.pmaxNewGroup.stRemoved") : enabled ? t("google.pmaxNewGroup.stEnabled") : t("google.pmaxNewGroup.stPaused");
  const statusCls = !created ? "border-red-200 bg-red-50 text-red-700" : removed ? "border-slate-200 bg-slate-100 text-slate-500" : enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700";

  async function run() {
    if (!action) return;
    setBusy(true); setErr(null);
    try {
      await postJson("/api/google/pmax/themes", { company, op: "group_state", id: rec.id, action, confirmText: confirmInput });
      setAction(null); setConfirmInput("");
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("google.pmaxNewGroup.stateErr"));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="truncate font-semibold text-slate-800" title={rec.name}>{rec.name}</p>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", statusCls)}>{status}</span>
      </div>
      <p className="text-[10px] text-slate-400">{datetimeVN(rec.at, intl)} · {rec.by}</p>
      {rec.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-red-700">{rec.errors.filter((e) => !e.startsWith("[")).map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {created && !removed && canEdit && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {!enabled && (
            <Button type="button" variant="outline" size="sm" className="h-7 bg-white" onClick={() => { setAction("enable"); setConfirmInput(""); setErr(null); }}>
              <Play className="h-3 w-3" aria-hidden="true" /> {t("google.pmaxNewGroup.actEnable")}
            </Button>
          )}
          {enabled && (
            <Button type="button" variant="outline" size="sm" className="h-7 bg-white" onClick={() => { setAction("pause"); setConfirmInput(""); setErr(null); }}>
              <Pause className="h-3 w-3" aria-hidden="true" /> {t("google.pmaxNewGroup.actPause")}
            </Button>
          )}
          <Button type="button" variant="destructive" size="sm" className="h-7" onClick={() => { setAction("remove"); setConfirmInput(""); setErr(null); }}>
            <Trash2 className="h-3 w-3" aria-hidden="true" /> {t("google.pmaxNewGroup.actRemove")}
          </Button>
        </div>
      )}
      <Dialog open={!!action} onOpenChange={(o) => { if (!o) { setAction(null); setConfirmInput(""); setErr(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? t("google.pmaxNewGroup.rowDialogTitle", { action: t(ACTION_LABEL[action]), company }) : ""}</DialogTitle>
            <DialogDescription>{rec.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxNewGroup.typePre")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxNewGroup.typePost")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxNewGroup.cancel")}</DialogClose>
            <Button className="h-10" variant={action === "remove" ? "destructive" : "default"} onClick={run} disabled={busy || confirmInput.trim() !== confirmText}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxNewGroup.writeReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Root ──

export function NewAssetGroupPanel({ company, groups, newAssetGroups, canEdit, confirmText, onChanged }: {
  company: Company; groups: ThemeGroup[]; newAssetGroups: NewAssetGroupRecord[]; canEdit: boolean; confirmText: string; onChanged: () => void;
}) {
  const t = useT();
  const campaignIdField = useId(), sourceField = useId(), themeField = useId(), urlField = useId(), confirmId = useId();

  const campaigns = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.campaignId, g.campaignName);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [groups]);

  const [campaignId, setCampaignId] = useState("");
  const [sourceAssetGroupId, setSourceAssetGroupId] = useState("");
  const [theme, setTheme] = useState("");
  const [finalUrl, setFinalUrl] = useState("");

  const sources = useMemo(() => groups.filter((g) => g.campaignId === campaignId), [groups, campaignId]);
  useEffect(() => {
    if (!sources.some((s) => s.assetGroupId === sourceAssetGroupId)) setSourceAssetGroupId(sources[0]?.assetGroupId ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);
  const sourceGroup = sources.find((s) => s.assetGroupId === sourceAssetGroupId);

  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssetGroupDraft | null>(null);

  async function doDraft() {
    if (!campaignId || !sourceAssetGroupId || theme.trim().length < 3 || !finalUrl.trim()) return;
    setDrafting(true); setDraftErr(null);
    try {
      const json = await postJson("/api/google/pmax/themes", { company, op: "draft_group", campaignId, sourceAssetGroupId, theme: theme.trim(), finalUrl: finalUrl.trim() });
      const d = json.draft as AssetGroupDraft;
      setDraft(d);
      setValidatedSig(null); setValidateRec(null); setWriteRec(null);
    } catch (e) {
      setDraftErr(e instanceof ApiError ? e.message : t("google.pmaxNewGroup.draftErr"));
    } finally { setDrafting(false); }
  }

  const sig = draft ? JSON.stringify({ h: draft.headlines, l: draft.longHeadlines, d: draft.descriptions, s: draft.searchThemes, u: draft.finalUrl, n: draft.name, m: draft.media.map((m) => m.asset) }) : "";

  const [validating, setValidating] = useState(false);
  const [validateRec, setValidateRec] = useState<NewAssetGroupRecord | null>(null);
  const [validateErr, setValidateErr] = useState<string | null>(null);
  const [validatedSig, setValidatedSig] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [writeRec, setWriteRec] = useState<NewAssetGroupRecord | null>(null);

  const canApply = !!draft && sig === validatedSig;

  function draftPayload() {
    if (!draft) return null;
    return { campaignId, sourceAssetGroupId, name: draft.name, finalUrl: draft.finalUrl, theme: draft.theme, headlines: draft.headlines, longHeadlines: draft.longHeadlines, descriptions: draft.descriptions, searchThemes: draft.searchThemes, media: draft.media };
  }

  async function doValidate() {
    const payload = draftPayload();
    if (!payload) return;
    setValidating(true); setValidateErr(null); setValidateRec(null); setWriteRec(null);
    try {
      const json = await postJson("/api/google/pmax/themes", { company, op: "create_group", draft: payload, validateOnly: true });
      const rec = json.record as NewAssetGroupRecord;
      setValidateRec(rec);
      setValidatedSig(rec.status === "done" ? sig : null);
    } catch (e) {
      setValidateErr(e instanceof ApiError ? e.message : t("google.pmaxNewGroup.validateErr"));
      setValidatedSig(null);
    } finally { setValidating(false); }
  }

  async function doCreate() {
    const payload = draftPayload();
    if (!payload) return;
    setCreating(true); setCreateErr(null);
    try {
      const json = await postJson("/api/google/pmax/themes", { company, op: "create_group", draft: payload, validateOnly: false, confirmText: confirmInput });
      const rec = json.record as NewAssetGroupRecord;
      setWriteRec(rec);
      if (rec.status === "done") {
        setCreateOpen(false); setConfirmInput(""); setValidatedSig(null); setValidateRec(null);
        setDraft(null); setTheme(""); setFinalUrl("");
        onChanged();
      } else {
        setCreateErr(rec.errors.join(" · ") || t("google.pmaxNewGroup.googleRejected"));
      }
    } catch (e) {
      setCreateErr(e instanceof ApiError ? e.message : t("google.pmaxNewGroup.createErr"));
    } finally { setCreating(false); }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-900">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {t("google.pmaxNewGroup.title")}
        </h3>
        <p className="mt-1 text-xs text-slate-500">{t("google.pmaxNewGroup.subtitle")}</p>
      </div>

      {!canEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.pmaxNewGroup.needEdit")}</p>
      )}

      {canEdit && (
        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={campaignIdField} className="text-[11px] font-medium text-slate-500">{t("google.pmaxNewGroup.campaign")}</label>
              <select id={campaignIdField} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs">
                <option value="">{t("google.pmaxNewGroup.pickCampaign")}</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={sourceField} className="text-[11px] font-medium text-slate-500">{t("google.pmaxNewGroup.sourceGroup")}</label>
              <select id={sourceField} value={sourceAssetGroupId} onChange={(e) => setSourceAssetGroupId(e.target.value)} disabled={!campaignId} className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs disabled:opacity-50">
                <option value="">{t("google.pmaxNewGroup.pickGroup")}</option>
                {sources.map((s) => <option key={s.assetGroupId} value={s.assetGroupId}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={themeField} className="text-[11px] font-medium text-slate-500">{t("google.pmaxNewGroup.theme")}</label>
              <Input id={themeField} value={theme} onChange={(e) => setTheme(e.target.value)} placeholder={t("google.pmaxNewGroup.themePh")} className="h-8" />
            </div>
            <div className="space-y-1">
              <label htmlFor={urlField} className="text-[11px] font-medium text-slate-500">{t("google.pmaxNewGroup.finalUrl")}</label>
              <Input id={urlField} value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://…" className="h-8" />
              <p className="text-[10px] text-slate-400">{t("google.pmaxNewGroup.sameDomain")}{sourceGroup ? "" : t("google.pmaxNewGroup.pickSourceFirst")}.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doDraft} disabled={drafting || !campaignId || !sourceAssetGroupId || theme.trim().length < 3 || !finalUrl.trim()}>
            {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxNewGroup.draftBtn")}
          </Button>
          {draftErr && <p className="text-xs text-red-600">{draftErr}</p>}
        </div>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3.5">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            {t("google.pmaxNewGroup.pausedNote1")} <strong>{t("google.pmaxNewGroup.pausedNote2")}</strong> {t("google.pmaxNewGroup.pausedNote3")}
          </p>
          <p className="text-xs text-slate-600">{t("google.pmaxNewGroup.name")}: <strong>{draft.name}</strong> · {t("google.pmaxNewGroup.finalUrl")}: {draft.finalUrl}</p>

          <EditableTextList label={t("google.pmaxNewGroup.headlines")} items={draft.headlines} limit={LIMITS.HEADLINE} canEdit={canEdit} onChange={(v) => setDraft((p) => (p ? { ...p, headlines: v } : p))} />
          <EditableTextList label={t("google.pmaxNewGroup.longHeadlines")} items={draft.longHeadlines} limit={LIMITS.LONG_HEADLINE} canEdit={canEdit} onChange={(v) => setDraft((p) => (p ? { ...p, longHeadlines: v } : p))} />
          <EditableTextList label={t("google.pmaxNewGroup.descriptions")} items={draft.descriptions} limit={LIMITS.DESCRIPTION} canEdit={canEdit} onChange={(v) => setDraft((p) => (p ? { ...p, descriptions: v } : p))} />
          <EditableChips items={draft.searchThemes} canEdit={canEdit} onChange={(v) => setDraft((p) => (p ? { ...p, searchThemes: v } : p))} />

          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-slate-600">{t("google.pmaxNewGroup.media")} ({draft.media.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {draft.media.map((m) => (
                <span key={m.asset} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600">{m.label || m.field}</span>
              ))}
            </div>
          </div>

          {draft.rejected.length > 0 && (
            <details className="text-[11px] text-slate-400">
              <summary className="cursor-pointer select-none">{t("google.pmaxNewGroup.rejected", { n: draft.rejected.length })}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{draft.rejected.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </details>
          )}

          {canEdit && (
            <div className="space-y-2 border-t border-indigo-100 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={doValidate} disabled={validating}>
                  {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} {t("google.pmaxNewGroup.validateBtn")}
                </Button>
                <Button type="button" size="sm" className="h-9" onClick={() => { setConfirmInput(""); setCreateErr(null); setCreateOpen(true); }} disabled={!canApply} title={!canApply ? t("google.pmaxNewGroup.validateFirst") : undefined}>
                  {t("google.pmaxNewGroup.createBtn")}
                </Button>
              </div>
              {validateErr && <p className="text-xs text-red-600">{validateErr}</p>}
              {validateRec && (
                <div className={cn("rounded-lg border p-2.5 text-xs", validateRec.status === "done" ? "border-sky-200 bg-sky-50 text-sky-800" : "border-red-200 bg-red-50 text-red-700")}>
                  {validateRec.status === "done" ? (
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t("google.pmaxNewGroup.accepted")}</span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t("google.pmaxNewGroup.rejectedShort")}</span>
                      {validateRec.errors.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{validateRec.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxNewGroup.createTitle", { company })}</DialogTitle>
            <DialogDescription>{t("google.pmaxNewGroup.createDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={confirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxNewGroup.typePre")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxNewGroup.typePost")}
            </label>
            <Input id={confirmId} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {createErr && <p className="text-xs text-red-600">{createErr}</p>}
          {writeRec && writeRec.status !== "done" && writeRec.errors.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-lg border border-red-200 bg-red-50 p-2.5 pl-6 text-xs text-red-700">
              {writeRec.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxNewGroup.cancel")}</DialogClose>
            <Button className="h-10" onClick={doCreate} disabled={creating || confirmInput.trim() !== confirmText}>
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxNewGroup.createReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {newAssetGroups.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-600">{t("google.pmaxNewGroup.created")} ({newAssetGroups.length})</p>
          <div className="space-y-1.5">
            {newAssetGroups.map((rec) => <NewAssetGroupRow key={rec.id} rec={rec} company={company} canEdit={canEdit} confirmText={confirmText} onChanged={onChanged} />)}
          </div>
        </div>
      )}
    </section>
  );
}
