"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Send,
  Info,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────
// Toggle Switch
// ─────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="relative h-6 w-11 rounded-full bg-slate-200 transition-colors duration-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-300 after:bg-white after:transition-all after:duration-200 peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-amber-300" />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

// ─────────────────────────────────────────────
// Password Field with show/hide
// ─────────────────────────────────────────────

function PasswordField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border-slate-200 pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label={show ? t("creative.settingsNotifications.pw.hide") : t("creative.settingsNotifications.pw.show")}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// State types
// ─────────────────────────────────────────────

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  alert_cpl: boolean;
  report_daily: boolean;
  alert_budget: boolean;
}

interface EmailConfig {
  api_key: string;
  recipients: string;
  report_weekly: boolean;
  alert_cpl: boolean;
}

interface SlackConfig {
  webhook_url: string;
  enabled: boolean;
}

interface NotifState {
  telegram: TelegramConfig;
  email: EmailConfig;
  slack: SlackConfig;
}

const DEFAULT_STATE: NotifState = {
  telegram: {
    bot_token: "",
    chat_id: "",
    alert_cpl: true,
    report_daily: true,
    alert_budget: true,
  },
  email: {
    api_key: "",
    recipients: "",
    report_weekly: false,
    alert_cpl: false,
  },
  slack: {
    webhook_url: "",
    enabled: false,
  },
};

type SaveStatus = "idle" | "saving" | "success" | "error";
type TestStatus = "idle" | "testing" | "ok" | "fail";

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function NotificationsSettingsPage() {
  const t = useT();
  const [state, setState] = useState<NotifState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setState((prev) => ({
          telegram: {
            ...prev.telegram,
            bot_token: data.telegram_bot_token ?? "",
            chat_id: data.telegram_chat_id ?? "",
          },
          email: {
            ...prev.email,
            api_key: data.resend_api_key ?? "",
            recipients: data.report_email ?? "",
          },
          slack: {
            ...prev.slack,
            webhook_url: data.slack_webhook_url ?? "",
          },
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const patch = <K extends keyof NotifState>(key: K, patch: Partial<NotifState[K]>) => {
    setState((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  };

  const handleTelegramTest = async () => {
    setTestStatus("testing");
    setTestMessage(null);
    try {
      const res = await fetch("/api/settings/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_token: state.telegram.bot_token,
          chat_id: state.telegram.chat_id,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setTestStatus("ok");
        setTestMessage(json.message ?? t("creative.settingsNotifications.test.ok"));
      } else {
        setTestStatus("fail");
        setTestMessage(json.error ?? t("creative.settingsNotifications.test.fail"));
      }
    } catch {
      setTestStatus("fail");
      setTestMessage(t("creative.settingsNotifications.test.noConn"));
    }
    setTimeout(() => {
      setTestStatus("idle");
      setTestMessage(null);
    }, 5000);
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    await new Promise((r) => setTimeout(r, 800));
    setSaveStatus("success");
    setTimeout(() => setSaveStatus("idle"), 3000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <Info className="mt-0.5 h-5 w-5 text-amber-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800">{t("creative.settingsNotifications.note.title")}</p>
          <p className="mt-0.5 text-xs text-amber-700">
            {t("creative.settingsNotifications.note.body")}
          </p>
        </div>
      </div>

      {/* Telegram */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-sky-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">Telegram</CardTitle>
          </div>
          <CardDescription className="text-sm text-slate-500 mt-1">
            {t("creative.settingsNotifications.tg.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordField
            label="Bot Token"
            value={state.telegram.bot_token}
            placeholder="123456789:ABCdefGHIjklMNO..."
            onChange={(v) => patch("telegram", { bot_token: v })}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Chat ID</label>
            <Input
              type="text"
              placeholder={t("creative.settingsNotifications.tg.chatPlaceholder")}
              value={state.telegram.chat_id}
              onChange={(e) => patch("telegram", { chat_id: e.target.value })}
              className="rounded-lg border-slate-200"
            />
          </div>

          {/* Test button */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTelegramTest}
              disabled={testStatus === "testing" || !state.telegram.bot_token || !state.telegram.chat_id}
              className="gap-2 border-slate-200 text-slate-600 hover:text-amber-700"
            >
              {testStatus === "testing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t("creative.settingsNotifications.tg.test")}
            </Button>
            {testStatus === "ok" && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {testMessage}
              </span>
            )}
            {testStatus === "fail" && (
              <span className="flex items-center gap-1 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5" />
                {testMessage}
              </span>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("creative.settingsNotifications.types")}
            </p>
            <Toggle
              checked={state.telegram.alert_cpl}
              onChange={(v) => patch("telegram", { alert_cpl: v })}
              label={t("creative.settingsNotifications.tg.alertCpl")}
            />
            <Toggle
              checked={state.telegram.report_daily}
              onChange={(v) => patch("telegram", { report_daily: v })}
              label={t("creative.settingsNotifications.tg.reportDaily")}
            />
            <Toggle
              checked={state.telegram.alert_budget}
              onChange={(v) => patch("telegram", { alert_budget: v })}
              label={t("creative.settingsNotifications.tg.alertBudget")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Email (Resend) */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-violet-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">Email (Resend)</CardTitle>
          </div>
          <CardDescription className="text-sm text-slate-500 mt-1">
            {t("creative.settingsNotifications.email.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordField
            label="Resend API Key"
            value={state.email.api_key}
            placeholder="re_xxxxxxxxxxxxxxxxxxxx"
            onChange={(v) => patch("email", { api_key: v })}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">
              {t("creative.settingsNotifications.email.recipients")}{" "}
              <span className="font-normal text-slate-400">{t("creative.settingsNotifications.email.recipientsHint")}</span>
            </label>
            <Input
              type="text"
              placeholder="admin@matbao.com, team@matbao.com"
              value={state.email.recipients}
              onChange={(e) => patch("email", { recipients: e.target.value })}
              className="rounded-lg border-slate-200"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("creative.settingsNotifications.types")}
            </p>
            <Toggle
              checked={state.email.report_weekly}
              onChange={(v) => patch("email", { report_weekly: v })}
              label={t("creative.settingsNotifications.email.weekly")}
            />
            <Toggle
              checked={state.email.alert_cpl}
              onChange={(v) => patch("email", { alert_cpl: v })}
              label={t("creative.settingsNotifications.email.alertCpl")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Slack (optional) */}
      <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 rounded-full bg-emerald-500" />
            <CardTitle className="text-lg font-semibold text-slate-800">
              Slack{" "}
              <span className="text-sm font-normal text-slate-400">{t("creative.settingsNotifications.slack.optional")}</span>
            </CardTitle>
          </div>
          <CardDescription className="text-sm text-slate-500 mt-1">
            {t("creative.settingsNotifications.slack.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Webhook URL</label>
            <Input
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={state.slack.webhook_url}
              onChange={(e) => patch("slack", { webhook_url: e.target.value })}
              className="rounded-lg border-slate-200"
            />
          </div>
          <Toggle
            checked={state.slack.enabled}
            onChange={(v) => patch("slack", { enabled: v })}
            label={t("creative.settingsNotifications.slack.enabled")}
          />
        </CardContent>
      </Card>

      {saveStatus === "success" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-700">{t("creative.settingsNotifications.saved")}</p>
        </div>
      )}
      {saveStatus === "error" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{t("creative.settingsNotifications.err.save")}</p>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          onClick={handleSave}
          disabled={saveStatus === "saving"}
          className="gap-2 rounded-lg bg-amber-500 text-amber-950 hover:bg-amber-600"
        >
          {saveStatus === "saving" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("creative.settingsNotifications.saving")}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t("creative.settingsNotifications.save")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
