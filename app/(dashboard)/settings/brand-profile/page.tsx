"use client";
// Đợt 21 A3 — Cài đặt → Hồ sơ doanh nghiệp. AI viết quảng cáo + trợ lý AdsBot dùng hồ sơ này.
// MBC/MBI chưa lưu: AI vẫn dùng nội dung cũ trong mã (hiện ghi chú); bấm Lưu là chuyển sang dùng hồ sơ.
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getJson, ApiError } from "@/components/case/api";
import { companyIds, companyLabel } from "@/lib/companies/registry";
import { useCompaniesVersion } from "@/lib/companies/use-companies";
import type { BrandProfile, BrandProduct } from "@/lib/brand/types";
import { deriveCatalog, type CompanyInfo, type ProductCatalog } from "@/lib/case/product-catalog";
import { useIntlLocale, useT } from "@/lib/i18n/client";

interface Resp { profile: BrandProfile; saved: boolean; legacy: boolean; canEdit: boolean
  lexicon?: { fixed: ProductCatalog | null; self: CompanyInfo | null; others: CompanyInfo[] } }

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-amber-700">{empty}</p>;
  return <div className="flex flex-wrap gap-1.5">{items.map((x) => <span key={x} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{x}</span>)}</div>;
}

/** 19/10 — tool xếp lượt tìm thế nào cho công ty này (xem trước theo nội dung đang gõ; áp dụng sau khi Lưu). */
function IntentPreview({ data, p }: { data: Resp; p: BrandProfile }) {
  const t = useT();
  const lx = data.lexicon;
  if (!lx) return null;
  const cat = lx.fixed ?? (lx.self ? deriveCatalog({ ...lx.self, brandName: p.brandName, domain: p.domain || lx.self.domain, industry: p.industry, products: p.products.map((x) => x.name).filter(Boolean) }, lx.others) : null);
  if (!cat) return null;
  return (
    <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3 md:col-span-2">
      <div>
        <div className="text-sm font-medium text-slate-700">{t("creative.settingsBrandProfile.intent.title")}</div>
        <p className="text-xs text-slate-500">
          {lx.fixed
            ? t("creative.settingsBrandProfile.intent.fixed")
            : t("creative.settingsBrandProfile.intent.derived")}
        </p>
      </div>
      <div className="space-y-1"><div className="text-xs font-semibold text-slate-600">{t("creative.settingsBrandProfile.intent.brandLabel")}</div><Chips items={cat.brand} empty={t("creative.settingsBrandProfile.intent.brandEmpty")} /></div>
      <div className="space-y-1"><div className="text-xs font-semibold text-slate-600">{t("creative.settingsBrandProfile.intent.ownLabel")}</div><Chips items={cat.own} empty={t("creative.settingsBrandProfile.intent.ownEmpty")} /></div>
      {(cat.sibling.products.length > 0 || cat.sibling.brand.length > 0) && (
        <div className="space-y-1"><div className="text-xs font-semibold text-slate-600">{t("creative.settingsBrandProfile.intent.siblingLabel", { site: cat.sibling.site ? ` (${cat.sibling.site})` : "" })}</div><Chips items={[...cat.sibling.brand, ...cat.sibling.products]} empty="" /></div>
      )}
      <div className="space-y-1"><div className="text-xs font-semibold text-slate-600">{t("creative.settingsBrandProfile.intent.competitorsLabel")}</div><Chips items={cat.competitors} empty={t("creative.settingsBrandProfile.intent.competitorsEmpty")} /></div>
    </div>
  );
}
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export default function BrandProfilePage() {
  const t = useT();
  const loc = useIntlLocale();
  useCompaniesVersion();
  const ids = companyIds();
  const [company, setCompany] = useState(ids[0] ?? "");
  const [data, setData] = useState<Resp | null>(null);
  const [p, setP] = useState<BrandProfile | null>(null);
  const [strengths, setStrengths] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!company) return;
    let alive = true;
    setData(null); setMsg(null);
    getJson(`/api/settings/brand-profile?company=${company}`).then((j: Resp) => {
      if (!alive) return;
      setData(j); setP(j.profile); setStrengths(j.profile.strengths.join("\n")); setForbidden(j.profile.forbidden.join("\n"));
    }).catch((e) => alive && setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("creative.settingsBrandProfile.err.load") }));
    return () => { alive = false };
  }, [company, t]);

  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) => setP((x) => (x ? { ...x, [k]: v } : x));
  const setProduct = (i: number, patch: Partial<BrandProduct>) => set("products", (p?.products ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    if (!p) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/settings/brand-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, profile: { ...p, strengths: lines(strengths), forbidden: lines(forbidden) } }) });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? t("creative.settingsBrandProfile.err.save"));
      setData((d) => (d ? { ...d, saved: true, legacy: false, profile: j.profile } : d)); setP(j.profile);
      setMsg({ ok: true, text: t("creative.settingsBrandProfile.saved") });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : t("creative.settingsBrandProfile.err.save") }); }
    finally { setBusy(false); }
  }

  const ro = !data?.canEdit;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("creative.settingsBrandProfile.title")}</CardTitle>
          <CardDescription>{t("creative.settingsBrandProfile.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ids.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {ids.map((c) => (
                <Button key={c} type="button" size="sm" variant={c === company ? "default" : "outline"} onClick={() => setCompany(c)}>{companyLabel(c)}</Button>
              ))}
            </div>
          )}
          {!data && !msg && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t("creative.settingsBrandProfile.loading")}</div>}
          {data?.legacy && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t("creative.settingsBrandProfile.legacy", { company: companyLabel(company) })}
            </p>
          )}
          {p && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("creative.settingsBrandProfile.f.brandName")} hint={t("creative.settingsBrandProfile.f.brandName.hint")}><Input value={p.brandName} disabled={ro} onChange={(e) => set("brandName", e.target.value)} /></Field>
              <Field label={t("creative.settingsBrandProfile.f.domain")} hint={t("creative.settingsBrandProfile.f.domain.hint")}><Input value={p.domain} disabled={ro} onChange={(e) => set("domain", e.target.value)} /></Field>
              <Field label={t("creative.settingsBrandProfile.f.displayPath")} hint={t("creative.settingsBrandProfile.f.displayPath.hint")}><Input value={p.displayPath ?? ""} maxLength={15} disabled={ro} onChange={(e) => set("displayPath", e.target.value)} /></Field>
              <Field label={t("creative.settingsBrandProfile.f.industry")} hint={t("creative.settingsBrandProfile.f.industry.hint")}><Input value={p.industry} disabled={ro} onChange={(e) => set("industry", e.target.value)} /></Field>
              <div className="md:col-span-2"><Field label={t("creative.settingsBrandProfile.f.description")} hint={t("creative.settingsBrandProfile.f.description.hint")}><textarea className="min-h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={p.description ?? ""} disabled={ro} onChange={(e) => set("description", e.target.value)} /></Field></div>
              <Field label={t("creative.settingsBrandProfile.f.persona")} hint={t("creative.settingsBrandProfile.f.persona.hint")}><Input value={p.persona} disabled={ro} onChange={(e) => set("persona", e.target.value)} /></Field>
              <Field label={t("creative.settingsBrandProfile.f.tone")} hint={t("creative.settingsBrandProfile.f.tone.hint")}><Input value={p.tone ?? ""} disabled={ro} onChange={(e) => set("tone", e.target.value)} /></Field>
              <Field label={t("creative.settingsBrandProfile.f.strengths")} hint={t("creative.settingsBrandProfile.f.strengths.hint")}><textarea className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={strengths} disabled={ro} onChange={(e) => setStrengths(e.target.value)} /></Field>
              <Field label={t("creative.settingsBrandProfile.f.forbidden")} hint={t("creative.settingsBrandProfile.f.forbidden.hint")}><textarea className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={forbidden} disabled={ro} onChange={(e) => setForbidden(e.target.value)} /></Field>
              <div className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">{t("creative.settingsBrandProfile.products.title")}</span>
                <p className="text-xs text-slate-400">{t("creative.settingsBrandProfile.products.hint")}</p>
                {p.products.map((x, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-2 md:grid-cols-[1fr_2fr_2fr_auto]">
                    <Input placeholder={t("creative.settingsBrandProfile.products.name")} value={x.name} disabled={ro} onChange={(e) => setProduct(i, { name: e.target.value })} />
                    <Input placeholder={t("creative.settingsBrandProfile.products.desc")} value={x.description ?? ""} disabled={ro} onChange={(e) => setProduct(i, { description: e.target.value })} />
                    <Input placeholder={t("creative.settingsBrandProfile.products.url")} value={x.url ?? ""} disabled={ro} onChange={(e) => setProduct(i, { url: e.target.value })} />
                    <Button type="button" variant="ghost" size="sm" disabled={ro} onClick={() => set("products", p.products.filter((_, j) => j !== i))} aria-label={t("creative.settingsBrandProfile.products.remove")}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                {!ro && <Button type="button" variant="outline" size="sm" onClick={() => set("products", [...p.products, { name: "" }])}><Plus className="h-4 w-4" />{t("creative.settingsBrandProfile.products.add")}</Button>}
              </div>
              {data && <IntentPreview data={data} p={p} />}
            </div>
          )}
          {msg && <p className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{msg.text}</p>}
          {p && !ro && <Button type="button" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t("creative.settingsBrandProfile.btn.save")}</Button>}
          {data?.saved && p?.updatedAt && <p className="text-xs text-slate-400">{t("creative.settingsBrandProfile.lastSaved", { time: new Date(p.updatedAt).toLocaleString(loc) })}{p.updatedBy ? ` · ${p.updatedBy}` : ""}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
