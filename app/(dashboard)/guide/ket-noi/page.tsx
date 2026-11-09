// ============================================================
// /guide/ket-noi — Hướng dẫn kết nối (Meta, Trang Facebook, GTM, Google Ads, Teams)
// ============================================================
// Render tĩnh từ CONNECTION_GUIDES (lib/guides/connections.ts) — module THUẦN,
// không đọc API/khoá gì cả nên đây là Server Component thường (không "use
// client"): anchor #id nhảy bằng trình duyệt, không cần JS.

import Link from "next/link";
import {
  BookOpen, ArrowRight, ExternalLink, AlertTriangle,
  CheckCircle2, ShieldCheck, Clock, User,
} from "lucide-react";
import { CONNECTION_GUIDES } from "@/lib/guides/connections";
import { getT } from "@/lib/i18n/server";

export default async function GuideKetNoiPage() {
  const t = await getT();
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* ── Header ── */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-6 sm:p-8 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("creative.guideConnect.title")}</h1>
            <p className="text-sm text-white/60">{t("creative.guideConnect.subtitle")}</p>
          </div>
        </div>
        <p className="text-sm text-white/70 leading-relaxed max-w-2xl">
          {t("creative.guideConnect.intro1")}<b>{t("creative.guideConnect.introSettings")}</b>{t("creative.guideConnect.intro2")}<b>{t("creative.guideConnect.introCheck")}</b>{t("creative.guideConnect.intro3")}
        </p>
      </div>

      {/* ── Table of contents ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{t("creative.guideConnect.toc")}</p>
        <div className="flex flex-wrap gap-2">
          {CONNECTION_GUIDES.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-amber-300 hover:text-amber-700 transition-colors"
            >
              {g.title}
            </a>
          ))}
        </div>
      </div>

      {/* ── Guides ── */}
      <div className="space-y-10">
        {CONNECTION_GUIDES.map((guide) => {
          let stepNo = 0;
          return (
            <section key={guide.id} id={guide.id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Guide header */}
              <div className="border-b border-slate-100 p-5 sm:p-6 space-y-3">
                <h2 className="text-lg font-bold text-slate-900">{guide.title}</h2>
                <p className="text-sm text-slate-600 leading-relaxed">{guide.purpose}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><User size={13} className="text-slate-400" aria-hidden="true" /> {t("creative.guideConnect.who", { who: guide.who })}</span>
                  <span className="flex items-center gap-1.5"><Clock size={13} className="text-slate-400" aria-hidden="true" /> {t("creative.guideConnect.minutes", { n: guide.minutes })}</span>
                </div>
                <Link
                  href={guide.pasteInto.href}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
                >
                  {t("creative.guideConnect.pasteInto", { label: guide.pasteInto.label })} <ArrowRight size={12} aria-hidden="true" />
                </Link>
              </div>

              {/* Sections + steps (đánh số liên tục trong cả guide) */}
              <div className="p-5 sm:p-6 space-y-6">
                {guide.sections.map((sec, si) => (
                  <div key={si} className="space-y-3">
                    <h3 className="text-sm font-bold text-slate-700">{sec.title}</h3>
                    <ol className="space-y-3">
                      {sec.steps.map((step, i) => {
                        stepNo += 1;
                        return (
                          <li key={i} className="flex gap-3">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white mt-0.5">
                              {stepNo}
                            </span>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <p className="text-sm text-slate-700 leading-relaxed">{step.text}</p>
                              {step.detail && (
                                <p className="whitespace-pre-line text-xs text-slate-500 leading-relaxed">{step.detail}</p>
                              )}
                              {step.warn && (
                                <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>{step.warn}</span>
                                </div>
                              )}
                              {step.link && (
                                <a
                                  href={step.link.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                                >
                                  {step.link.label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>

              {/* Verify */}
              <div className="border-t border-slate-100 p-5 sm:p-6 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t("creative.guideConnect.verify")}</p>
                {guide.verify.map((v, i) => (
                  <div key={i} className="flex gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-700">
                    <CheckCircle2 size={13} className="shrink-0 mt-0.5 text-emerald-500" aria-hidden="true" />
                    {v}
                  </div>
                ))}
              </div>

              {/* Errors */}
              <div className="border-t border-slate-100 p-5 sm:p-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{t("creative.guideConnect.errors")}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {guide.errors.map((e, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-800">{e.symptom}</p>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">{e.fix}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Security */}
              <div className="border-t border-slate-100 p-5 sm:p-6 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{t("creative.guideConnect.security")}</p>
                {guide.security.map((s, i) => (
                  <div key={i} className="flex gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                    <ShieldCheck size={13} className="shrink-0 mt-0.5 text-blue-500" aria-hidden="true" />
                    {s}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
