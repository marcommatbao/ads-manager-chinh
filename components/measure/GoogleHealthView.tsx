// ============================================================
// Sức khoẻ đo lường — nội dung riêng Google Ads (Đợt 4 · A)
// ============================================================
"use client";

import Link from "next/link";
import { useT, useIntlLocale } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { vnd, num, pct } from "@/components/case/format";
import { Pill, type PillTone } from "@/components/measure/Pill";
import { Sparkline } from "@/components/measure/Sparkline";
import { SourceTable } from "@/components/measure/SourceTable";
import { rangeDays } from "@/lib/case/dates";
import type { TFunction } from "@/lib/i18n/translate";
import type { ConversionActionHealth, ConversionFlag, GoogleHealth } from "@/lib/measure/google-health";

const bold = (s: string) => s.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

const FLAG_COPY: Record<ConversionFlag, { tone: PillTone; text: MessageKey }> = {
  primary_purchase_silent: { tone: "red", text: "meta.measure.gh.flag.primary_purchase_silent" },
  fixed_default_value: { tone: "amber", text: "meta.measure.gh.flag.fixed_default_value" },
  purchase_not_primary: { tone: "red", text: "meta.measure.gh.flag.purchase_not_primary" },
};

const CATEGORY_LABEL: Record<string, MessageKey> = {
  PURCHASE: "meta.measure.gh.cat.PURCHASE",
  LEAD: "meta.measure.gh.cat.LEAD",
  SIGNUP: "meta.measure.gh.cat.SIGNUP",
  SUBMIT_LEAD_FORM: "meta.measure.gh.cat.SUBMIT_LEAD_FORM",
  PAGE_VIEW: "meta.measure.gh.cat.PAGE_VIEW",
  PHONE_CALL_LEAD: "meta.measure.gh.cat.PHONE_CALL_LEAD",
  ADD_TO_CART: "meta.measure.gh.cat.ADD_TO_CART",
};

function valueText(v: ConversionActionHealth["value"], t: TFunction, loc: string): string {
  if (v.kind === "real") return t("meta.measure.gh.value.real");
  if (v.kind === "fixed") return t("meta.measure.gh.value.fixed", { value: vnd(v.defaultValue, loc) });
  return t("meta.measure.gh.value.none");
}

const UTM_STATUS: Record<string, { tone: PillTone; text: MessageKey }> = {
  matched: { tone: "green", text: "meta.measure.gh.utm.matched" },
  unmatched: { tone: "amber", text: "meta.measure.gh.utm.unmatched" },
  no_utm: { tone: "red", text: "meta.measure.gh.utm.no_utm" },
  unreadable: { tone: "grey", text: "meta.measure.gh.utm.unreadable" },
};

export function GoogleHealthView({ data }: { data: GoogleHealth }) {
  const intl = useIntlLocale();
  const t = useT();
  const tagPct = data.utm.distinctTags > 0 ? data.utm.matchedTags / data.utm.distinctTags : null;
  const days = rangeDays(data.range);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.gh.conv.title")}</h2>
        <p className="mb-3 text-sm text-slate-500">{bold(t("meta.measure.gh.conv.hint"))}</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">{t("meta.measure.gh.conv.action")}</th>
                <th className="px-3 py-2 font-medium">{t("meta.measure.gh.conv.group")}</th>
                <th className="px-3 py-2 font-medium">{t("meta.measure.gh.conv.primarySecondary")}</th>
                <th className="px-3 py-2 font-medium">{t("meta.measure.gh.conv.value")}</th>
                <th className="px-3 py-2 font-medium">{t("meta.measure.gh.conv.trend", { days })}</th>
                <th className="px-3 py-2 text-right font-medium">{t("meta.measure.gh.conv.per7")}</th>
                <th className="px-3 py-2 font-medium">{t("meta.measure.gh.conv.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.conversions.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0 align-top">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                  <td className="px-3 py-2.5 text-slate-600">{CATEGORY_LABEL[c.category] ? t(CATEGORY_LABEL[c.category]) : c.category}</td>
                  <td className="px-3 py-2.5">
                    <span className={c.primary ? "font-semibold text-slate-800" : "text-slate-500"}>{c.primary ? t("meta.measure.gh.conv.primary") : t("meta.measure.gh.conv.secondary")}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{valueText(c.value, t, intl)}</td>
                  <td className="px-3 py-2.5"><Sparkline values={c.perDay} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(c.last7, { maximumFractionDigits: 1 }, intl)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-[260px] flex-col gap-1">
                      {c.flags.length === 0 && c.category === "PURCHASE" && <Pill tone="green">{t("meta.measure.gh.conv.ok")}</Pill>}
                      {c.flags.map((f) => {
                        const copy = FLAG_COPY[f];
                        return <Pill key={f} tone={copy.tone}>{t(copy.text)}</Pill>;
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.gh.tag.title")}</h2>
        <p className="mb-3 text-sm text-slate-500">{t("meta.measure.gh.tag.hint").split(/<code>(.*?)<\/code>/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</p>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-800">{data.account.name || data.company}</span>
            {data.account.autoTagging === true && <Pill tone="green">{t("meta.measure.gh.tag.on")}</Pill>}
            {data.account.autoTagging === false && <Pill tone="red">{t("meta.measure.gh.tag.off")}</Pill>}
            {data.account.autoTagging === null && <Pill tone="grey">{t("meta.measure.gh.tag.unknown")}</Pill>}
          </div>
          {data.account.autoTagging === false && (
            <p className="mt-2 text-xs text-red-600">{t("meta.measure.gh.tag.warn")}</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.gh.utmsec.title")}</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-sm text-slate-500">{t("meta.measure.gh.utmsec.matched", { matched: num(data.utm.matchedTags, undefined, intl), total: num(data.utm.distinctTags, undefined, intl) })}</span>
            <b className="tabular-nums text-lg">{tagPct !== null ? pct(tagPct, 0, intl) : "—"}</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-red-500" style={{ width: `${tagPct !== null ? Math.round(tagPct * 100) : 0}%` }} />
          </div>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            {t("meta.measure.gh.utmsec.warn")}
          </div>
          {!data.utm.tableConfigured && (
            <div className="mt-2 text-xs text-slate-400">{t("meta.measure.gh.utmsec.noTable")}</div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">{t("meta.measure.gh.utmsec.campaign")}</th>
                  <th className="py-2 font-medium">{t("meta.measure.gh.utmsec.utmInUrl")}</th>
                  <th className="py-2 text-right font-medium">{t("meta.measure.gh.utmsec.odooOrders")}</th>
                  <th className="py-2 font-medium">{t("meta.measure.gh.utmsec.status")}</th>
                  <th className="py-2 font-medium">{t("meta.measure.gh.utmsec.badLinks")}</th>
                </tr>
              </thead>
              <tbody>
                {data.utm.campaigns.map((c) => {
                  const st = UTM_STATUS[c.status];
                  return (
                    <tr key={c.campaignId} className="border-b border-slate-50 last:border-0 align-top">
                      <td className="py-2">
                        <div className="font-medium text-slate-800">{c.name}</div>
                        <div className="text-xs text-slate-400">{c.channel} · {vnd(c.cost, intl)}</div>
                      </td>
                      <td className="py-2">{c.tags.length ? c.tags.map((tag) => <code key={tag} className="mr-1 text-xs text-slate-600">{tag}</code>) : <span className="text-slate-400">—</span>}</td>
                      <td className="py-2 text-right tabular-nums">{num(c.odooOrders, undefined, intl)}</td>
                      <td className="py-2"><Pill tone={st.tone}>{t(st.text)}</Pill></td>
                      <td className="py-2">
                        {c.linkIssues.length === 0 ? (
                          <span className="text-emerald-600">✓</span>
                        ) : (
                          <Link href="/do-luong/utm" className="font-medium text-amber-600 hover:underline">⚠ {c.linkIssues.length}</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-bold text-slate-900">{t("meta.measure.gh.dead.title")}</h2>
        {data.deadPages.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <Pill tone="green">{t("meta.measure.gh.dead.none")}</Pill>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">{t("meta.measure.gh.dead.page")}</th>
                  <th className="px-3 py-2 font-medium">{t("meta.measure.gh.dead.status")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("meta.measure.gh.dead.spend", { days })}</th>
                </tr>
              </thead>
              <tbody>
                {data.deadPages.map((d) => (
                  <tr key={d.url} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5"><code className="text-xs">{d.url}</code></td>
                    <td className="px-3 py-2.5"><Pill tone="red">✕ {d.reason}</Pill></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{vnd(d.spend, intl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SourceTable sources={data.sources} />
    </div>
  );
}
