import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { SourceEvidence } from "@/components/inbox/SourceEvidence"
import { fromGoogleHealth } from "@/lib/inbox/evidence"
import { localizeItem } from "@/lib/inbox/localize"
import { makeT } from "@/lib/i18n/translate"
it.each(["vi", "en"] as const)("actual Inbox evidence panel shows read-only evidence to viewer (%s)", locale => {
  const item = fromGoogleHealth(["MBC"], null)[0]
  const localized = localizeItem(item, makeT(locale))
  const html = renderToStaticMarkup(<SourceEvidence evidence={item.evidence!} href={item.href} hrefLabel={localized.hrefLabel} t={makeT(locale)} />)
  expect(html).toContain('href="/settings/health"')
  expect(html).toContain(makeT(locale)("overview.inboxQuality.unknownTime"))
  expect(html).toContain(makeT(locale)("overview.inboxQuality.global"))
  expect(html).toContain(makeT(locale)("overview.inboxQuality.nextConnection"))
  expect(html).not.toMatch(/<button|<time|₫|PRIVATE|auto.?apply/)
})
it("renders actual observed time rather than render time", () => {
  const checkedAt = "2026-11-26T01:00:00.000Z"
  const item = fromGoogleHealth(["MBC"], null)[0]
  const html = renderToStaticMarkup(<SourceEvidence evidence={{ ...item.evidence!, checkedAt }} href={item.href} hrefLabel={item.hrefLabel} t={makeT("en")} />)
  expect(html).toContain(`dateTime="${checkedAt}"`)
  expect(html).toContain("08:00")
  expect(html).toContain("UTC+07:00")
})
