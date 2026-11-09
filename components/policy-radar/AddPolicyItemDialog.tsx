"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { ToastMessage } from "@/components/Toast";
import { CATEGORY_LABELS, CHANGE_TYPE_LABELS } from "@/lib/policy-radar/labels";
import { useT } from "@/lib/i18n/client";
import type {
  PolicyCategory,
  PolicyChangeType,
  PolicyPlatform,
  PolicyRadarItem,
  PolicySourceType,
} from "@/lib/policy-radar/types";

const selectClass =
  "h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none focus:border-blue-400";

interface AddPolicyItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (item: PolicyRadarItem) => void;
  onToast: (msg: Omit<ToastMessage, "id">) => void;
}

const EMPTY_FORM = {
  platform: "google_ads" as PolicyPlatform,
  category: "policy" as PolicyCategory,
  changeType: "policy_update" as PolicyChangeType,
  sourceType: "official_policy" as PolicySourceType,
  title: "",
  sourceUrl: "",
  sourceLabel: "",
  official: true,
  publishedAt: "",
  summaryShort: "",
  whyItMatters: "",
  tags: "",
};

export function AddPolicyItemDialog({ open, onOpenChange, onCreated, onToast }: AddPolicyItemDialogProps) {
  const t = useT();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canSubmit = form.title.trim() && form.sourceUrl.trim() && form.summaryShort.trim();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/policy-radar/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          publishedAt: form.publishedAt || null,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (json.success) {
        onToast({ title: t("meta.policy.add.toastAdded") });
        onCreated(json.data);
        setForm(EMPTY_FORM);
        onOpenChange(false);
      } else {
        onToast({ title: `❌ ${json.error}`, variant: "error" });
      }
    } catch {
      onToast({ title: t("meta.policy.apiError"), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("meta.policy.add.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.platform")}</label>
              <select className={selectClass} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as PolicyPlatform })}>
                <option value="google_ads">Google Ads</option>
                <option value="meta">Meta</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.category")}</label>
              <select className={selectClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as PolicyCategory })}>
                {(Object.keys(CATEGORY_LABELS) as PolicyCategory[]).map((key) => (
                  <option key={key} value={key}>{t(`meta.policy.cat.${key}`)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.changeType")}</label>
              <select className={selectClass} value={form.changeType} onChange={(e) => setForm({ ...form, changeType: e.target.value as PolicyChangeType })}>
                {(Object.keys(CHANGE_TYPE_LABELS) as PolicyChangeType[]).map((key) => (
                  <option key={key} value={key}>{t(`meta.policy.change.${key}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.effectiveDate")}</label>
              <Input type="date" value={form.publishedAt} onChange={(e) => setForm({ ...form, publishedAt: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.titleLabel")}</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("meta.policy.add.titlePh")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.sourceUrl")}</label>
              <Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://support.google.com/..." />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.sourceName")}</label>
              <Input value={form.sourceLabel} onChange={(e) => setForm({ ...form, sourceLabel: e.target.value })} placeholder={t("meta.policy.add.sourceNamePh")} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Checkbox checked={form.official} onCheckedChange={(c) => setForm({ ...form, official: c })} />
            {t("meta.policy.add.official")}
          </label>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.summary")}</label>
            <Textarea value={form.summaryShort} onChange={(e) => setForm({ ...form, summaryShort: e.target.value })} placeholder={t("meta.policy.add.summaryPh")} />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.why")}</label>
            <Textarea value={form.whyItMatters} onChange={(e) => setForm({ ...form, whyItMatters: e.target.value })} placeholder={t("meta.policy.add.whyPh")} />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">{t("meta.policy.add.tags")}</label>
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="ai-disclosure, targeting" />
          </div>

          <p className="text-xs text-slate-400">
            {t("meta.policy.add.hint")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("meta.policy.add.cancel")}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || saving}>{saving ? t("meta.policy.add.saving") : t("meta.policy.add.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
