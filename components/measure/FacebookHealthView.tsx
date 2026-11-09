// ============================================================
// Sức khoẻ đo lường — nội dung riêng Facebook (Đợt 4 · A)
// ============================================================
"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { vnd, num, pct } from "@/components/case/format";
import { Kpi } from "@/components/measure/Kpi";
import { Pill } from "@/components/measure/Pill";
import { Sparkline } from "@/components/measure/Sparkline";
import { SourceTable } from "@/components/measure/SourceTable";
import { MIN_LANDING_RATE, MIN_CLICKS_FOR_LANDING_RATE } from "@/lib/case/meta-thresholds";
import { rangeDays } from "@/lib/case/dates";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import type { MetaHealth, OptEventHealth, PixelEventSeries, PixelHealth } from "@/lib/measure/meta-health";

const TONE_SVG: Record<"red" | "amber" | "green" | "grey", string> = {
  red: "#dc2626",
  amber: "#d97706",
  green: "#16a34a",
  grey: "#94a3b8",
};

function seriesFor(pixels: PixelHealth[], pixelId: string | null, pixelEventName: string | null): PixelEventSeries | null {
  if (!pixelId || !pixelEventName) return null;
  const pixel = pixels.find((p) => p.pixelId === pixelId);
  return pixel?.events.find((e) => e.name === pixelEventName) ?? null;
}

/** Tóm tắt trạng thái học của các nhóm quảng cáo dùng chung một sự kiện tối ưu. */
function learningSummary(adsets: OptEventHealth["adsets"], t: TFunction): string {
  if (!adsets.length) return t("meta.measure.fh.ls.none");
  const label: Record<string, string> = { LEARNING: t("meta.measure.fh.ls.LEARNING"), SUCCESS: t("meta.measure.fh.ls.SUCCESS"), FAIL: t("meta.measure.fh.ls.FAIL") };
  const counts = new Map<string, number>();
  for (const a of adsets) {
    const key = a.learningStatus ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const allFail = adsets.every((a) => a.learningStatus === "FAIL");
  if (allFail) return t("meta.measure.fh.ls.allFail", { n: adsets.length });
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${k === "unknown" ? t("meta.measure.fh.ls.unknown") : label[k] ?? k}`);
  return t("meta.measure.fh.ls.summary", { n: adsets.length, parts: parts.join(", ") });
}

function optEventBadge(opt: OptEventHealth, t: TFunction): { tone: "red" | "amber" | "green" | "grey"; text: string } {
  if (opt.status === "dead") return { tone: "red", text: t("meta.measure.fh.opt.dead") };
  if (opt.status === "low") return { tone: "amber", text: t("meta.measure.fh.opt.low") };
  if (opt.status === "unknown") return { tone: "grey", text: t("meta.measure.fh.opt.unknown") };
  if (opt.allFail) return { tone: "amber", text: t("meta.measure.fh.opt.allFail") };
  if (opt.adsLow) return { tone: "amber", text: t("meta.measure.fh.opt.adsLow", { n: opt.adsAttributed, sets: opt.adsets.length }) };
  return { tone: "green", text: t("meta.measure.fh.opt.ok") };
}

export function FacebookHealthView({ data }: { data: MetaHealth }) {
  const intl = useIntlLocale();
  const t = useT();
  const allOptEvents = data.products.flatMap((p) => p.optEvents);
  const problemEvents = allOptEvents.filter((e) => e.status === "dead" || e.status === "low" || e.allFail || e.adsLow);
  const flaggedLanding = data.landing.filter((l) => l.flagged);
  const linksBadLabel = data.links.tableConfigured ? String(data.links.bad.length) : t("meta.measure.fh.kpi.linksNone");
  const days = rangeDays(data.range);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t("meta.measure.fh.kpi.problem")} value={num(problemEvents.length, undefined, intl)} sub={t("meta.measure.fh.kpi.problemSub", { n: allOptEvents.length })} bad={problemEvents.length > 0} />
        <Kpi label={t("meta.measure.fh.kpi.noValue")} value={num(data.noValue.length, undefined, intl)} sub={t("meta.measure.fh.kpi.noValueSub")} bad={data.noValue.length > 0} />
        <Kpi label={t("meta.measure.fh.kpi.landing")} value={num(flaggedLanding.length, undefined, intl)} sub={t("meta.measure.fh.kpi.landingSub", { pct: pct(MIN_LANDING_RATE, 0, intl), n: num(MIN_CLICKS_FOR_LANDING_RATE, undefined, intl) })} bad={flaggedLanding.length > 0} />
        <Kpi
          label={t("meta.measure.fh.kpi.links")}
          value={linksBadLabel}
          sub={<Link href="/do-luong/utm" className="text-blue-600 hover:underline">{t("meta.measure.fh.viewDetail")}</Link>}
          bad={data.links.tableConfigured && data.links.bad.length > 0}
        />
      </div>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.fh.byProduct.title")}</h2>
        <p className="mb-3 text-sm text-slate-500">{t("meta.measure.fh.byProduct.desc", { days })}</p>
        <div className="space-y-4">
          {data.products.map((product) => (
            <div key={product.group} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{product.label}</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">{t("meta.measure.fh.th.pixelEvent")}</th>
                    <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.trend", { days })}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.th.perWeek")}</th>
                    <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.metaCounts")}</th>
                    <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.learning")}</th>
                    <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {product.optEvents.map((opt, i) => {
                    const series = seriesFor(data.pixels, opt.pixelId, opt.pixelEventName);
                    const badge = optEventBadge(opt, t);
                    return (
                      <tr key={i} className="border-b border-slate-50 last:border-0 align-top">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{opt.label}</div>
                          {opt.custom && <Pill tone="grey" className="mt-1">{t("meta.measure.fh.custom")}</Pill>}
                        </td>
                        <td className="px-3 py-2.5"><Sparkline values={series?.perDay ?? []} stroke={TONE_SVG[badge.tone]} /></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{opt.perWeek === null ? t("meta.measure.fh.unknownVal") : num(opt.perWeek, { maximumFractionDigits: 1 }, intl)}</td>
                        <td className="px-3 py-2.5 text-slate-600">{t("meta.measure.fh.metaCountsCell")}<span className="tabular-nums font-medium">{num(opt.adsAttributed, undefined, intl)}</span></td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">{learningSummary(opt.adsets, t)}</td>
                        <td className="px-3 py-2.5">
                          <Pill tone={badge.tone}>{badge.text}</Pill>
                          {(opt.status === "dead" || opt.status === "low" || opt.allFail || opt.adsLow) && (
                            <div className="mt-1"><Link href="/xu-ly" className="text-xs text-blue-600 hover:underline">{t("meta.measure.fh.openCase")}</Link></div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.fh.pixel.title")}</h2>
        <p className="mb-3 text-sm text-slate-500">{t("meta.measure.fh.pixel.desc")}</p>
        <div className="space-y-4">
          {data.pixels.map((pixel) => (
            <div key={pixel.pixelId} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <span className="text-sm font-semibold text-slate-800">{t("meta.measure.fh.pixel.name", { id: pixel.pixelId })}</span>
                {!pixel.known && <Pill tone="red">{t("meta.measure.fh.pixel.unreadable", { error: pixel.error ?? t("meta.measure.fh.pixel.unknownError") })}</Pill>}
              </div>
              {pixel.known && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                        <th className="px-4 py-2 font-medium">{t("meta.measure.fh.pixel.event")}</th>
                        <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.trend", { days })}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.pixel.total", { days })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pixel.events.map((e) => (
                        <tr key={e.name} className="border-b border-slate-50 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-slate-800"><code className="text-xs">{e.name}</code></td>
                          <td className="px-3 py-2.5"><Sparkline values={e.perDay} /></td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(e.total, undefined, intl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pixel.variants.map((v) => (
                    <div key={v.key} className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                      {t("meta.measure.fh.pixel.variant", { n: v.names.length, list: v.names.map((n) => `${n.name} (${num(n.total, undefined, intl)})`).join(t("meta.measure.fh.pixel.variantAnd")) })}
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {data.noValue.length > 0 && (
        <section>
          <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.fh.nv.title")}</h2>
          <p className="mb-3 text-sm text-slate-500">{t("meta.measure.fh.nv.desc")}</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">{t("meta.measure.fh.nv.campaign")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.nv.spend")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.nv.purchases")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.nv.revenue")}</th>
                  <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.status")}</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.noValue.map((r) => (
                  <tr key={r.campaignId} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{vnd(r.cost, intl)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.purchases, undefined, intl)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{vnd(r.value, intl)}</td>
                    <td className="px-3 py-2.5"><Pill tone="red">{t("meta.measure.fh.nv.zero")}</Pill></td>
                    <td className="px-3 py-2.5"><Link href="/xu-ly" className="text-xs text-blue-600 hover:underline">{t("meta.measure.fh.openCase")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.fh.lp.title")}</h2>
        <p className="mb-3 text-sm text-slate-500">
          {t("meta.measure.fh.lp.desc", { pct: pct(MIN_LANDING_RATE, 0, intl), n: num(MIN_CLICKS_FOR_LANDING_RATE, undefined, intl) })}
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("meta.measure.fh.nv.campaign")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.lp.linkClicks")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.lp.views")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.lp.rate")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.nv.spend")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("meta.measure.fh.lp.buy")}</th>
                <th className="px-3 py-2 font-medium">{t("meta.measure.fh.th.status")}</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.landing.map((r) => (
                <tr key={r.campaignId} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.linkClicks, undefined, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.landingViews, undefined, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.rate, 1, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{vnd(r.cost, intl)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.purchases, undefined, intl)}</td>
                  <td className="px-3 py-2.5">
                    {r.flagged ? (
                      <Pill tone="red">{t("meta.measure.fh.lp.below", { pct: pct(MIN_LANDING_RATE, 0, intl) })}</Pill>
                    ) : r.rate !== null && r.linkClicks >= MIN_CLICKS_FOR_LANDING_RATE ? (
                      <Pill tone="green">{t("meta.measure.fh.lp.above", { pct: pct(MIN_LANDING_RATE, 0, intl) })}</Pill>
                    ) : (
                      <Pill tone="grey">{t("meta.measure.fh.lp.notEnough")}</Pill>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{r.flagged && <Link href="/xu-ly" className="text-xs text-blue-600 hover:underline">{t("meta.measure.fh.openCase")}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.fh.lk.title")}</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("meta.measure.fh.lk.read")} value={num(data.links.checked, undefined, intl)} />
            <Stat label={t("meta.measure.fh.lk.onPlatform")} value={num(data.links.onPlatform, undefined, intl)} sub={t("meta.measure.fh.lk.noCheck")} />
            <Stat label={t("meta.measure.fh.lk.post")} value={t("meta.measure.fh.lk.postRead", { n: num(data.links.postRead, undefined, intl) })} />
            <Stat label={t("meta.measure.fh.lk.noLink")} value={num(data.links.noLink, undefined, intl)} />
          </div>
          {data.links.postUnreadable > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t("meta.measure.fh.lk.unreadable", { n: num(data.links.postUnreadable, undefined, intl), pages: data.links.postNoToken.map((p) => p.pageId).join(", ") })}{" "}
                <Link href="/settings#ket-noi" className="font-medium underline underline-offset-2">{t("meta.measure.fh.lk.addToken")}</Link>
              </span>
            </div>
          )}
          {data.links.postTokenErrors.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t("meta.measure.fh.lk.tokenExpired", { pages: data.links.postTokenErrors.map((p) => p.name ?? p.pageId).join(", ") })}{" "}
                <Link href="/settings#ket-noi" className="font-medium underline underline-offset-2">{t("meta.measure.fh.lk.addToken")}</Link>
              </span>
            </div>
          )}
          <div className="mt-3">
            {data.links.tableConfigured ? (
              <span className="text-slate-600">{t("meta.measure.fh.lk.bad", { n: num(data.links.bad.length, undefined, intl) })}</span>
            ) : (
              <span className="text-slate-500">{t("meta.measure.fh.lk.noTable", { company: data.company })}</span>
            )}
            <Link href="/do-luong/utm" className="font-medium text-blue-600 hover:underline">{t("meta.measure.fh.viewDetail")}</Link>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.fh.odoo.title")}</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-sm text-slate-500">{t("meta.measure.fh.odoo.rate")}</span>
            <b className="tabular-nums text-lg">{data.odoo.totalOrders > 0 ? pct(data.odoo.taggedOrders / data.odoo.totalOrders, 1, intl) : "—"}</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-red-500" style={{ width: `${data.odoo.totalOrders > 0 ? Math.round((data.odoo.taggedOrders / data.odoo.totalOrders) * 100) : 0}%` }} />
          </div>
          {data.odoo.byStandardTag.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">{t("meta.measure.fh.odoo.product")}</th>
                  <th className="py-2 font-medium">utm_campaign</th>
                  <th className="py-2 text-right font-medium">{t("meta.measure.fh.odoo.orders")}</th>
                  <th className="py-2 text-right font-medium">{t("meta.measure.fh.odoo.revenue")}</th>
                </tr>
              </thead>
              <tbody>
                {data.odoo.byStandardTag.map((r) => (
                  <tr key={r.label} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 font-medium text-slate-800">{r.label}</td>
                    <td className="py-2"><code className="text-xs text-slate-600">{r.utmCampaign}</code></td>
                    <td className="py-2 text-right tabular-nums">{num(r.orders, undefined, intl)}</td>
                    <td className="py-2 text-right tabular-nums">{vnd(r.revenue, intl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{data.odoo.note}</span>
          </div>
        </div>
      </section>

      <SourceTable sources={data.sources} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-base font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
