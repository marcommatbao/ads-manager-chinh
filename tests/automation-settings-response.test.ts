import { describe, expect, it } from "vitest";
import { makeT } from "@/lib/i18n/translate";
import { readAutomationJson } from "@/lib/automation/settings-response";
const t = makeT("vi");
describe("legacy automation response handling", () => {
 it("returns valid settings", async () => { expect(await readAutomationJson(new Response(JSON.stringify({ enabledRules: [] })), t, "settings")).toEqual({ enabledRules: [] }); });
 it("reports empty 500 as localized endpoint error", async () => { await expect(readAutomationJson(new Response(null, { status: 500 }), t, "pending")).rejects.toThrow("Không tải được danh sách chờ (HTTP 500)"); });
 it("does not expose HTML or raw parser errors", async () => { await expect(readAutomationJson(new Response("<html>private proxy error</html>", { status: 502 }), t, "pending")).rejects.toThrow("HTTP 502"); });
 it("rejects malformed successful response", async () => { await expect(readAutomationJson(new Response(""), t, "settings")).rejects.toThrow("HTTP 200"); });
});
