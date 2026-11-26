import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGtm, parseGtm } from "@/lib/measure/gtm";
const state = vi.hoisted(() => ({ json: null as string | null }));
vi.mock("@/lib/connections/extra-connections", () => ({ gtmServiceAccountSource: () => ({ json: state.json }) }));
vi.mock("crypto", () => ({ default: { createSign: () => ({ update: () => ({ sign: () => "TEST_ONLY_SIGNATURE" }) }) } }));
import { liveToContainer, readLive } from "@/lib/measure/gtm-api";

describe("GTM read boundary provenance (no provider calls)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("stamps after body read completes, not request start or pure parsing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T01:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => {
      vi.setSystemTime(new Date("2026-11-26T01:01:00Z"));
      return '"version":"123"';
    } })));
    expect(parseGtm("GTM-TEST123", "").readAt).toBeUndefined();
    const result = await fetchGtm("GTM-TEST123");
    expect(result).toMatchObject({ readAt: "2026-11-26T01:01:00.000Z", source: "public", version: "123" });
    vi.setSystemTime(new Date("2026-11-26T02:00:00Z"));
    expect(result.readAt).toBe("2026-11-26T01:01:00.000Z");
  });
  it("preserves API read time through conversion, including legacy unknown", () => {
    const live = { publicId: "GTM-TEST123", path: "PRIVATE", versionId: "123", versionName: "PRIVATE", tags: [], triggers: [] };
    expect(liveToContainer(live).readAt).toBeUndefined();
    expect(liveToContainer({ ...live, readAt: "2026-11-26T01:00:00.000Z" }).readAt).toBe("2026-11-26T01:00:00.000Z");
  });
  it("captures API completion time after reading the live response body", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-26T01:00:00Z"));
    state.json = JSON.stringify({ client_email: "test@example.invalid", private_key: "TEST ONLY PRIVATE KEY" });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://oauth2.googleapis.com/token") return { ok: true, json: async () => ({ access_token: "TEST_ONLY" }) };
      const body = url.endsWith("/accounts") ? { account: [{ accountId: "1" }] }
        : url.endsWith("/containers") ? { container: [{ publicId: "GTM-API1234", containerId: "2" }] }
        : { containerVersionId: "123", tag: [], trigger: [] };
      return { ok: true, text: async () => {
        if (url.endsWith("/versions:live")) vi.setSystemTime(new Date("2026-11-26T01:02:00Z"));
        return JSON.stringify(body);
      } };
    });
    vi.stubGlobal("fetch", fetchMock);
    const live = await readLive("GTM-API1234");
    expect(live.readAt).toBe("2026-11-26T01:02:00.000Z");
    vi.setSystemTime(new Date("2026-11-26T02:00:00Z"));
    expect(liveToContainer(live).readAt).toBe(live.readAt);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    state.json = null;
  });
  it("does not create provenance for failed reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(fetchGtm("GTM-TEST123")).rejects.toThrow("403");
  });
});
