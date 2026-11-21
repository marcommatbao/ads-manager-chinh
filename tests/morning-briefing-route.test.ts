import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  auth: vi.fn(), rateLimit: vi.fn(), save: vi.fn(),
  init: vi.fn(), currency: vi.fn(), insights: vi.fn(), campaigns: vi.fn(),
  campaignInsights: vi.fn(), ai: vi.fn(), timeout: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/morning-briefing-history", () => ({ saveBriefing: mocks.save }));
vi.mock("@/lib/meta-client", () => ({
  initMetaClient: mocks.init, accountCurrency: "VND",
  metaClient: { getAccountInsights: mocks.insights, getCampaigns: mocks.campaigns, getCampaignInsights: mocks.campaignInsights },
}));
vi.mock("@/lib/gemini", () => ({ callGemini: mocks.ai, callWithTimeout: mocks.timeout }));
vi.mock("@/lib/morning-briefing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/morning-briefing")>();
  mocks.generate.mockImplementation(actual.generateMorningBriefing);
  return { ...actual, get MORNING_BRIEFING_ENABLED() { return mocks.enabled; }, generateMorningBriefing: mocks.generate };
});

// Import dynamically only after replacing env with synthetic values. No .env,
// credentials, real auth/provider modules, or real history store are loaded.
let route: typeof import("@/app/api/automation/morning-briefing/route");
let engine: typeof import("@/lib/morning-briefing");
let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  originalEnv = process.env;
  process.env = { NODE_ENV: "test", ENABLE_MORNING_BRIEFING: "0", GEMINI_API_KEY: "synthetic-test-key" };
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T08:00:00.000Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in route tests"); }));
  mocks.enabled = true; // Mock export only; never enables a deployed feature.
  mocks.auth.mockResolvedValue({ id: "test-user" });
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.save.mockResolvedValue(undefined);
  mocks.currency.mockReturnValue("VND");
  mocks.insights.mockResolvedValue([{ spend: "700", impressions: "100", clicks: "10" }]);
  mocks.campaigns.mockResolvedValue([]);
  mocks.campaignInsights.mockResolvedValue([]);
  mocks.ai.mockResolvedValue({ text: "Synthetic AI summary" });
  mocks.timeout.mockImplementation(async (generate: () => Promise<unknown>) => ({ result: await generate(), timedOut: false }));
  route = await import("@/app/api/automation/morning-briefing/route");
  engine = await import("@/lib/morning-briefing");
  const actual = await vi.importActual<typeof engine>("@/lib/morning-briefing");
  mocks.generate.mockImplementation(actual.generateMorningBriefing);
  const previous = actual.getCachedBriefing();
  if (previous) actual.setCachedBriefing({ ...previous, date: "1900-01-01" });
});
afterEach(() => {
  process.env = originalEnv;
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectNoGeneration() {
  for (const fn of [mocks.generate, mocks.init, mocks.insights, mocks.campaigns, mocks.campaignInsights, mocks.ai, mocks.timeout, mocks.save]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

describe("morning briefing real route + generation integration (mock boundaries)", () => {
  it.each(["GET", "POST"] as const)("%s rejects unauthorized before generation or throttle", async (method) => {
    mocks.auth.mockResolvedValue(null);
    const response = await route[method]();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Unauthorized" });
    expectNoGeneration();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"] as const)("%s disabled short-circuits all work", async (method) => {
    mocks.enabled = false;
    const response = await route[method]();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: false, disabled: true });
    expectNoGeneration();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"] as const)("%s generates, caches and passes the exact result to persistence", async (method) => {
    const response = await route[method]();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, cached: false, data: { generationMode: "gemini", aiSummary: "Synthetic AI summary" } });
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.insights).toHaveBeenCalledTimes(3);
    expect(mocks.ai).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(body.data);
    expect(engine.getCachedBriefing()).toEqual(body.data);
    if (method === "POST") expect(mocks.rateLimit).toHaveBeenCalledExactlyOnceWith("briefing-refresh:test-user", 3, 300000);
    else expect(mocks.rateLimit).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const cached = await route.GET();
    expect(await cached.json()).toEqual({ success: true, cached: true, data: body.data });
    expectNoGeneration();
  });

  it("POST bypasses an existing cache", async () => {
    await route.GET();
    vi.clearAllMocks();
    const response = await route.POST();
    expect((await response.json()).cached).toBe(false);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.ai).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("POST throttle blocks generation", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false });
    const response = await route.POST();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ success: false, error: "libcase.r.mb.3" });
    expectNoGeneration();
  });

  it.each(["GET", "POST"] as const)("%s sanitizes configuration errors", async (method) => {
    mocks.init.mockImplementation(() => { throw new Error("Meta not configured: synthetic-private-detail"); });
    const response = await route[method]();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Chưa kết nối Meta");
    expect(JSON.stringify(body)).not.toContain("synthetic-private-detail");
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(engine.getCachedBriefing()).toBeNull();
  });

  it.each(["GET", "POST"] as const)("%s handles non-Error failures with a generic message", async (method) => {
    mocks.init.mockImplementation(() => { throw "synthetic-private-detail"; });
    const response = await route[method]();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: "libcase.r.mb.2" });
  });

  it.each(["GET", "POST"] as const)("%s critical source failure blocks actual engine AI callback", async (method) => {
    mocks.insights.mockRejectedValueOnce(new Error("Synthetic source unavailable"));
    const response = await route[method]();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.insights).toHaveBeenCalledTimes(3);
    expect(body.data.generationMode).toBe("blocked");
    expect(body.data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "meta", status: "unavailable", critical: true }),
      expect.objectContaining({ id: "ai-summary", source: "fallback", status: "partial", critical: true }),
    ]));
    expect(mocks.timeout).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(body.data);
  });

  it.each(["period", "campaigns", "campaignInsights"] as const)("sanitizes Error and non-Error %s failures across response/cache/history", async (source) => {
    const secret = "synthetic-private-token";
    const detail = `provider diagnostic https://provider.invalid/?access_token=${secret}`;
    for (const failure of [new Error(detail), detail, { message: detail, token: secret }]) {
      vi.clearAllMocks();
      if (source === "period") mocks.insights.mockRejectedValueOnce(failure);
      if (source === "campaigns") mocks.campaigns.mockRejectedValueOnce(failure);
      if (source === "campaignInsights") {
        mocks.campaigns.mockResolvedValueOnce([{ id: "test-campaign", name: "Test" }]);
        mocks.campaignInsights.mockRejectedValueOnce(failure);
      }
      const response = await route.POST();
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.generationMode).toBe("blocked");
      expect(body.data.dataGaps).toHaveLength(1);
      expect(body.data.dataGaps[0]).toContain(": Không lấy được dữ liệu nguồn");
      expect(mocks.ai).not.toHaveBeenCalled();
      expect(mocks.timeout).not.toHaveBeenCalled();
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith(body.data);
      expect(engine.getCachedBriefing()).toEqual(body.data);
      const cached = await route.GET();
      for (const value of [body, await cached.json(), mocks.save.mock.calls, vi.mocked(console.error).mock.calls]) {
        const serialized = JSON.stringify(value);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain("provider diagnostic");
        expect(serialized).not.toContain("provider.invalid");
      }
    }
  });

  it.each(["GET", "POST"] as const)("%s falls back when the mocked AI fails", async (method) => {
    mocks.ai.mockRejectedValue(new Error("https://provider.invalid/?token=synthetic-ai-secret"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await route[method]();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.generationMode).toBe("fallback");
    expect(body.data.aiSummary).toContain("Bản rút gọn");
    expect(JSON.stringify([body, mocks.save.mock.calls, vi.mocked(console.warn).mock.calls])).not.toContain("synthetic-ai-secret");
    expect(mocks.ai).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(body.data);
  });

  it.each(["GET", "POST"] as const)("%s hides unrecognized internal Error messages", async (method) => {
    mocks.init.mockRejectedValue(new Error("Synthetic internal diagnostic"));
    const response = await route[method]();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: "libcase.r.mb.2" });
    expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Synthetic internal diagnostic");
  });

  it("history write failure preserves successful response and cache", async () => {
    mocks.save.mockRejectedValue(new Error("Synthetic disk failure"));
    const response = await route.GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(engine.getCachedBriefing()).toEqual(body.data);
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Synthetic disk failure");
  });
});
