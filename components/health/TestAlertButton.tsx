"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postJson, ApiError } from "@/components/case/api";
import type { TestAlertResponse } from "./types";
import { useT } from "@/lib/i18n/client";

export function TestAlertButton() {
  const t = useT();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const json = (await postJson("/api/system/health", { action: "test_alert" })) as TestAlertResponse;
      setResult({ ok: true, msg: t("overview.health.testalert.sent", { channel: json.channel ?? t("overview.health.testalert.channelFallback") }) });
    } catch (e) {
      setResult({ ok: false, msg: e instanceof ApiError ? e.message : t("overview.health.testalert.fail") });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-800">{t("overview.health.testalert.title")}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("overview.health.testalert.desc")}
          </p>
        </div>
        <Button size="sm" onClick={send} disabled={sending}
          className="gap-1.5 text-xs shrink-0 bg-amber-600 text-white hover:bg-amber-700">
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t("overview.health.testalert.title")}
        </Button>
      </div>
      {result && (
        <p className={cn("text-xs font-medium", result.ok ? "text-emerald-600" : "text-red-600")}>
          {result.msg}
        </p>
      )}
    </div>
  );
}
