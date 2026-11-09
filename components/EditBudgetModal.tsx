"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { formatCurrency } from "@/lib/utils";
import { useAdsStore } from "@/store/useAdsStore";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { Campaign } from "@/types/ads.types";

interface EditBudgetModalProps {
  campaign: Campaign | null;
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newBudget: number) => void;
}

export function EditBudgetModal({
  campaign,
  currency,
  isOpen,
  onClose,
  onSuccess,
}: EditBudgetModalProps) {
  const intl = useIntlLocale();
  const { toast } = useToast();
  const t = useT();
  const { updateCampaignBudget } = useAdsStore();
  const [isSaving, setIsSaving] = useState(false);
  const [budget, setBudget] = useState<string>("");

  useEffect(() => {
    if (isOpen && campaign) {
      setBudget(campaign.dailyBudget.toString());
    }
  }, [isOpen, campaign]);

  if (!campaign) return null;

  const currentBudget = campaign.dailyBudget;
  const newBudget = parseInt(budget || "0", 10);
  const hasChanged = newBudget !== currentBudget && newBudget >= 10000;

  const difference = newBudget - currentBudget;
  const percentChange = currentBudget > 0 ? (difference / currentBudget) * 100 : 0;

  const handleSave = async () => {
    if (!hasChanged) return;
    setIsSaving(true);
    
    try {
      // Previously always PATCHed the Meta endpoint for every campaign —
      // that route didn't even exist (404 for everyone), and even once
      // fixed, Google campaigns need their own real endpoint since budget
      // lives on a separate campaign_budget resource in Google Ads.
      const endpoint = campaign.platform === "google"
        ? `/api/google/campaigns/${campaign.id}/budget`
        : `/api/meta/campaigns/${campaign.id}/budget`;
      const body = campaign.platform === "google"
        ? { dailyBudget: newBudget, company: campaign.company }
        : { dailyBudget: newBudget };

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      if (data.success) {
        updateCampaignBudget(campaign.id, newBudget);
        // Server cảnh báo là hệ thống tự động vừa đổi campaign này. Không chặn (đây
        // là quyết định của người) nhưng PHẢI nói ra — nếu không thì họ vừa ghi đè
        // lên thay đổi của cron mà không hề biết, rồi vài giờ sau cron đè lại.
        if (data.conflictWarning) {
          toast({
            title: t("panels.budget.updatedWarn", { warning: data.conflictWarning }),
            variant: "error",
          });
        } else {
          toast({ title: t("panels.budget.updated") });
        }
        onSuccess(newBudget);
        onClose();
      } else {
        toast({ title: `❌ ${data.error}`, variant: "error" });
      }
    } catch {
      toast({ title: t("panels.budget.connError"), variant: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSaving && !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t("panels.budget.title", { name: campaign.name })}</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <p className="text-sm font-medium text-slate-700">
            {t("panels.budget.current", { amount: formatCurrency(currentBudget, currency, true, intl) })}
          </p>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500">{t("panels.budget.newLabel")}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium pb-[1px]">₫</span>
              <Input
                type="number"
                min={10000}
                step={10000}
                className="pl-7"
                placeholder={t("panels.budget.placeholder")}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled={isSaving}
              />
            </div>
            <p className="text-[11px] text-slate-400">{t("panels.budget.min")}</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {[50000, 100000, 150000, 200000, 500000].map((val) => (
              <Button
                key={val}
                variant="outline"
                size="sm"
                className="text-xs h-7 px-2 border-slate-200"
                onClick={() => setBudget(val.toString())}
                disabled={isSaving}
              >
                ₫{val / 1000}K
              </Button>
            ))}
          </div>

          {newBudget > 0 && newBudget !== currentBudget && (
            <div className={`mt-2 text-sm font-medium ${difference > 0 ? "text-emerald-600" : "text-amber-600"}`}>
              {difference > 0 ? t("panels.budget.increase") : t("panels.budget.decrease")}{" "}
              {t("panels.budget.perDay", { amount: formatCurrency(Math.abs(difference), currency, true, intl) })} ({difference > 0 ? "+" : ""}{percentChange.toFixed(0)}%)
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 mt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>{t("panels.budget.cancel")}</Button>
          <Button className="bg-amber-500 hover:bg-amber-600 text-amber-950" onClick={handleSave} disabled={!hasChanged || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("panels.budget.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
