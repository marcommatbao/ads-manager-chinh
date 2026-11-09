"use client";

// ============================================================
// ServiceKeys — "Khoá dịch vụ khác" (Đợt 24a)
// ============================================================
// SerpApi, SearchAPI, Apify, Resend, bot Telegram KPI — trước đây chỉ đặt được bằng biến môi trường máy chủ.
// Gọi app/api/settings/service-keys/route.ts. Máy chủ trả giá trị ĐÃ CHE; ô còn dạng che (****) gửi lên = không đổi.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface KeyRow { key: string; label: string; help: string; secret: boolean; value: string; connected: boolean; source: "settings" | "env" | "none" }

const SOURCE: Record<KeyRow["source"], { text: MessageKey; cls: string }> = {
  settings: { text: "creative.settingsServiceKeys.src.settings", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  env: { text: "creative.settingsServiceKeys.src.env", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  none: { text: "creative.settingsServiceKeys.src.none", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

export function ServiceKeys({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/service-keys");
      if (res.status === 403) { setForbidden(true); return; }
      if (res.ok) setRows(((await res.json()) as { keys: KeyRow[] }).keys);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changed = Object.entries(draft).filter(([, v]) => v.trim() !== "");

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/service-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(changed)) });
      const j = (await res.json()) as { ok: boolean; message?: string; error?: string; keys?: KeyRow[] };
      setMsg({ ok: j.ok, text: j.ok ? j.message ?? t("creative.settingsServiceKeys.saved") : j.error ?? t("creative.settingsServiceKeys.err.save") });
      if (j.ok) { setDraft({}); if (j.keys) setRows(j.keys); }
    } catch {
      setMsg({ ok: false, text: t("creative.settingsServiceKeys.err.server") });
    } finally {
      setSaving(false);
    }
  }

  // 08/10: bản cài khách không còn khoá nào hiện (mọi ô gắn gói matbao) → ẩn cả khung, không để thẻ rỗng.
  if (forbidden || !rows || rows.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-bold text-slate-800">{t("creative.settingsServiceKeys.title")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {t("creative.settingsServiceKeys.desc")}
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`sk-${r.key}`} className="text-sm font-medium text-slate-800">{r.label}</label>
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", SOURCE[r.source].cls)}>{t(SOURCE[r.source].text)}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{r.help}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                id={`sk-${r.key}`}
                type={r.secret && !show[r.key] ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                placeholder={r.value || t("creative.settingsServiceKeys.placeholder")}
                value={draft[r.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                disabled={!canEdit || r.source === "env"}
                title={r.source === "env" ? t("creative.settingsServiceKeys.titleEnv") : !canEdit ? t("creative.settingsServiceKeys.titleNoEdit") : undefined}
                className="font-mono text-xs"
              />
              {r.secret && (
                <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0" aria-label={show[r.key] ? t("creative.settingsServiceKeys.hide") : t("creative.settingsServiceKeys.show")} onClick={() => setShow((s) => ({ ...s, [r.key]: !s[r.key] }))}>
                  {show[r.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {msg && (
        <div role="status" className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", msg.ok ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700")}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!canEdit || saving || changed.length === 0} title={!canEdit ? t("creative.settingsServiceKeys.titleNoEdit") : undefined} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t("creative.settingsServiceKeys.save")}
        </Button>
      </div>
    </div>
  );
}
