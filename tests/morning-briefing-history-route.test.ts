import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUser, getBriefingHistory } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getBriefingHistory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/morning-briefing-history", () => ({ getBriefingHistory }));

import { GET } from "@/app/api/automation/morning-briefing/history/route";

function request(limit?: string): NextRequest {
  const url = new URL("http://localhost/api/automation/morning-briefing/history");
  if (limit !== undefined) url.searchParams.set("limit", limit);
  return new NextRequest(url);
}

describe("GET /api/automation/morning-briefing/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBriefingHistory.mockReturnValue([]);
  });

  it("requires authentication", async () => {
    getCurrentUser.mockResolvedValue(null);
    const response = await GET(request("10"));
    expect(response.status).toBe(401);
    expect(getBriefingHistory).not.toHaveBeenCalled();
  });

  it("returns authenticated history with a bounded requested limit", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    getBriefingHistory.mockReturnValue([{ generatedAt: "2026-11-18T00:00:00.000Z" }]);

    const response = await GET(request("999"));
    expect(response.status).toBe(200);
    expect(getBriefingHistory).toHaveBeenCalledWith(999);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: [{ generatedAt: "2026-11-18T00:00:00.000Z" }] });
  });

  it("uses the default limit for invalid values", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    await GET(request("not-a-number"));
    expect(getBriefingHistory).toHaveBeenCalledWith(30);
  });
});
