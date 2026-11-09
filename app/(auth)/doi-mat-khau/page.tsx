"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Eye, EyeOff, Zap } from "lucide-react";
import { brandText } from "@/lib/companies/brand-text";
import { useT } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/LanguageSwitch";

interface SessionResponse {
  authenticated?: boolean;
  user?: { email?: string; mustChangePassword?: boolean };
}

interface ChangePasswordResponse {
  success?: boolean;
  error?: string;
}

const MIN_LEN = 12;
const MAX_LEN = 200;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-11 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors";
const labelClass = "block text-sm font-medium text-slate-300 mb-1.5";

export default function ChangePasswordPage() {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ next?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "same-origin" });
        const json = (await res.json()) as SessionResponse;
        if (cancelled) return;
        if (!json.authenticated || !json.user) {
          window.location.href = "/login";
          return;
        }
        setEmail(json.user.email ?? "");
        setMustChange(json.user.mustChangePassword === true);
        setReady(true);
      } catch {
        if (!cancelled) setError(t("auth.serverError"));
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const errs: { next?: string; confirm?: string } = {};
    if (next.length < MIN_LEN) errs.next = t("auth.cp.errMin", { min: MIN_LEN });
    else if (next.length > MAX_LEN) errs.next = t("auth.cp.errMax", { max: MAX_LEN });
    else if (next === current) errs.next = t("auth.cp.errSame");
    if (next !== confirm) errs.confirm = t("auth.cp.errMismatch");
    setFieldErrors(errs);
    if (errs.next || errs.confirm) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      let json: ChangePasswordResponse = {};
      try {
        json = (await res.json()) as ChangePasswordResponse;
      } catch {
        /* body không phải JSON */
      }
      if (!res.ok || !json.success) {
        setError(json.error || t("auth.cp.failed"));
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch {
      setError(t("auth.serverError"));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitch />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 shadow-lg shadow-amber-500/30">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">AdsCommand</h1>
          <p className="text-sm text-slate-400 mt-1">{brandText().tagline}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">{t("auth.cp.title")}</h2>
            {ready && !mustChange && (
              <Link href="/" className="text-xs text-slate-400 hover:text-slate-300 transition-colors">
                {t("auth.cp.back")}
              </Link>
            )}
          </div>

          {mustChange && (
            <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-300">
              {t("auth.cp.mustChange")}
            </div>
          )}

          {email && (
            <p className="mb-4 text-sm text-slate-400">
              {t("auth.cp.account")} <span className="text-slate-200 break-all">{email}</span>
            </p>
          )}

          {error && (
            <div role="alert" className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
              <span className="shrink-0">⚠️</span>
              {error}
            </div>
          )}

          {success && (
            <div role="status" className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400">
              {t("auth.cp.success")}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="cur" className={labelClass}>{t("auth.cp.current")}</label>
            <div className="relative">
              <input
                id="cur"
                type={show ? "text" : "password"}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? t("auth.cp.hide") : t("auth.cp.show")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="new" className={labelClass}>{t("auth.cp.new")}</label>
            <input
              id="new"
              type={show ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              required
              aria-invalid={!!fieldErrors.next}
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              {t("auth.cp.hint")}
            </p>
            {fieldErrors.next && <p className="mt-1 text-xs text-red-400">{fieldErrors.next}</p>}
          </div>

          <div className="mb-6">
            <label htmlFor="conf" className={labelClass}>{t("auth.cp.confirm")}</label>
            <input
              id="conf"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              aria-invalid={!!fieldErrors.confirm}
              className={inputClass}
            />
            {fieldErrors.confirm && <p className="mt-1 text-xs text-red-400">{fieldErrors.confirm}</p>}
          </div>

          <button
            type="submit"
            disabled={loading || success || !ready || !current || !next || !confirm}
            className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg shadow-amber-500/25 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("auth.cp.submitting")}
              </>
            ) : (
              t("auth.cp.submit")
            )}
          </button>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs text-slate-400 hover:text-slate-300 underline-offset-2 hover:underline transition-colors"
            >
              {t("auth.cp.logout")}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-slate-500 mt-6">
          {brandText().footer}
        </p>
      </div>
    </div>
  );
}
