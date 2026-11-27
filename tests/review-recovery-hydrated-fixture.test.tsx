import React from "react"
import fs from "node:fs"
import path from "node:path"
import { renderToString } from "react-dom/server"
import { expect, it } from "vitest"
import { Fixture } from "./fixtures/review-recovery-hydrated"
it("prepares real SSR review/recovery vi/en for hydration without services", () => {
  const root = path.resolve("tests/fixtures/local/review-recovery")
  fs.mkdirSync(root, { recursive: true })
  for (const locale of ["vi", "en"] as const) for (const mode of ["review", "viewer", "conflict", "error503", "recovery200", "recovery409", "recovery503"]) {
    const options = { locale, mode }
    const html = renderToString(<Fixture {...options} />)
    expect(html).not.toContain("creative.briefReview")
    expect(html).not.toContain("creative.checkpoint")
    fs.writeFileSync(path.join(root, `${locale}-${mode}.html`), `<!doctype html><meta charset="utf-8"><style>[data-slot=dialog-content]{position:fixed;inset:10%;background:white;z-index:10}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#eee}button,input{margin:8px}</style><div id="root">${html}</div><script>window.options=${JSON.stringify(options)}</script><script type="module" src="/fixture.js"></script>`)
  }
})
