"use client";
// Đợt 21 A6 — Trình thiết lập ban đầu (Super Admin). API: /api/setup/*, /api/connectors/health, /api/settings/users.
import { Suspense, useCallback, useEffect, useState } from "react";
import { ConnectCard } from "@/components/settings/ConnectCard";
import Link from "next/link";
import { Loader2, Plus, Save, Trash2, CheckCircle2, AlertCircle, Eye, EyeOff, Play } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useIntlLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

type KeyId = "google_ads" | "meta" | "gemini";
interface CompanyDefLite {
  id: string; label: string; domain: string; color: string;
  match?: { googleAccountNames?: string[]; campaignContains?: string[] };
  brandTerms?: string[]; competitors?: string[];
}
interface CompaniesCfg { orgName?: string; modules?: string[]; companies: CompanyDefLite[]; fallback: string }
interface KeyInfo { id: KeyId; status: string; configComplete: boolean; lastSuccess: string | null; failureReason: string | null }
interface PerCompany { id: string; label: string; googleCustomerId: boolean; metaPixelId: boolean; metaPageId: boolean; brandProfile: boolean; caseTarget?: boolean }
interface Member { id: string; email: string; name: string; role: string; company_access: string[]; is_active: boolean }
interface SmokeSummary { at: string; ok: number; failed: { company: string; label: string; detail: string }[]; skipped: number }
interface SmokeResult { company: string; id: string; label: string; ok: boolean; skipped?: boolean; ms: number; detail: string }
interface Status {
  enabled: boolean; pending: boolean; connectMode?: "gateway" | "keys";
  completedAt?: string | null; completedBy?: string | null;
  options?: { colors: string[]; modules: { id: string; label: string }[] };
  companies?: { fileExists: boolean; config: CompaniesCfg | null; error: string | null };
  keys?: KeyInfo[]; perCompany?: PerCompany[]; smoke?: SmokeSummary | null; members?: Member[];
  allowlist?: { saved: { domains: string[]; emails: string[] }; effectiveDomains: string[]; envDomains: boolean; envEmails: boolean };
  me?: { email: string };
}
interface Row { id: string; label: string; domain: string; color: string; googleAccountNames: string; campaignContains: string; brandTerms: string; competitors: string; locked: boolean }
interface HealthRec { status: string; failureReason?: string | null }

const STATUS_VI: Record<string, { text: MessageKey; cls: string }> = {
  healthy: { text: "setup.status.healthy", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  warning: { text: "setup.status.warning", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  missing_config: { text: "setup.status.missing_config", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  auth_error: { text: "setup.status.auth_error", cls: "bg-red-50 text-red-700 border-red-200" },
  service_error: { text: "setup.status.service_error", cls: "bg-red-50 text-red-700 border-red-200" },
  disabled: { text: "setup.status.disabled", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};
const KEY_LABEL: Record<KeyId, string> = { google_ads: "Google Ads", meta: "Meta (Facebook)", gemini: "Gemini (AI)" };
const REQUIRED: KeyId[] = ["google_ads", "meta", "gemini"];
// 08/10: bỏ Telegram — chỉ là kênh dự phòng sau Teams, bản cài khách không cần (thẻ Telegram ở Cài đặt cũng ẩn).
const KEY_IDS: KeyId[] = ["google_ads", "meta", "gemini"];
const ROLES: { id: string; label: MessageKey }[] = [
  { id: "admin", label: "setup.role.admin" },
  { id: "viewer", label: "setup.role.viewer" },
  { id: "super_admin", label: "setup.role.super_admin" },
];
const ID_RE = /^[A-Z][A-Z0-9_]{1,15}$/;
const inputCls = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lst = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
const emptyRow = (color: string): Row => ({ id: "", label: "", domain: "", color, googleAccountNames: "", campaignContains: "", brandTerms: "", competitors: "", locked: false });

async function call<T>(url: string, method: "GET" | "POST" | "PUT", body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; errors?: string[]; success?: boolean } }> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; errors?: string[]; success?: boolean };
  return { ok: res.ok, status: res.status, data };
}

function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
function StepBadge({ state }: { state: "done" | "todo" | "warn" }) {
  const t = useT();
  const m = { done: ["setup.badge.done", "bg-emerald-50 text-emerald-700 border-emerald-200"], todo: ["setup.badge.todo", "bg-slate-100 text-slate-600 border-slate-200"], warn: ["setup.badge.warn", "bg-amber-50 text-amber-700 border-amber-200"] }[state] as [MessageKey, string];
  return <Badge cls={m[1]}>{t(m[0])}</Badge>;
}
function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const m = STATUS_VI[status];
  return <Badge cls={m?.cls ?? "bg-slate-100 text-slate-600 border-slate-200"}>{m ? t(m.text) : status}</Badge>;
}
function Step({ n, title, state, desc, children }: { n: number; title: string; state: "done" | "todo" | "warn"; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{n}</span>{title}
          </CardTitle>
          <StepBadge state={state} />
        </div>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
function Msg({ ok, text, list }: { ok: boolean; text?: string; list?: string[] }) {
  if (!text && !(list && list.length)) return null;
  return (
    <div className={`text-sm ${ok ? "text-emerald-700" : "text-red-600"}`}>
      {text && <p className="flex items-start gap-1.5">{ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{text}</span></p>}
      {list && list.length > 0 && <ul className="list-disc space-y-0.5 pl-9">{list.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}
const Tick = ({ ok }: { ok: boolean }) => <span className={ok ? "text-emerald-600" : "text-slate-400"}>{ok ? "✓" : "✗"}</span>;

// Chuỗi từ điển có thẻ <b>/<l1>/<l2>/<l3> → in đậm / liên kết (chỉ chuỗi tĩnh do mình viết trong lib/i18n/messages).
function footnote(s: string): React.ReactNode[] {
  const href: Record<string, string> = { l1: "/settings", l2: "/settings/brand-profile", l3: "/xu-ly/muc-tieu" };
  const out: React.ReactNode[] = [];
  const re = /<(b|l1|l2|l3)>(.*?)<\/\1>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] === "b" ? <b key={m.index}>{m[2]}</b> : <Link key={m.index} href={href[m[1]]} className="underline">{m[2]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export default function SetupPage() {
  const t = useT();
  const intl = useIntlLocale();
  const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString(intl) : "");
  const [st, setSt] = useState<Status | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);

  // Bước 1
  const [orgName, setOrgName] = useState("");
  const [mods, setMods] = useState<string[]>(["marketing"]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fallback, setFallback] = useState("");
  const [busy1, setBusy1] = useState(false);
  const [msg1, setMsg1] = useState<{ ok: boolean; text?: string; list?: string[] } | null>(null);
  // Bước 3
  const [busy3, setBusy3] = useState(false);
  const [health, setHealth] = useState<Record<string, HealthRec> | null>(null);
  const [msg3, setMsg3] = useState<string>("");
  // Bước 4
  const [busy4, setBusy4] = useState(false);
  const [smokeRun, setSmokeRun] = useState<{ at: string; results: SmokeResult[] } | null>(null);
  const [msg4, setMsg4] = useState<string>("");
  // Bước 5
  const [domainsTxt, setDomainsTxt] = useState("");
  const [emailsTxt, setEmailsTxt] = useState("");
  const [busyA, setBusyA] = useState(false);
  const [msgA, setMsgA] = useState<{ ok: boolean; text: string } | null>(null);
  const [uEmail, setUEmail] = useState("");
  const [uName, setUName] = useState("");
  const [uPass, setUPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [uRole, setURole] = useState("admin");
  const [uAccess, setUAccess] = useState<string[]>([]);
  const [busyU, setBusyU] = useState(false);
  const [msgU, setMsgU] = useState<{ ok: boolean; text: string } | null>(null);
  // Bước 6
  const [busy6, setBusy6] = useState(false);
  const [msg6, setMsg6] = useState("");

  const applyStatus = useCallback((s: Status, prefill: boolean) => {
    setSt(s);
    if (!prefill || !s.options) return;
    const cfg = s.companies?.config;
    const firstColor = s.options.colors[0] ?? "blue";
    setOrgName(cfg?.orgName ?? "");
    setMods(Array.from(new Set(["marketing", ...(cfg?.modules ?? [])])));
    const saved = new Set(cfg?.companies.map((c) => c.id) ?? []);
    if (s.companies?.fileExists && cfg && cfg.companies.length) {
      setRows(cfg.companies.map((c) => ({
        id: c.id, label: c.label, domain: c.domain, color: c.color,
        googleAccountNames: (c.match?.googleAccountNames ?? []).join(", "),
        campaignContains: (c.match?.campaignContains ?? []).join(", "),
        brandTerms: (c.brandTerms ?? []).join(", "), competitors: (c.competitors ?? []).join(", "),
        locked: !!s.completedAt && saved.has(c.id),
      })));
      setFallback(cfg.fallback);
    } else {
      setRows([emptyRow(firstColor)]);
      setFallback("");
    }
    setDomainsTxt((s.allowlist?.saved.domains ?? []).join("\n"));
    setEmailsTxt((s.allowlist?.saved.emails ?? []).join("\n"));
  }, []);

  const refresh = useCallback(async (prefill = false) => {
    try {
      const r = await call<Status>("/api/setup/status", "GET");
      if (!r.ok) throw new Error(r.data.error ?? t("setup.loadFailHttp", { status: r.status }));
      applyStatus(r.data, prefill);
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t("setup.loadFail"));
    } finally { setLoading(false); }
  }, [applyStatus, t]);

  useEffect(() => { void refresh(true); }, [refresh]);

  if (loading) return <div className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("setup.loading")}</div>;
  if (loadErr && !st) {
    return (
      <Card><CardContent className="space-y-3 pt-6">
        <Msg ok={false} text={loadErr} />
        <Button type="button" variant="outline" size="sm" onClick={() => { setLoading(true); void refresh(true); }}>{t("setup.retry")}</Button>
      </CardContent></Card>
    );
  }
  if (!st) return null;
  if (!st.enabled) {
    return (
      <Card><CardContent className="space-y-3 pt-6">
        <p className="text-sm text-slate-700">{t("setup.disabled")}</p>
        <Link href="/" className="text-sm font-medium text-blue-600 underline">{t("setup.home")}</Link>
      </CardContent></Card>
    );
  }
  if (!st.options) {
    return <Card><CardContent className="pt-6"><p className="text-sm text-slate-700">{t("setup.notReady")}</p></CardContent></Card>;
  }

  const options = st.options;
  const keys = st.keys ?? [];
  const keyOf = (id: KeyId) => keys.find((k) => k.id === id);
  const companyList = st.companies?.config?.companies ?? [];
  const members = st.members ?? [];
  const allow = st.allowlist;
  const completed = !!st.completedAt;

  const done1 = !!st.companies?.fileExists && !st.companies.error;
  const done2 = REQUIRED.every((id) => keyOf(id)?.configComplete);
  const done3 = REQUIRED.every((id) => keyOf(id)?.status === "healthy");
  const done4 = !!st.smoke && st.smoke.failed.length === 0 && st.smoke.ok > 0;
  const savedEmpty = !allow || (allow.saved.domains.length === 0 && allow.saved.emails.length === 0);
  const warn5 = savedEmpty && allow?.effectiveDomains.length === 1 && allow.effectiveDomains[0] === "matbao.com";
  const done5 = members.length >= 1;
  const warnings: string[] = [];
  if (!done2) warnings.push(t("setup.warn.keys"));
  if (!done3) warnings.push(t("setup.warn.health"));
  if (!done4) warnings.push(t("setup.warn.smoke"));
  if ((st.perCompany ?? []).some((p) => !p.caseTarget)) warnings.push(t("setup.warn.target"));
  if (!done5 || warn5) warnings.push(!done5 ? t("setup.warn.noUsers") : t("setup.warn.defaultAllow"));

  // ---- Hành động ----
  const patchRow = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function saveCompanies() {
    setMsg1(null);
    const local: string[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (!ID_RE.test(r.id)) local.push(t("setup.step1.err.badId", { row: i + 1, id: r.id }));
      if (seen.has(r.id)) local.push(t("setup.step1.err.dup", { row: i + 1, id: r.id }));
      seen.add(r.id);
      if (!r.label.trim()) local.push(t("setup.step1.err.noLabel", { row: i + 1 }));
    });
    if (!rows.length) local.push(t("setup.step1.err.needOne"));
    if (local.length) { setMsg1({ ok: false, list: local }); return; }
    setBusy1(true);
    try {
      const fb = rows.some((r) => r.id === fallback) ? fallback : rows[0].id;
      const r = await call<unknown>("/api/setup/companies", "PUT", {
        orgName: orgName.trim(), modules: Array.from(new Set(["marketing", ...mods])), fallback: fb,
        companies: rows.map((x) => ({
          id: x.id, label: x.label.trim(), domain: x.domain.trim(), color: x.color,
          googleAccountNames: csv(x.googleAccountNames), campaignContains: csv(x.campaignContains),
          brandTerms: csv(x.brandTerms), competitors: csv(x.competitors),
        })),
      });
      if (r.status === 422) { setMsg1({ ok: false, text: t("setup.step1.err.invalid"), list: r.data.errors ?? [r.data.error ?? t("setup.step1.saveFail")] }); return; }
      if (!r.ok || r.data.success === false) throw new Error(r.data.error ?? t("setup.step1.saveFailHttp", { status: r.status }));
      setMsg1({ ok: true, text: t("setup.step1.saved") });
      window.location.reload();
    } catch (e) { setMsg1({ ok: false, text: e instanceof Error ? e.message : t("setup.step1.saveFail") }); }
    finally { setBusy1(false); }
  }

  async function runHealth() {
    setBusy3(true); setMsg3("");
    try {
      const r = await call<{ records?: Record<string, HealthRec> }>("/api/connectors/health", "POST");
      if (!r.ok) throw new Error(r.data.error ?? t("setup.step3.failHttp", { status: r.status }));
      setHealth(r.data.records ?? {});
      await refresh(false);
    } catch (e) { setMsg3(e instanceof Error ? e.message : t("setup.step3.fail")); }
    finally { setBusy3(false); }
  }

  async function runSmoke() {
    setBusy4(true); setMsg4("");
    try {
      const r = await call<{ run?: { at: string; results: SmokeResult[] } }>("/api/setup/smoke", "POST");
      if (!r.ok || r.data.success === false || !r.data.run) throw new Error(r.data.error ?? t("setup.step4.failHttp", { status: r.status }));
      setSmokeRun(r.data.run);
      await refresh(false);
    } catch (e) { setMsg4(e instanceof Error ? e.message : t("setup.step4.fail")); }
    finally { setBusy4(false); }
  }

  async function saveAllow() {
    setBusyA(true); setMsgA(null);
    try {
      const r = await call<unknown>("/api/setup/allowlist", "PUT", { domains: lst(domainsTxt).map((d) => d.toLowerCase()), emails: lst(emailsTxt).map((d) => d.toLowerCase()) });
      if (!r.ok || r.data.success === false) throw new Error(r.data.error ?? t("setup.step1.saveFailHttp", { status: r.status }));
      setMsgA({ ok: true, text: t("setup.step5.allowSaved") });
      await refresh(false);
    } catch (e) { setMsgA({ ok: false, text: e instanceof Error ? e.message : t("setup.step1.saveFail") }); }
    finally { setBusyA(false); }
  }

  async function addUser() {
    setMsgU(null);
    if (!uEmail.trim() || !uName.trim()) { setMsgU({ ok: false, text: t("setup.step5.err.emailName") }); return; }
    if (uPass.length < 12) { setMsgU({ ok: false, text: t("setup.step5.err.passMin") }); return; }
    const access = uRole === "super_admin" ? ["ALL"] : uAccess;
    if (!access.length) { setMsgU({ ok: false, text: t("setup.step5.err.pickCompany") }); return; }
    setBusyU(true);
    try {
      const r = await call<unknown>("/api/settings/users", "POST", { email: uEmail.trim(), name: uName.trim(), role: uRole, password: uPass, company_access: access });
      if (r.status !== 201 && (!r.ok || r.data.success === false)) throw new Error(r.data.error ?? t("setup.step5.addFailHttp", { status: r.status }));
      setUEmail(""); setUName(""); setUPass(""); setUAccess([]); setURole("admin");
      setMsgU({ ok: true, text: t("setup.step5.added") });
      await refresh(false);
    } catch (e) { setMsgU({ ok: false, text: e instanceof Error ? e.message : t("setup.step5.addFail") }); }
    finally { setBusyU(false); }
  }

  async function complete() {
    setBusy6(true); setMsg6("");
    try {
      const r = await call<unknown>("/api/setup/complete", "POST");
      if (!r.ok || r.data.success === false) throw new Error(r.data.error ?? t("setup.step6.failHttp", { status: r.status }));
      window.location.href = "/";
    } catch (e) { setMsg6(e instanceof Error ? e.message : t("setup.step6.fail")); setBusy6(false); }
  }

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const smokeGroups: Record<string, SmokeResult[]> = {};
  (smokeRun?.results ?? []).forEach((x) => { (smokeGroups[x.company] ||= []).push(x); });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("setup.header.title")}</CardTitle>
          <CardDescription>{t("setup.header.intro")}</CardDescription>
        </CardHeader>
        {st.pending && (
          <CardContent>
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">{t("setup.header.lockNotice")}</p>
          </CardContent>
        )}
      </Card>
      {loadErr && <Msg ok={false} text={t("setup.refreshError", { error: loadErr })} />}

      {/* 1 */}
      <Step n={1} title={t("setup.step1.title")} state={done1 ? "done" : "todo"} desc={t("setup.step1.desc")}>
        <Field label={t("setup.step1.orgName")}><Input value={orgName} maxLength={60} onChange={(e) => setOrgName(e.target.value)} /></Field>
        <div className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">{t("setup.step1.modules")}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {options.modules.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <input type="checkbox" checked={m.id === "marketing" || mods.includes(m.id)} disabled={m.id === "marketing"} onChange={() => setMods((x) => toggle(x, m.id))} />
                {/* Tên mô-đun do máy chủ trả (lib/companies/defaults.ts MODULE_LABEL) — dịch theo mã mô-đun, mã lạ giữ nguyên tên. */}
                {m.id === "marketing" || m.id === "orders" || m.id === "matbao" ? t(`setup.module.${m.id}`) : m.label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{t("setup.step1.companyN", { n: i + 1 })}</span>
                <Button type="button" variant="ghost" size="sm" disabled={r.locked || rows.length <= 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t("setup.step1.removeCompany")}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("setup.step1.code")} hint={t("setup.step1.codeHint")}><Input value={r.id} maxLength={16} disabled={r.locked} onChange={(e) => patchRow(i, { id: e.target.value.toUpperCase() })} /></Field>
                <Field label={t("setup.step1.displayName")}><Input value={r.label} maxLength={60} onChange={(e) => patchRow(i, { label: e.target.value })} /></Field>
                <Field label={t("setup.step1.website")} hint={t("setup.step1.websiteHint")}><Input value={r.domain} onChange={(e) => patchRow(i, { domain: e.target.value })} /></Field>
                <Field label={t("setup.step1.color")}>
                  <select className={inputCls} value={r.color} onChange={(e) => patchRow(i, { color: e.target.value })}>
                    {options.colors.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label={t("setup.step1.googleNames")} hint={t("setup.step1.optionalCsv")}><Input value={r.googleAccountNames} onChange={(e) => patchRow(i, { googleAccountNames: e.target.value })} /></Field>
                <Field label={t("setup.step1.campaignContains")} hint={t("setup.step1.optionalCsv")}><Input value={r.campaignContains} onChange={(e) => patchRow(i, { campaignContains: e.target.value })} /></Field>
                <Field label={t("setup.step1.brandTerms")} hint={t("setup.step1.brandTermsHint")}><Input value={r.brandTerms} onChange={(e) => patchRow(i, { brandTerms: e.target.value })} /></Field>
                <Field label={t("setup.step1.competitors")} hint={t("setup.step1.optionalCsv")}><Input value={r.competitors} onChange={(e) => patchRow(i, { competitors: e.target.value })} /></Field>
              </div>
              {r.locked && <p className="text-xs text-slate-400">{t("setup.step1.locked")}</p>}
            </div>
          ))}
          {rows.length < 10 && <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow(options.colors[rs.length % options.colors.length] ?? "blue")])}><Plus className="h-4 w-4" /> {t("setup.step1.add")}</Button>}
        </div>
        {rows.length > 1 && (
          <Field label={t("setup.step1.defaultCompany")} hint={t("setup.step1.defaultCompanyHint")}>
            <select className={inputCls} value={rows.some((r) => r.id === fallback) ? fallback : rows[0].id} onChange={(e) => setFallback(e.target.value)}>
              {rows.filter((r) => r.id).map((r) => <option key={r.id} value={r.id}>{r.label || r.id}</option>)}
            </select>
          </Field>
        )}
        {st.companies?.error && <Msg ok={false} text={t("setup.step1.currentError", { error: st.companies.error })} />}
        <Msg ok={!!msg1?.ok} text={msg1?.text} list={msg1?.list} />
        <Button type="button" onClick={saveCompanies} disabled={busy1}>{busy1 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("setup.step1.save")}</Button>
      </Step>

      {/* 2 */}
      <Step n={2} title={st.connectMode === "gateway" ? t("setup.step2.gateway.title") : t("setup.step2.keys.title")} state={done2 ? "done" : "todo"}
        desc={st.connectMode === "gateway" ? t("setup.step2.gateway.desc") : t("setup.step2.keys.desc")}>
        {st.connectMode === "gateway" && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">Google Ads</p>
            <Suspense fallback={null}><ConnectCard provider="google" canEdit next="setup" /></Suspense>
          </div>
        )}
        {st.connectMode === "gateway" && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-700">Facebook</p>
            <Suspense fallback={null}><ConnectCard provider="meta" canEdit next="setup" /></Suspense>
          </div>
        )}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {KEY_IDS.map((id) => {
            const k = keyOf(id);
            return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-700">{KEY_LABEL[id]}<span className="text-xs font-normal text-slate-400">{REQUIRED.includes(id) ? t("setup.step2.required") : t("setup.step2.optional")}</span></span>
                <span className="flex items-center gap-2">{k?.configComplete && <span className="text-xs text-slate-400">{t("setup.step2.configComplete")}</span>}<StatusBadge status={k?.status ?? "missing_config"} /></span>
              </li>
            );
          })}
        </ul>
        <Link href="/settings" className="inline-flex h-9 items-center rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">{t("setup.step2.openKeysPage")}</Link>
        {(st.perCompany ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-2">{t("setup.step2.col.company")}</th><th className="px-2">Google customer ID</th><th className="px-2">Meta Pixel</th><th className="px-2">Meta Page</th><th className="px-2">{t("setup.step2.col.brandProfile")}</th><th className="px-2">{t("setup.step2.col.campaignTarget")}</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(st.perCompany ?? []).map((p) => (
                  <tr key={p.id}><td className="py-1.5 pr-2 font-medium text-slate-700">{p.label}</td><td className="px-2"><Tick ok={p.googleCustomerId} /></td><td className="px-2"><Tick ok={p.metaPixelId} /></td><td className="px-2"><Tick ok={p.metaPageId} /></td><td className="px-2"><Tick ok={p.brandProfile} /></td><td className="px-2"><Tick ok={!!p.caseTarget} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400">{footnote(t("setup.step2.footnote"))}</p>
      </Step>

      {/* 3 */}
      <Step n={3} title={t("setup.step3.title")} state={done3 ? "done" : "todo"} desc={t("setup.step3.desc")}>
        <Button type="button" onClick={runHealth} disabled={busy3}>{busy3 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {t("setup.step3.check")}</Button>
        {msg3 && <Msg ok={false} text={msg3} />}
        {health && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {KEY_IDS.map((id) => {
              const h = health[id];
              return (
                <li key={id} className="space-y-1 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-700">{KEY_LABEL[id]}</span><StatusBadge status={h?.status ?? "missing_config"} /></div>
                  {h?.failureReason && <p className="text-xs text-red-600">{h.failureReason}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Step>

      {/* 4 */}
      <Step n={4} title={t("setup.step4.title")} state={done4 ? "done" : "todo"} desc={t("setup.step4.desc")}>
        <Button type="button" onClick={runSmoke} disabled={busy4}>{busy4 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {busy4 ? t("setup.step4.running") : t("setup.step4.run")}</Button>
        {msg4 && <Msg ok={false} text={msg4} />}
        {st.smoke && (
          <p className="text-xs text-slate-500">{t("setup.step4.last", { at: fmtDate(st.smoke.at), ok: st.smoke.ok, failed: st.smoke.failed.length, skipped: st.smoke.skipped })}</p>
        )}
        {st.smoke && st.smoke.failed.length > 0 && !smokeRun && (
          <ul className="space-y-1 text-sm text-red-600">{st.smoke.failed.map((f, i) => <li key={i}>✗ {f.company} · {f.label}: {f.detail}</li>)}</ul>
        )}
        {Object.entries(smokeGroups).map(([company, items]) => (
          <div key={company} className="space-y-1 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">{company}</p>
            <ul className="space-y-1 text-sm">
              {items.map((x, i) => (
                <li key={i} className={x.skipped ? "text-slate-500" : x.ok ? "text-emerald-700" : "text-red-600"}>
                  {x.skipped ? t("setup.step4.skipped") : x.ok ? "✓" : "✗"} {x.label}
                  {x.detail && <span className="text-xs text-slate-400"> — {x.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Step>

      {/* 5 */}
      <Step n={5} title={t("setup.step5.title")} state={!done5 ? "todo" : warn5 ? "warn" : "done"} desc={t("setup.step5.desc")}>
        <div className="space-y-3">
          <Field label={t("setup.step5.domains")} hint={t("setup.step5.domainsHint")}>
            <textarea className={`${inputCls} min-h-16`} value={domainsTxt} onChange={(e) => setDomainsTxt(e.target.value)} />
          </Field>
          <Field label={t("setup.step5.emails")} hint={t("setup.step5.emailsHint")}>
            <textarea className={`${inputCls} min-h-16`} value={emailsTxt} onChange={(e) => setEmailsTxt(e.target.value)} />
          </Field>
          {allow && <p className="text-xs text-slate-500">{t("setup.step5.effective", { list: allow.effectiveDomains.join(", ") || t("setup.step5.none") })}</p>}
          {allow && (allow.envDomains || allow.envEmails) && <p className="text-xs text-slate-400">{t("setup.step5.envList")}</p>}
          {warn5 && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("setup.step5.warnDefault")}</p>}
          {msgA && <Msg ok={msgA.ok} text={msgA.text} />}
          <Button type="button" onClick={saveAllow} disabled={busyA}>{busyA ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("setup.step5.saveAllow")}</Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-2">{t("setup.step5.col.email")}</th><th className="px-2">{t("setup.step5.col.name")}</th><th className="px-2">{t("setup.step5.col.role")}</th><th className="px-2">{t("setup.step2.col.company")}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id}><td className="py-1.5 pr-2 break-all">{m.email}</td><td className="px-2">{m.name}</td><td className="px-2">{m.role}</td><td className="px-2">{m.company_access.join(", ")}</td></tr>
              ))}
              {members.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">{t("setup.step5.empty")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-700">{t("setup.step5.addUser")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("setup.step5.col.email")}><Input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} autoComplete="off" /></Field>
            <Field label={t("setup.step5.col.name")}><Input value={uName} onChange={(e) => setUName(e.target.value)} /></Field>
            <Field label={t("setup.step5.password")} hint={t("setup.step5.passwordHint")}>
              <div className="flex gap-2">
                <Input type={showPass ? "text" : "password"} value={uPass} onChange={(e) => setUPass(e.target.value)} autoComplete="new-password" />
                <Button type="button" variant="outline" size="sm" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? t("setup.step5.hidePassword") : t("setup.step5.showPassword")}>{showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              </div>
            </Field>
            <Field label={t("setup.step5.col.role")}>
              <select className={inputCls} value={uRole} onChange={(e) => setURole(e.target.value)}>
                {ROLES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
              </select>
            </Field>
          </div>
          {uRole !== "super_admin" && (
            <div className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">{t("setup.step5.access")}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex items-center gap-2"><input type="checkbox" checked={uAccess.includes("ALL")} onChange={() => setUAccess((a) => toggle(a, "ALL"))} /> {t("setup.step5.allCompanies")}</label>
                {companyList.map((c) => (
                  <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={uAccess.includes(c.id)} onChange={() => setUAccess((a) => toggle(a, c.id))} /> {c.label}</label>
                ))}
              </div>
              {companyList.length === 0 && <p className="text-xs text-slate-400">{t("setup.step5.saveCompaniesFirst")}</p>}
            </div>
          )}
          {msgU && <Msg ok={msgU.ok} text={msgU.text} />}
          <Button type="button" onClick={addUser} disabled={busyU}>{busyU ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("setup.step5.addUser")}</Button>
        </div>
      </Step>

      {/* 6 */}
      <Step n={6} title={t("setup.step6.title")} state={completed ? "done" : "todo"}>
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="mb-1 font-medium">{t("setup.step6.notes")}</p>
            <ul className="list-disc space-y-0.5 pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {completed ? (
          <>
            <p className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {t("setup.step6.completed", { at: fmtDate(st.completedAt), by: st.completedBy ?? "" })}</p>
            <p className="text-xs text-slate-400">{t("setup.step6.canEdit")}</p>
          </>
        ) : (
          <>
            {!done1 && <p className="text-xs text-slate-500">{t("setup.step6.needStep1")}</p>}
            {msg6 && <Msg ok={false} text={msg6} />}
            <Button type="button" onClick={complete} disabled={!done1 || busy6}>{busy6 ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("setup.step6.finish")}</Button>
          </>
        )}
      </Step>
    </div>
  );
}
