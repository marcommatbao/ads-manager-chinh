"use client";

import { CompanyIntegrationIds } from "@/components/settings/CompanyIntegrationIds";
import { isCompany, hasModule } from "@/lib/companies/registry";
import { useCompaniesVersion } from "@/lib/companies/use-companies";
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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Shield,
  Eye,
  EyeOff,
  XIcon,
  RefreshCw,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdsStore } from "@/store/useAdsStore";
import type { GA4PropertyMapping } from "@/types/ads.types";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSettingsPermission } from "@/hooks/useSettingsPermission";
import { ReadOnlyBanner } from "@/components/settings/PermissionGate";
import { ConnectorHealth } from "@/components/settings/ConnectorHealth";
import { ExtraConnections } from "@/components/settings/ExtraConnections";
import { ServiceKeys } from "@/components/settings/ServiceKeys";
import { ConnectCard } from "@/components/settings/ConnectCard";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

interface ApiSection {
  title: MessageKey;
  description: MessageKey;
  platform: string;
  color: string;
  fields: { key: string; label: MessageKey; placeholder?: MessageKey; placeholderRaw?: string }[];
}

const apiSections: ApiSection[] = [
  {
    title: "connect.section.meta.title",
    description: "connect.section.meta.description",
    platform: "meta",
    color: "bg-blue-500",
    fields: [
      { key: "metaAccessToken", label: "settings.field.metaAccessToken.label", placeholder: "settings.field.metaAccessToken.placeholder" },
      { key: "metaAdAccountId", label: "settings.field.metaAdAccountId.label", placeholderRaw: "act_123456789" },
      { key: "metaAppId", label: "settings.field.metaAppId.label", placeholder: "settings.field.metaAppId.placeholder" },
      { key: "metaAppSecret", label: "settings.field.metaAppSecret.label", placeholder: "settings.field.metaAppSecret.placeholder" },
    ],
  },
  {
    title: "connect.section.google.title",
    description: "connect.section.google.description",
    platform: "google",
    color: "bg-amber-500",
    fields: [
      { key: "googleDeveloperToken", label: "settings.field.googleDeveloperToken.label", placeholder: "settings.field.googleDeveloperToken.placeholder" },
      { key: "googleClientId", label: "settings.field.googleClientId.label", placeholder: "settings.field.googleClientId.placeholder" },
      { key: "googleClientSecret", label: "settings.field.googleClientSecret.label", placeholder: "settings.field.googleClientSecret.placeholder" },
      { key: "googleRefreshToken", label: "settings.field.googleRefreshToken.label", placeholder: "settings.field.googleRefreshToken.placeholder" },
      { key: "googleLoginCustomerId", label: "settings.field.googleLoginCustomerId.label", placeholder: "settings.field.googleLoginCustomerId.placeholder" },
      { key: "googleCustomerIdMBC", label: "settings.field.googleCustomerIdMBC.label", placeholder: "settings.field.googleCustomerIdMBC.placeholder" },
      { key: "googleCustomerIdMBI", label: "settings.field.googleCustomerIdMBI.label", placeholder: "settings.field.googleCustomerIdMBI.placeholder" },
    ],
  },
  {
    title: "settings.section.gemini.title",
    description: "settings.section.gemini.description",
    platform: "gemini",
    color: "bg-purple-500",
    fields: [
      { key: "geminiApiKey", label: "settings.field.geminiApiKey.label", placeholder: "settings.field.geminiApiKey.placeholder" },
    ],
  },
  {
    title: "settings.section.telegram.title",
    description: "settings.section.telegram.description",
    platform: "telegram",
    color: "bg-sky-500",
    fields: [
      { key: "telegramBotToken", label: "settings.field.telegramBotToken.label", placeholderRaw: "123456789:ABCdefGHIjklMNO..." },
      { key: "telegramChatId", label: "settings.field.telegramChatId.label", placeholder: "settings.field.telegramChatId.placeholder" },
    ],
  },
];

import { COMPANY_CONFIG } from "@/lib/company-config";

// Đợt 21 B: ô mã khách hàng Google cứng tên Mắt Bão → chỉ hiện ở bản cài CÓ công ty đó. Bản khách dán ở khối "Mã theo từng công ty".
const LEGACY_COMPANY_FIELD: Record<string, string> = { googleCustomerIdMBC: "MBC", googleCustomerIdMBI: "MBI" };

function CompanyMappingTable() {
  const t = useT();
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm mt-6">
      <div className="px-5 py-4 bg-slate-50 border-b border-slate-200">
        <p className="text-[15px] font-bold text-slate-800">{t("settings.map.title")}</p>
        <p className="text-[13px] text-slate-500 mt-1">
          {t("settings.map.description")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-white">
              <th className="text-left px-5 py-3 text-[12px] text-slate-500 font-semibold uppercase tracking-wider">
                {t("settings.map.col0")}
              </th>
              <th className="text-left px-5 py-3 text-[12px] text-slate-500 font-semibold uppercase tracking-wider">
                {t("settings.map.col1")}
              </th>
              <th className="text-left px-5 py-3 text-[12px] text-slate-500 font-semibold uppercase tracking-wider">
                {t("settings.map.col2")}
              </th>
              <th className="text-left px-5 py-3 text-[12px] text-slate-500 font-semibold uppercase tracking-wider">
                {t("settings.map.col3")}
              </th>
              <th className="text-left px-5 py-3 text-[12px] text-slate-500 font-semibold uppercase tracking-wider">
                {t("settings.map.col4")}
              </th>
              <th className="text-center px-5 py-3 text-[12px] text-slate-500 font-semibold uppercase tracking-wider">
                {t("settings.map.col5")}
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(COMPANY_CONFIG).map(([key, row]) => (
              <tr
                key={key}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors"
              >
                <td className="px-5 py-4">
                  <span className={cn(
                    "text-xs font-bold px-2.5 py-1 rounded-md",
                    `bg-${row.color}-100 text-${row.color}-700`
                  )}>
                    {row.label}
                  </span>
                </td>
                <td className="px-5 py-4 text-[13px] text-slate-600 font-mono">
                  {row.domain}
                </td>
                <td className="px-5 py-4 text-[13px] font-mono tabular-nums text-slate-700">
                  {row.ga4.propertyId.replace('properties/', '')}
                </td>
                <td className="px-5 py-4">
                  <span className="text-[12px] font-mono bg-slate-100 px-2 py-1 rounded text-slate-600">
                    {row.ga4.measurementId}
                  </span>
                </td>
                <td className="px-5 py-4 text-[13px] font-mono text-slate-600 tabular-nums">
                  {row.facebook.pixelId}
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="flex items-center justify-center gap-1.5 bg-emerald-50 text-emerald-700 py-1 px-2 rounded-md w-fit mx-auto">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] font-bold tracking-wide uppercase">
                      {t("settings.map.active")}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


type TestResult = { ok: boolean; message: string };

function SettingsContent() {
  const t = useT();
  const searchParams = useSearchParams();
  const perms = useSettingsPermission();
  const [values, setValues] = useState<Record<string, string>>({});
  useCompaniesVersion(); // Đợt 21 B: vẽ lại khi danh sách công ty của bản cài nạp xong (ẩn/hiện ô MBC/MBI)
  // 08/10: Telegram chỉ còn là kênh dự phòng sau Teams → thẻ này chỉ hiện ở bản có gói Mắt Bão.
  const shownSections = apiSections.filter((sec) => sec.platform !== "telegram" || hasModule("matbao"));
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaTesting, setMetaTesting] = useState(false);
  const [metaResult, setMetaResult] = useState<TestResult | null>(null);
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleTesting, setGoogleTesting] = useState(false);
  const [googleResult, setGoogleResult] = useState<TestResult | null>(null);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [geminiResult, setGeminiResult] = useState<TestResult | null>(null);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramResult, setTelegramResult] = useState<TestResult | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState({ facebook: false, google: false, ga4: false, gemini: false, telegram: false });
  // 15/10/2026: chưa có kết quả /api/status thì KHÔNG vẽ "Not connected" (kiểm Meta mất vài giây → người dùng tưởng mất kết nối).
  const [statusLoaded, setStatusLoaded] = useState(false);
  // Chế độ cổng (MB_CONNECT_*): Google/Meta kết nối bằng nút qua Cổng kết nối Mắt Bão, không dán khoá.
  const [gatewayMode, setGatewayMode] = useState(false);
  const { fetchGA4 } = useAdsStore();

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => {
        setStatus({
          ...data,
          ga4: searchParams.get("ga4_connected") === "true" || !!data.ga4,
          google: searchParams.get("google_connected") === "true" || !!data.google,
        });
        setGatewayMode(data.connectMode === "gateway");
      })
      .catch((e) => console.error("Error fetching status:", e))
      .finally(() => setStatusLoaded(true));

    const googleError = searchParams.get("google_error");
    if (googleError) {
      setGoogleResult({ ok: false, message: t("settings.google.oauthError", { error: googleError }) });
    }
    if (searchParams.get("google_connected") === "true") {
      setGoogleResult({ ok: true, message: t("settings.google.authorized") });
    }
  }, [searchParams, t]);

  // Pre-populate Meta credentials
  useEffect(() => {
    fetch("/api/settings/meta")
      .then((r) => r.json())
      .then((data: { ok: boolean; accessToken?: string; adAccountId?: string; appId?: string; appSecret?: string }) => {
        if (data.ok) {
          setValues((prev) => ({
            ...prev,
            ...(data.accessToken ? { metaAccessToken: data.accessToken } : {}),
            ...(data.adAccountId ? { metaAdAccountId: data.adAccountId } : {}),
            ...(data.appId ? { metaAppId: data.appId } : {}),
            ...(data.appSecret ? { metaAppSecret: data.appSecret } : {}),
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Pre-populate Google credentials
  useEffect(() => {
    fetch("/api/settings/google")
      .then((r) => r.json())
      .then((data: {
        ok: boolean;
        developerToken?: string;
        clientId?: string;
        clientSecret?: string;
        refreshToken?: string;
        customerIdMBC?: string;
        customerIdMBI?: string;
        loginCustomerId?: string;
      }) => {
        if (data.ok) {
          setValues((prev) => ({
            ...prev,
            ...(data.developerToken  ? { googleDeveloperToken: data.developerToken }   : {}),
            ...(data.clientId        ? { googleClientId: data.clientId }               : {}),
            ...(data.clientSecret    ? { googleClientSecret: data.clientSecret }       : {}),
            ...(data.refreshToken    ? { googleRefreshToken: data.refreshToken }       : {}),
            ...(data.customerIdMBC   ? { googleCustomerIdMBC: data.customerIdMBC }     : {}),
            ...(data.customerIdMBI   ? { googleCustomerIdMBI: data.customerIdMBI }     : {}),
            ...(data.loginCustomerId ? { googleLoginCustomerId: data.loginCustomerId } : {}),
          }));
        }
      })
      .catch(() => {});
  }, []);

  // Pre-populate Gemini credentials
  useEffect(() => {
    fetch("/api/settings/gemini")
      .then((r) => r.json())
      .then((data: { ok: boolean; apiKey?: string }) => {
        if (data.ok && data.apiKey) {
          setValues((prev) => ({ ...prev, geminiApiKey: data.apiKey! }));
        }
      })
      .catch(() => {});
  }, []);

  // Pre-populate Telegram credentials
  useEffect(() => {
    fetch("/api/settings/telegram")
      .then((r) => r.json())
      .then((data: { ok: boolean; botToken?: string; chatId?: string }) => {
        if (data.ok) {
          setValues((prev) => ({
            ...prev,
            ...(data.botToken ? { telegramBotToken: data.botToken } : {}),
            ...(data.chatId ? { telegramChatId: data.chatId } : {}),
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleShow = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleTestMeta = async () => {
    setMetaTesting(true);
    setMetaResult(null);
    const token = values["metaAccessToken"];
    const adAccountId = values["metaAdAccountId"];
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (adAccountId) params.set("adAccountId", adAccountId);
    try {
      // Đợt 21 A4: khoá gửi trong THÂN POST, không ghép lên URL (lọt log proxy / lịch sử trình duyệt).
      const res = await fetch(`/api/settings/meta/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(params)) });
      const data = await res.json() as { ok: boolean; userName?: string; accountName?: string; error?: string };
      if (data.ok) {
        setMetaResult({ ok: true, message: t("settings.meta.connectedAs", { user: data.userName ?? "", account: data.accountName ? ` · ${data.accountName}` : "" }) });
        setStatus((s) => ({ ...s, facebook: true }));
      } else {
        setMetaResult({ ok: false, message: data.error ?? t("settings.err.connectionFailed") });
        setStatus((s) => ({ ...s, facebook: false }));
      }
    } catch {
      setMetaResult({ ok: false, message: t("settings.err.network") });
    }
    setMetaTesting(false);
  };

  const handleSaveMeta = async () => {
    const token = values["metaAccessToken"];
    if (!token) return;
    setMetaSaving(true);
    try {
      const res = await fetch("/api/settings/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: values["metaAccessToken"],
          adAccountId: values["metaAdAccountId"],
          appId: values["metaAppId"],
          appSecret: values["metaAppSecret"],
        }),
      });
      const text = await res.text();
      let data: { ok: boolean; message?: string; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(t("settings.err.server", { status: res.status, text: text.slice(0, 120) })); }
      if (data.ok) {
        setStatus((s) => ({ ...s, facebook: true }));
        setMetaResult({ ok: true, message: t("settings.meta.saved") });
      } else {
        setMetaResult({ ok: false, message: data.error ?? data.message ?? t("settings.err.saveFailed") });
      }
    } catch (e) {
      setMetaResult({ ok: false, message: e instanceof Error ? e.message : t("settings.err.saveFailed") });
    }
    setMetaSaving(false);
  };

  const handleTestGoogle = async () => {
    setGoogleTesting(true);
    setGoogleResult(null);
    const params = new URLSearchParams();
    if (values["googleDeveloperToken"])  params.set("developerToken",  values["googleDeveloperToken"]);
    if (values["googleClientId"])        params.set("clientId",        values["googleClientId"]);
    if (values["googleClientSecret"])    params.set("clientSecret",    values["googleClientSecret"]);
    if (values["googleRefreshToken"])    params.set("refreshToken",    values["googleRefreshToken"]);
    if (values["googleCustomerIdMBC"])   params.set("customerIdMBC",   values["googleCustomerIdMBC"]);
    if (values["googleCustomerIdMBI"])   params.set("customerIdMBI",   values["googleCustomerIdMBI"]);
    if (values["googleLoginCustomerId"]) params.set("loginCustomerId", values["googleLoginCustomerId"]);
    try {
      // Đợt 21 A4: khoá gửi trong THÂN POST, không ghép lên URL (lọt log proxy / lịch sử trình duyệt).
      const res = await fetch(`/api/settings/google/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(params)) });
      const data = await res.json() as { ok: boolean; accounts?: { id: string; name: string }[]; error?: string };
      if (data.ok) {
        const names = data.accounts?.map((a) => a.name).join(", ") || "";
        setGoogleResult({ ok: true, message: t("settings.google.connected", { names }) });
        setStatus((s) => ({ ...s, google: true }));
      } else {
        setGoogleResult({ ok: false, message: data.error ?? t("settings.err.connectionFailed") });
        setStatus((s) => ({ ...s, google: false }));
      }
    } catch {
      setGoogleResult({ ok: false, message: t("settings.err.network") });
    }
    setGoogleTesting(false);
  };

  const handleSaveGoogle = async () => {
    setGoogleSaving(true);
    try {
      const res = await fetch("/api/settings/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          developerToken:  values["googleDeveloperToken"],
          clientId:        values["googleClientId"],
          clientSecret:    values["googleClientSecret"],
          refreshToken:    values["googleRefreshToken"],
          customerIdMBC:   values["googleCustomerIdMBC"],
          customerIdMBI:   values["googleCustomerIdMBI"],
          loginCustomerId: values["googleLoginCustomerId"],
        }),
      });
      const text = await res.text();
      let data: { ok: boolean; message?: string; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(t("settings.err.server", { status: res.status, text: text.slice(0, 120) })); }
      if (data.ok) {
        setStatus((s) => ({ ...s, google: true }));
        setGoogleResult({ ok: true, message: t("settings.google.saved") });
      } else {
        setGoogleResult({ ok: false, message: data.error ?? data.message ?? t("settings.err.saveFailed") });
      }
    } catch (e) {
      setGoogleResult({ ok: false, message: e instanceof Error ? e.message : t("settings.err.saveFailed") });
    }
    setGoogleSaving(false);
  };

  const handleTestGemini = async () => {
    setGeminiTesting(true);
    setGeminiResult(null);
    const params = new URLSearchParams();
    if (values["geminiApiKey"]) params.set("apiKey", values["geminiApiKey"]);
    try {
      // Đợt 21 A4: khoá gửi trong THÂN POST, không ghép lên URL (lọt log proxy / lịch sử trình duyệt).
      const res = await fetch(`/api/settings/gemini/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(params)) });
      const data = await res.json() as { ok: boolean; modelCount?: number; error?: string };
      if (data.ok) {
        setGeminiResult({ ok: true, message: t("settings.gemini.connected", { n: data.modelCount ?? 0 }) });
        setStatus((s) => ({ ...s, gemini: true }));
      } else {
        setGeminiResult({ ok: false, message: data.error ?? t("settings.err.connectionFailed") });
        setStatus((s) => ({ ...s, gemini: false }));
      }
    } catch {
      setGeminiResult({ ok: false, message: t("settings.err.network") });
    }
    setGeminiTesting(false);
  };

  const handleSaveGemini = async () => {
    const apiKey = values["geminiApiKey"];
    if (!apiKey) return;
    setGeminiSaving(true);
    try {
      const res = await fetch("/api/settings/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const text = await res.text();
      let data: { ok: boolean; message?: string; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(t("settings.err.server", { status: res.status, text: text.slice(0, 120) })); }
      if (data.ok) {
        setStatus((s) => ({ ...s, gemini: true }));
        setGeminiResult({ ok: true, message: t("settings.gemini.saved") });
      } else {
        setGeminiResult({ ok: false, message: data.error ?? data.message ?? t("settings.err.saveFailed") });
      }
    } catch (e) {
      setGeminiResult({ ok: false, message: e instanceof Error ? e.message : t("settings.err.saveFailed") });
    }
    setGeminiSaving(false);
  };

  const handleTestTelegram = async () => {
    setTelegramTesting(true);
    setTelegramResult(null);
    const botToken = values["telegramBotToken"];
    const chatId = values["telegramChatId"];
    if (!botToken || !chatId) {
      setTelegramResult({ ok: false, message: t("settings.telegram.needFields") });
      setTelegramTesting(false);
      return;
    }
    try {
      const res = await fetch("/api/settings/telegram/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_token: botToken, chat_id: chatId }),
      });
      const data = await res.json() as { success: boolean; botName?: string; error?: string; hint?: string };
      if (data.success) {
        setTelegramResult({ ok: true, message: t("settings.telegram.testSent", { bot: data.botName ?? "bot" }) });
        setStatus((s) => ({ ...s, telegram: true }));
      } else {
        setTelegramResult({ ok: false, message: [data.error, data.hint].filter(Boolean).join(" — ") || t("settings.err.connectionFailed") });
        setStatus((s) => ({ ...s, telegram: false }));
      }
    } catch {
      setTelegramResult({ ok: false, message: t("settings.err.network") });
    }
    setTelegramTesting(false);
  };

  const handleSaveTelegram = async () => {
    const botToken = values["telegramBotToken"];
    const chatId = values["telegramChatId"];
    if (!botToken && !chatId) return;
    setTelegramSaving(true);
    try {
      const res = await fetch("/api/settings/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId }),
      });
      const text = await res.text();
      let data: { ok: boolean; message?: string; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(t("settings.err.server", { status: res.status, text: text.slice(0, 120) })); }
      if (data.ok) {
        setStatus((s) => ({ ...s, telegram: !!(botToken && chatId) }));
        setTelegramResult({ ok: true, message: t("settings.telegram.saved") });
      } else {
        setTelegramResult({ ok: false, message: data.error ?? data.message ?? t("settings.err.saveFailed") });
      }
    } catch (e) {
      setTelegramResult({ ok: false, message: e instanceof Error ? e.message : t("settings.err.saveFailed") });
    }
    setTelegramSaving(false);
  };

  // Viewer-* roles cannot see credentials at all
  if (!perms.isLoading && !perms.canViewCredentials) {
    return (
      <div className="max-w-3xl space-y-4">
        <ReadOnlyBanner message={t("settings.keys.noViewAccess")} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      {/* Read-only banner for admins who can view but not edit */}
      {!perms.isLoading && perms.canViewCredentials && !perms.canEditCredentials && (
        <ReadOnlyBanner message={t("settings.keys.readOnly")} />
      )}
      {/* Security Notice */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <Shield className="mt-0.5 h-5 w-5 text-blue-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800">
            {t("settings.keys.secureTitle")}
          </p>
          <p className="mt-0.5 text-xs text-blue-600">
            {t("settings.keys.secureBody")}
          </p>
        </div>
      </div>

      {/* Đợt 21 A4: mã theo từng công ty của bản cài */}
      <CompanyIntegrationIds canEdit={perms.canEditCredentials} />

      {/* API Sections (Telegram chỉ ở bản Mắt Bão — xem shownSections) */}
      {shownSections.map((section, idx) => (
        <Card
          key={section.platform}
          className="border border-slate-200 bg-white shadow-sm rounded-xl"
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-3 w-3 rounded-full ${section.color}`}
              />
              <CardTitle className="text-lg font-semibold text-slate-800">
                {t(section.title)}
              </CardTitle>
              {!statusLoaded ? (
                <Badge
                  variant="outline"
                  className="ml-auto border-slate-200 text-xs text-slate-400"
                >
                  {t("connect.section.checking")}
                </Badge>
              ) : status[(section.platform === "meta" ? "facebook" : section.platform) as keyof typeof status] ? (
                <Badge
                  variant="outline"
                  className="ml-auto border-green-200 bg-green-50 text-xs text-green-700 font-semibold"
                >
                  <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                  {t("settings.connected")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="ml-auto border-slate-200 text-xs text-slate-500"
                >
                  {t("settings.notConnected")}
                </Badge>
              )}
            </div>
            <CardDescription className="text-sm text-slate-500 mt-1">
              {t(section.description)}
            </CardDescription>
            {(section.platform === "meta" || section.platform === "google") && (
              <a
                href={section.platform === "meta" ? "/guide/ket-noi#meta-ads" : "/guide/ket-noi#google-ads"}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline mt-1 w-fit"
              >
                {t("connect.section.guide")} <ArrowRight className="h-3 w-3" />
              </a>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            {gatewayMode && (section.platform === "google" || section.platform === "meta") ? (
              <ConnectCard provider={section.platform} canEdit={perms.canEditCredentials} />
            ) : (<>
            {statusLoaded && section.platform === "meta" && !status.facebook && (
              <div className="mb-2 rounded-xl border border-amber-100 bg-amber-50 p-4 space-y-2">
                <p className="text-sm text-amber-800 font-medium">
                  {t("settings.fb.notConnected")}
                </p>
                <p className="text-xs text-amber-700">
                  {t("settings.fb.getToken")}
                </p>
                <a
                  href="https://business.facebook.com/settings/system-users"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 underline underline-offset-2"
                >
                  {t("settings.fb.openSettings")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {statusLoaded && section.platform === "google" && !status.google && (
              <div className="mb-2 rounded-xl border border-amber-100 bg-amber-50 p-4 space-y-2">
                <p className="text-sm text-amber-800 font-medium">
                  {t("settings.google.notConnected")}
                </p>
                <p className="text-xs text-amber-700">
                  {t("settings.google.orOAuth")}
                </p>
                <a
                  href="/api/google/auth"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 underline underline-offset-2"
                >
                  {t("settings.google.authorizeOAuth")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {section.fields.filter((field) => !LEGACY_COMPANY_FIELD[field.key] || isCompany(LEGACY_COMPANY_FIELD[field.key])).map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  {t(field.label)}
                </label>
                <div className="relative">
                  <Input
                    type={showKeys[field.key] ? "text" : "password"}
                    placeholder={field.placeholder ? t(field.placeholder) : field.placeholderRaw}
                    value={values[field.key] ?? ""}
                    onChange={(e) =>
                      handleChange(field.key, e.target.value)
                    }
                    className="rounded-lg border-slate-200 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShow(field.key)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showKeys[field.key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}

            {section.platform === "meta" && (
              <div className="pt-2 space-y-3">
                {metaResult && (
                  <div className={cn(
                    "flex items-center gap-2 text-sm rounded-lg px-3 py-2",
                    metaResult.ok
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  )}>
                    {metaResult.ok
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <AlertCircle className="h-4 w-4 shrink-0" />}
                    {metaResult.message}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestMeta}
                    disabled={metaTesting}
                    className="gap-1.5 border-slate-200"
                  >
                    {metaTesting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("settings.testConnection")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveMeta}
                    disabled={metaSaving || !values["metaAccessToken"] || !perms.canEditCredentials}
                    title={!perms.canEditCredentials ? t("settings.keys.superAdminOnlySave") : undefined}
                    className="gap-1.5 bg-amber-500 text-amber-950 hover:bg-amber-600 disabled:opacity-40"
                  >
                    {metaSaving
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Save className="h-3.5 w-3.5" />}
                    {t("settings.saveReconnect")}
                  </Button>
                </div>
              </div>
            )}

            {section.platform === "google" && (
              <div className="pt-2 space-y-3">
                {googleResult && (
                  <div className={cn(
                    "flex items-center gap-2 text-sm rounded-lg px-3 py-2",
                    googleResult.ok
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  )}>
                    {googleResult.ok
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <AlertCircle className="h-4 w-4 shrink-0" />}
                    {googleResult.message}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestGoogle}
                    disabled={googleTesting}
                    className="gap-1.5 border-slate-200"
                  >
                    {googleTesting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("settings.testConnection")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveGoogle}
                    disabled={googleSaving || !perms.canEditCredentials}
                    title={!perms.canEditCredentials ? t("settings.keys.superAdminOnlySave") : undefined}
                    className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    {googleSaving
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Save className="h-3.5 w-3.5" />}
                    {t("settings.saveReconnect")}
                  </Button>
                </div>
              </div>
            )}

            {section.platform === "gemini" && (
              <div className="pt-2 space-y-3">
                {geminiResult && (
                  <div className={cn(
                    "flex items-center gap-2 text-sm rounded-lg px-3 py-2",
                    geminiResult.ok
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  )}>
                    {geminiResult.ok
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <AlertCircle className="h-4 w-4 shrink-0" />}
                    {geminiResult.message}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestGemini}
                    disabled={geminiTesting}
                    className="gap-1.5 border-slate-200"
                  >
                    {geminiTesting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("settings.testConnection")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveGemini}
                    disabled={geminiSaving || !values["geminiApiKey"] || !perms.canEditCredentials}
                    title={!perms.canEditCredentials ? t("settings.keys.superAdminOnlySave") : undefined}
                    className="gap-1.5 bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
                  >
                    {geminiSaving
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Save className="h-3.5 w-3.5" />}
                    {t("settings.saveReconnect")}
                  </Button>
                </div>
              </div>
            )}

            {section.platform === "telegram" && (
              <div className="pt-2 space-y-3">
                {telegramResult && (
                  <div className={cn(
                    "flex items-center gap-2 text-sm rounded-lg px-3 py-2",
                    telegramResult.ok
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  )}>
                    {telegramResult.ok
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <AlertCircle className="h-4 w-4 shrink-0" />}
                    {telegramResult.message}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestTelegram}
                    disabled={telegramTesting}
                    className="gap-1.5 border-slate-200"
                  >
                    {telegramTesting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("settings.testConnection")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveTelegram}
                    disabled={telegramSaving || (!values["telegramBotToken"] && !values["telegramChatId"]) || !perms.canEditCredentials}
                    title={!perms.canEditCredentials ? t("settings.keys.superAdminOnlySave") : undefined}
                    className="gap-1.5 bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40"
                  >
                    {telegramSaving
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Save className="h-3.5 w-3.5" />}
                    {t("settings.saveReconnect")}
                  </Button>
                </div>
              </div>
            )}
            </>)}
          </CardContent>

          {idx < shownSections.length - 1 && <Separator className="mt-0" />}
        </Card>
      ))}

      <div id="ket-noi" className="scroll-mt-20">
        <ExtraConnections canEdit={perms.canEditCredentials} />
      </div>

      <ServiceKeys canEdit={perms.canEditCredentials} />

      {/* Đợt 25: bảng tên miền MBC / MBI / Sale.AI là của Mắt Bão — bản khách dùng khối "Mã theo công ty" */}
      {hasModule("matbao") && <CompanyMappingTable />}

      {/* Connector Health panel — visible to all who can view credentials */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <ConnectorHealth canTest={perms.canEditCredentials} />
      </div>

      {/* Save All Button */}
      <div className="flex justify-end gap-3 pt-4">
        <Button
          onClick={async () => {
            await handleSaveMeta();
            await handleSaveGoogle();
            await handleSaveGemini();
            await handleSaveTelegram();
          }}
          disabled={metaSaving || googleSaving || geminiSaving || telegramSaving || !perms.canEditCredentials}
          title={!perms.canEditCredentials ? t("settings.keys.superAdminOnlySave") : undefined}
          className="gap-2 rounded-lg bg-amber-500 text-amber-950 hover:bg-amber-600 disabled:opacity-40"
        >
          {(metaSaving || googleSaving || geminiSaving || telegramSaving) ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("settings.saving")}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t("settings.saveAll")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}
