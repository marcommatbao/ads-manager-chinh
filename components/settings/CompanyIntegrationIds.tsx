"use client";
// Đợt 21 A4 — Cài đặt → API Keys: mã tích hợp THEO CÔNG TY của bản cài (mã khách hàng Google Ads, pixel + trang Meta).
// Có hiệu lực ngay (máy chủ đặt biến lúc lưu). Chỉ super_admin (trang API Keys đã chặn người không có quyền xem khoá).
import { useEffect, useState } from "react";
import { Loader2, Save, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

interface Row { id: string; label: string; customerId: string; pixelId: string; pageId: string }

export function CompanyIntegrationIds({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/settings/google").then((r) => r.json()), fetch("/api/settings/meta").then((r) => r.json())])
      .then(([g, m]: [{ companies?: { id: string; label: string; customerId: string }[] }, { companies?: { id: string; pixelId: string; pageId: string }[] }]) => {
        const mm = new Map((m.companies ?? []).map((x) => [x.id, x]));
        setRows((g.companies ?? []).map((x) => ({ id: x.id, label: x.label, customerId: x.customerId ?? "", pixelId: mm.get(x.id)?.pixelId ?? "", pageId: mm.get(x.id)?.pageId ?? "" })));
      })
      .catch(() => setMsg({ ok: false, text: t("settings.ids.loadFailed") }));
  }, []);

  const set = (i: number, k: keyof Row, v: string) => setRows((r) => (r ? r.map((x, j) => (j === i ? { ...x, [k]: v } : x)) : r));

  async function save() {
    if (!rows) return;
    setBusy(true); setMsg(null);
    try {
      const post = async (url: string, body: unknown) => {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false) throw new Error(j.error ?? j.message ?? t("settings.ids.saveFailed"));
      };
      await post("/api/settings/google", { customerIds: Object.fromEntries(rows.map((r) => [r.id, r.customerId])) });
      await post("/api/settings/meta", { companies: Object.fromEntries(rows.map((r) => [r.id, { pixelId: r.pixelId, pageId: r.pageId }])) });
      setMsg({ ok: true, text: t("settings.ids.saved") });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : t("settings.ids.saveFailed") }); }
    finally { setBusy(false); }
  }

  return (
    <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-slate-800">{t("settings.ids.title")}</CardTitle>
        <CardDescription>{t("settings.ids.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rows && !msg && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {t("settings.loading")}</div>}
        {rows?.map((r, i) => (
          <div key={r.id} className="grid gap-2 rounded-lg border border-slate-100 p-3 md:grid-cols-[120px_1fr_1fr_1fr]">
            <span className="self-center text-sm font-semibold text-slate-700">{r.label}</span>
            <Input placeholder={t("settings.ids.customerIdPlaceholder")} value={r.customerId} disabled={!canEdit} onChange={(e) => set(i, "customerId", e.target.value)} />
            <Input placeholder={t("settings.ids.pixelPlaceholder")} value={r.pixelId} disabled={!canEdit} onChange={(e) => set(i, "pixelId", e.target.value)} />
            <Input placeholder={t("settings.ids.pagePlaceholder")} value={r.pageId} disabled={!canEdit} onChange={(e) => set(i, "pageId", e.target.value)} />
          </div>
        ))}
        {msg && <p className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{msg.text}</p>}
        {rows && canEdit && <Button type="button" size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("settings.ids.save")}</Button>}
      </CardContent>
    </Card>
  );
}
