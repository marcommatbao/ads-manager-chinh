"use client";

// ============================================================
// PMax "🧪 Thí nghiệm" — C3: báo CHẤT LƯỢNG LEAD (đạt chuẩn / chốt đơn) về
// Google qua chuyển đổi offline, để quảng cáo học đuổi lead thật thay vì đuổi
// theo "để lại thông tin" — không phụ thuộc CRM cụ thể nào.
// ------------------------------------------------------------
// Đọc/ghi qua lib/leads/quality.ts — module SERVER (kéo google-ads SDK) nên ở
// đây CHỈ `import type`. Hành động chuyển đổi tool tạo là PHỤ (không ảnh
// hưởng đặt giá) cho tới khi người dùng tự đưa vào mục tiêu trong Google Ads.
// Khoá webhook chỉ hiện ĐÚNG MỘT LẦN lúc tạo — giữ trong state React (KHÔNG
// localStorage), mất khi rời trang/tải lại.
// ============================================================

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { getJson, postJson, ApiError } from "@/components/case/api";
import { datetimeVN } from "@/components/case/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { CopyButton } from "./CopyButton";
import type { Stage, LeadQualityStats } from "@/lib/leads/quality";

type Company = string;

interface ActionStatus { stage: Exclude<Stage, "junk">; name: string; resourceName: string | null; status: string | null; primary: boolean | null }
interface CsvOutcome { accepted: number; duplicates: number; errors: string[] }
interface UploadOutcome { sent: number; uploaded: number; failed: number; errors: string[]; skippedNoAction: number }
interface LeadQualityGetResponse {
  actions: ActionStatus[];
  stats: LeadQualityStats;
  stageLabels: Record<Stage, string>;
  defaultValue: Partial<Record<Exclude<Stage, "junk">, number>>;
  webhook: { configured: boolean; createdAt: string | null; path: string };
  canEdit: boolean;
  confirmText: string;
}

const ACTION_STATUS_LABEL: Record<string, MessageKey> = { ENABLED: "google.pmaxLead.actionStatus.enabled", PAUSED: "google.pmaxLead.actionStatus.paused", REMOVED: "google.pmaxLead.actionStatus.removed" };
const EVENT_STATUS_LABEL: Record<string, MessageKey> = { pending: "google.pmaxLead.eventStatus.pending", uploaded: "google.pmaxLead.eventStatus.uploaded", failed: "google.pmaxLead.eventStatus.failed", skipped: "google.pmaxLead.eventStatus.skipped" };

export function LeadQualityPanel({ company }: { company: Company }) {
  const intl = useIntlLocale();
  const t = useT();
  const qId = useId(), wId = useId(), caConfirmId = useId();

  const [data, setData] = useState<LeadQualityGetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = data?.canEdit ?? false;
  const confirmText = data?.confirmText ?? "XAC NHAN";

  const load = useCallback(async (force?: boolean) => {
    if (force) setReloading(true); else setLoading(true);
    setError(null);
    try {
      const json = await getJson(`/api/leads/quality?company=${company}`);
      setData(json as LeadQualityGetResponse);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("google.pmaxLead.connError"));
    } finally {
      setLoading(false); setReloading(false);
    }
  }, [company]);

  useEffect(() => { load(); }, [load]);

  // Domain chỉ đọc được ở CLIENT — nếu tính ngay lúc render thì HTML server
  // render ("") khác HTML client hydrate (đã có window), gây cảnh báo lệch
  // hydrate. Tính trong effect, render lại sau khi mount xong.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  // ── Tạo hành động chuyển đổi ──
  const [qualifiedValue, setQualifiedValue] = useState("");
  const [wonValue, setWonValue] = useState("");
  const [caValidating, setCaValidating] = useState(false);
  const [caValidateErr, setCaValidateErr] = useState<string | null>(null);
  const [caValidateResult, setCaValidateResult] = useState<{ wouldCreate: string[]; existing: string[] } | null>(null);
  const [caValidatedSig, setCaValidatedSig] = useState<string | null>(null);
  const [caOpen, setCaOpen] = useState(false);
  const [caConfirmInput, setCaConfirmInput] = useState("");
  const [caApplying, setCaApplying] = useState(false);
  const [caApplyErr, setCaApplyErr] = useState<string | null>(null);
  const caSig = `${qualifiedValue}|${wonValue}`;
  const caValues = () => ({ qualified: qualifiedValue.trim() ? Number(qualifiedValue) : undefined, won: wonValue.trim() ? Number(wonValue) : undefined });

  async function caValidate() {
    setCaValidating(true); setCaValidateErr(null); setCaValidateResult(null);
    try {
      const json = await postJson("/api/leads/quality", { company, op: "create_actions", validateOnly: true, values: caValues() });
      setCaValidateResult({ wouldCreate: json.wouldCreate as string[], existing: json.existing as string[] });
      setCaValidatedSig(caSig);
    } catch (e) {
      setCaValidateErr(e instanceof ApiError ? e.message : t("google.pmaxLead.validateError"));
      setCaValidatedSig(null);
    } finally { setCaValidating(false); }
  }

  async function caApply() {
    setCaApplying(true); setCaApplyErr(null);
    try {
      await postJson("/api/leads/quality", { company, op: "create_actions", validateOnly: false, confirmText: caConfirmInput, values: caValues() });
      setCaOpen(false); setCaConfirmInput(""); setCaValidatedSig(null); setCaValidateResult(null);
      load(true);
    } catch (e) {
      setCaApplyErr(e instanceof ApiError ? e.message : t("google.pmaxLead.createError"));
    } finally { setCaApplying(false); }
  }

  // ── Khoá webhook ──
  const [secret, setSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateErr, setRotateErr] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);

  function askRotate() {
    setRotateErr(null);
    if (data?.webhook.configured) setRotateOpen(true); else void rotateSecret();
  }
  async function rotateSecret() {
    setRotating(true); setRotateErr(null);
    try {
      const json = await postJson("/api/leads/quality", { company, op: "rotate_secret" });
      setSecret(json.secret as string);
      setRotateOpen(false);
      load(true);
    } catch (e) {
      setRotateErr(e instanceof ApiError ? e.message : t("google.pmaxLead.rotateError"));
    } finally { setRotating(false); }
  }
  const curlSample = `curl -X POST '${origin}/api/leads/quality/webhook?company=${company}' \\\n  -H 'Authorization: Bearer ${secret ?? t("google.pmaxLead.secretPlaceholder")}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"events":[{"leadId":"L123","stage":"qualified","time":"2026-09-28T10:00:00+07:00","gclid":"...","email":"...","phone":"...","value":5000000}]}'`;

  // ── CSV lead ──
  const [csvText, setCsvText] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<{ ingest: CsvOutcome; upload: UploadOutcome } | null>(null);

  async function submitCsv() {
    if (!csvText.trim()) return;
    setCsvBusy(true); setCsvErr(null); setCsvResult(null);
    try {
      const json = await postJson("/api/leads/quality", { company, op: "csv", csv: csvText });
      setCsvResult({ ingest: json.ingest as CsvOutcome, upload: json.upload as UploadOutcome });
      setCsvText("");
      load(true);
    } catch (e) {
      setCsvErr(e instanceof ApiError ? e.message : t("google.pmaxLead.csvError"));
    } finally { setCsvBusy(false); }
  }
  function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then(setCsvText);
    e.target.value = "";
  }

  // ── Gửi lại ngay ──
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadOutcome | null>(null);

  async function doUpload() {
    setUploading(true); setUploadErr(null); setUploadResult(null);
    try {
      const json = await postJson("/api/leads/quality", { company, op: "upload", validateOnly: false });
      setUploadResult(json.upload as UploadOutcome);
      load(true);
    } catch (e) {
      setUploadErr(e instanceof ApiError ? e.message : t("google.pmaxLead.uploadError"));
    } finally { setUploading(false); }
  }

  return (
    <section id="lead-quality" className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-slate-900">{t("google.pmaxLead.title")}</h3>
        <p className="mt-1 text-xs text-slate-500">
          {t("google.pmaxLead.introA")} <strong>{t("google.pmaxLead.introB")}</strong> / <strong>{t("google.pmaxLead.introC")}</strong> {t("google.pmaxLead.introD")}
        </p>
        <Link href="/guide/ket-noi#lead-quality" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
          {t("google.pmaxLead.guide")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>{error}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : !data ? null : (
        <>
          {!canEdit && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("google.pmaxLead.readOnly")}</p>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={() => load(true)} disabled={loading || reloading}>
              {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxLead.reload")}
            </Button>
          </div>

          {/* Hành động chuyển đổi */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs font-semibold text-slate-600">{t("google.pmaxLead.actionsTitle")}</p>
            <div className="space-y-1">
              {data.actions.map((a) => (
                <div key={a.stage} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/40 px-2.5 py-1.5 text-xs">
                  <span className="text-slate-700">{a.name}</span>
                  <span className="flex items-center gap-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", a.resourceName ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500")}>
                      {a.status ? (ACTION_STATUS_LABEL[a.status] ? t(ACTION_STATUS_LABEL[a.status]) : a.status) : t("google.pmaxLead.notCreated")}
                    </span>
                    {a.resourceName && <span className="text-[10px] text-slate-400">{a.primary ? t("google.pmaxLead.primary") : t("google.pmaxLead.secondary")}</span>}
                  </span>
                </div>
              ))}
            </div>
            {canEdit && (
              <>
                <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-2">
                  <div className="space-y-1">
                    <label htmlFor={qId} className="text-[11px] text-slate-500">{t("google.pmaxLead.defaultValueQualified")}</label>
                    <Input id={qId} inputMode="numeric" value={qualifiedValue} onChange={(e) => setQualifiedValue(e.target.value.replace(/\D/g, ""))} placeholder={String(data.defaultValue.qualified ?? 0)} className="h-9 w-36" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={wId} className="text-[11px] text-slate-500">{t("google.pmaxLead.defaultValueWon")}</label>
                    <Input id={wId} inputMode="numeric" value={wonValue} onChange={(e) => setWonValue(e.target.value.replace(/\D/g, ""))} placeholder={String(data.defaultValue.won ?? 0)} className="h-9 w-36" />
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={caValidate} disabled={caValidating}>
                    {caValidating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxLead.validate")}
                  </Button>
                  <Button type="button" size="sm" className="h-9" onClick={() => { setCaConfirmInput(""); setCaApplyErr(null); setCaOpen(true); }} disabled={caSig !== caValidatedSig}>
                    {t("google.pmaxLead.createActions")}
                  </Button>
                </div>
                {caValidateErr && <p className="text-xs text-red-600">{caValidateErr}</p>}
                {caValidateResult && (
                  <div className="space-y-0.5 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
                    {caValidateResult.wouldCreate.length > 0 ? <p>{t("google.pmaxLead.wouldCreate", { names: caValidateResult.wouldCreate.join(", ") })}</p> : <p>{t("google.pmaxLead.bothExist")}</p>}
                    {caValidateResult.existing.length > 0 && <p>{t("google.pmaxLead.existing", { names: caValidateResult.existing.join(", ") })}</p>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Webhook */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs font-semibold text-slate-600">{t("google.pmaxLead.webhookTitle")}</p>
            <p className="text-[11px] text-slate-500">
              {data.webhook.configured ? data.webhook.createdAt ? t("google.pmaxLead.configuredAt", { time: datetimeVN(data.webhook.createdAt, intl) }) : t("google.pmaxLead.configured") : t("google.pmaxLead.notConfigured")}
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1.5 text-[11px]">{origin}{data.webhook.path}</code>
              <CopyButton text={`${origin}${data.webhook.path}`} />
            </div>
            {canEdit && (
              <Button type="button" variant="outline" size="sm" className="h-9 bg-white" onClick={askRotate} disabled={rotating}>
                {rotating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {data.webhook.configured ? t("google.pmaxLead.newKey") : t("google.pmaxLead.createKey")}
              </Button>
            )}
            {rotateErr && <p className="text-xs text-red-600">{rotateErr}</p>}
            {secret && (
              <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                <p className="text-xs font-bold text-emerald-800">{t("google.pmaxLead.keyOnce")}</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1.5 text-xs">{secret}</code>
                  <CopyButton text={secret} />
                </div>
                <p className="text-[11px] font-semibold text-emerald-700">{t("google.pmaxLead.sample")}</p>
                <div className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2.5 text-[10px] text-slate-100">{curlSample}</pre>
                  <CopyButton text={curlSample} />
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={() => setSecret(null)}>{t("google.pmaxLead.hideKey")}</Button>
              </div>
            )}
          </div>

          {/* CSV */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3.5">
            <p className="text-xs font-semibold text-slate-600">{t("google.pmaxLead.csvTitleA")} <code>lead_id,stage,time</code>{t("google.pmaxLead.csvTitleB")} <code>gclid,email,phone,value</code>)</p>
            {canEdit && (
              <>
                <input type="file" accept=".csv,text/csv" onChange={onCsvFile} className="block text-[11px] text-slate-500" />
                <Textarea
                  value={csvText} onChange={(e) => setCsvText(e.target.value)}
                  placeholder={"lead_id,stage,time,gclid,email,phone,value\nL123,qualified,2026-09-28T10:00:00+07:00,,a@b.com,,5000000"}
                  className="h-24 text-xs"
                />
                <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={submitCsv} disabled={csvBusy || !csvText.trim()}>
                  {csvBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxLead.csvUploadSend")}
                </Button>
                {csvErr && <p className="text-xs text-red-600">{csvErr}</p>}
                {csvResult && (
                  <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                    <p>{t("google.pmaxLead.csvIngest", { accepted: csvResult.ingest.accepted, dup: csvResult.ingest.duplicates })}{csvResult.ingest.errors.length ? t("google.pmaxLead.csvIngestErr", { n: csvResult.ingest.errors.length }) : ""}.</p>
                    <p>{t("google.pmaxLead.sentToGoogle", { ok: csvResult.upload.uploaded, total: csvResult.upload.sent })}{csvResult.upload.skippedNoAction ? t("google.pmaxLead.skippedNoAction", { n: csvResult.upload.skippedNoAction }) : ""}.</p>
                    {csvResult.ingest.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{csvResult.ingest.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>}
                    {csvResult.upload.errors.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-red-600">{csvResult.upload.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Thống kê */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600">{t("google.pmaxLead.stats")}</p>
              {canEdit && (
                <Button type="button" variant="outline" size="sm" className="h-8 bg-white" onClick={doUpload} disabled={uploading}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />} {t("google.pmaxLead.resend")}
                </Button>
              )}
            </div>
            {uploadErr && <p className="text-xs text-red-600">{uploadErr}</p>}
            {uploadResult && (
              <p className="text-[11px] text-slate-500">{t("google.pmaxLead.sent", { ok: uploadResult.uploaded, total: uploadResult.sent })}{uploadResult.skippedNoAction ? t("google.pmaxLead.skippedNoAction", { n: uploadResult.skippedNoAction }) : ""}.</p>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
              {(["qualified", "won", "junk"] as const).map((s) => (
                <div key={s} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-lg font-bold text-slate-800">{data.stats.byStage[s]}</p>
                  <p className="text-[10px] text-slate-400">{data.stageLabels[s]}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {(["pending", "uploaded", "failed", "skipped"] as const).map((s) => (
                <div key={s} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-base font-bold text-slate-800">{data.stats.byStatus[s]}</p>
                  <p className="text-[10px] text-slate-400">{t(EVENT_STATUS_LABEL[s])}</p>
                </div>
              ))}
            </div>

            {data.stats.last.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-slate-500">
                      <th className="px-2.5 py-1.5 font-medium">{t("google.pmaxLead.col.lead")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("google.pmaxLead.col.stage")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("google.pmaxLead.col.status")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("google.pmaxLead.col.time")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("google.pmaxLead.col.via")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("google.pmaxLead.col.error")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stats.last.map((e) => (
                      <tr key={e.key} className="border-b border-slate-50 last:border-0">
                        <td className="px-2.5 py-1.5 text-slate-700">{e.key}</td>
                        <td className="px-2.5 py-1.5 text-slate-600">{data.stageLabels[e.stage]}</td>
                        <td className="px-2.5 py-1.5 text-slate-600">{t(EVENT_STATUS_LABEL[e.status])}</td>
                        <td className="px-2.5 py-1.5 text-slate-400">{datetimeVN(e.time, intl)}</td>
                        <td className="px-2.5 py-1.5 text-slate-400">{e.via}</td>
                        <td className="px-2.5 py-1.5 text-red-600">{e.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxLead.rotateTitle")}</DialogTitle>
            <DialogDescription>{t("google.pmaxLead.rotateDesc")}</DialogDescription>
          </DialogHeader>
          {rotateErr && <p className="text-xs text-red-600">{rotateErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxLead.cancel")}</DialogClose>
            <Button className="h-10" variant="destructive" onClick={rotateSecret} disabled={rotating}>
              {rotating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxLead.createNewKey")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={caOpen} onOpenChange={(o) => { setCaOpen(o); if (!o) setCaConfirmInput(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("google.pmaxLead.caTitle", { company })}</DialogTitle>
          </DialogHeader>
          {caValidateResult && caValidateResult.wouldCreate.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{caValidateResult.wouldCreate.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
          <div className="space-y-1.5">
            <label htmlFor={caConfirmId} className="text-xs font-medium text-slate-500">
              {t("google.pmaxLead.typeA")} <code className="rounded bg-slate-100 px-1 py-0.5">{confirmText}</code> {t("google.pmaxLead.typeB")}
            </label>
            <Input id={caConfirmId} value={caConfirmInput} onChange={(e) => setCaConfirmInput(e.target.value)} placeholder={confirmText} autoComplete="off" className="h-10" />
          </div>
          {caApplyErr && <p className="text-xs text-red-600">{caApplyErr}</p>}
          <DialogFooter>
            <DialogClose render={<Button className="h-10" variant="outline" />}>{t("google.pmaxLead.cancel")}</DialogClose>
            <Button className="h-10" onClick={caApply} disabled={caApplying || caConfirmInput.trim() !== confirmText}>
              {caApplying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} {t("google.pmaxLead.createReal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
