import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectConnectorEvidence } from "@/lib/connectors/evidence";
import type { ConnectorHealthRecord } from "@/lib/connectors/types";
import { ConnectorRow } from "@/components/settings/ConnectorHealth";
import { I18nProvider } from "@/lib/i18n/client";

const now = Date.parse("2026-11-26T01:00:00.000Z");
const iso = new Date(now).toISOString();
const fixture = (patch: Partial<ConnectorHealthRecord> = {}): ConnectorHealthRecord => ({ id: "google_ads", status: "healthy", configComplete: true, partialConfig: false, lastChecked: iso, lastSuccess: iso, lastFailure: null, failureCategory: null, failureReason: null, maskedConfig: { token: "PRIVATE", url: "https://PRIVATE" }, ...patch });
describe("public connector evidence", () => {
  it.each([
    [null, "unknown", "never", "unavailable"],
    [fixture({configComplete:false}), "missing", "recent", "recheck"],
    [fixture({configComplete:false, partialConfig:true}), "partial", "recent", "recheck"],
    [fixture({lastChecked:null}), "present", "never", "unavailable"],
    [fixture({status:"auth_error"}), "present", "recent", "failed"],
    [fixture({status:"service_error"}), "present", "recent", "failed"],
    [fixture({lastChecked:new Date(now-3600000).toISOString()}), "present", "stale", "recheck"],
    [fixture({lastChecked:new Date(now+1).toISOString()}), "present", "future", "recheck"],
    [fixture({lastChecked:"2026-02-30T01:00:00.000Z"}), "present", "invalid", "recheck"],
    [fixture({lastChecked:"bad"}), "present", "invalid", "recheck"],
    [fixture({lastSuccess:null}), "present", "recent", "recheck"],
    [fixture({lastSuccess:"bad"}), "present", "recent", "recheck"],
    [fixture({lastSuccess:new Date(now+1).toISOString()}), "present", "recent", "recheck"],
    [fixture({lastSuccess:new Date(now-3600000).toISOString()}), "present", "recent", "recheck"],
    [fixture({status:"warning"}), "present", "recent", "recheck"],
    [fixture({status:"disabled"}), "present", "recent", "disabled"],
    [fixture(), "present", "recent", "listing"],
    [fixture({id:"slack"}), "present", "recent", "recorded"],
  ] as const)("projects matrix %#", (record, configuration, freshness, outcome) => {
    expect(projectConnectorEvidence(record, now)).toMatchObject({configuration,freshness,outcome});
  });
  it("allowlists output and never exposes provider messages, config or internal metadata", () => {
    const record = {...fixture(), googleEvidenceBinding:"PRIVATE", note:"PRIVATE", failureReason:"PRIVATE"};
    expect(Object.keys(projectConnectorEvidence(record,now)).sort()).toEqual(["checkedAt","configuration","freshness","outcome","scope"]);
    expect(JSON.stringify(projectConnectorEvidence(record,now))).not.toMatch(/PRIVATE|https|maskedConfig|Binding/);
  });
  it("downgrades stale healthy card badge to warning", () => {
    const html = renderToStaticMarkup(<I18nProvider locale="en"><ConnectorRow meta={{ id: "google_ads", displayName: "Google", supportsLiveTest: true, color: "", icon: "" }} record={fixture({ lastChecked: new Date(now - 7200000).toISOString() })} now={now} canTest={false} onTest={() => { throw Error("No provider"); }} testing={false}/></I18nProvider>);
    expect(html).toContain("Recheck required");
    expect(html).toContain("border-amber-200");
    expect(html).not.toContain("border-emerald-200");
  });
  it.each(["vi","en"] as const)("renders the real existing card in %s with legacy fallback and permissions", locale => {
    for (const record of [fixture(), fixture({status:"warning"}), fixture({id:"slack"}), null]) {
      const html = renderToStaticMarkup(<I18nProvider locale={locale}><ConnectorRow meta={{id:"google_ads",displayName:"Google",supportsLiveTest:true,color:"",icon:""}} record={record} now={now} canTest={false} onTest={() => {throw Error("No provider calls on render");}} testing={false}/></I18nProvider>);
      expect(html).toContain('<dl');
      expect(html).toContain('data-slot="card"');
      expect(html).not.toMatch(/settings\.health\.|PRIVATE|https:\/\/PRIVATE/);
      expect(html).toContain("attribution");
      if (record?.status === "warning") {
        expect(html).toContain(locale === "vi" ? "Cần kiểm tra lại" : "Recheck required");
        expect(html).not.toContain(locale === "vi" ? "Đã xác minh việc liệt kê" : "Account listing verified");
      }
      expect(html).not.toContain(locale === "vi" ? '>Kiểm tra<' : '>Test<');
      if (record) expect(html).toContain('aria-expanded="false"');
    }
  });
});
