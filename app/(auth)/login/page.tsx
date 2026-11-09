"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Eye, EyeOff, Zap } from "lucide-react";
import { safeCallbackPath } from "@/lib/safe-redirect";
import { brandText } from "@/lib/companies/brand-text";
import { useT } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/LanguageSwitch";

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Chỉ quay lại đường dẫn cùng trang — xem lib/safe-redirect.ts (chặn "/\\evil", "/<TAB>/evil", "//evil").
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json();

      if (!json.success) {
        setError(json.error || t("auth.login.failed"));
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError(t("auth.serverError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitch />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo Card */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 shadow-lg shadow-amber-500/30">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            AdsCommand
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {brandText().tagline}
          </p>
        </div>

        {/* Login Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl"
        >
          <h2 className="text-lg font-semibold text-white mb-6">{t("auth.login.title")}</h2>

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
              <span className="shrink-0">⚠️</span>
              {error}
            </div>
          )}

          {/* Email */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@matbao.com"
              required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
            />
          </div>

          {/* Password */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              {t("auth.login.password")}
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-11 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg shadow-amber-500/25 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("auth.login.submitting")}
              </>
            ) : (
              t("auth.login.submit")
            )}
          </button>

        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          {brandText().footer}
        </p>
        {/* 15/10/2026: Google OAuth verification — trang chủ + chính sách xem được từ trang đăng nhập. */}
        <p className="text-center text-xs text-slate-500 mt-2 space-x-3">
          <a href="/about" className="hover:text-slate-300 underline-offset-2 hover:underline">{t("auth.about")}</a>
          <a href="/privacy" className="hover:text-slate-300 underline-offset-2 hover:underline">{t("auth.privacy")}</a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
