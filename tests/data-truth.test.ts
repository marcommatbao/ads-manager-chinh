import { describe, expect, it } from "vitest";
import { estimated, isUsable, real, stale, unavailable } from "@/lib/data-truth";

describe("data truth contract", () => {
  const range = { from: "2026-11-01", to: "2026-11-18" };

  it("keeps a real zero distinct from unavailable data", () => {
    const zero = real(0, "Odoo", range, "2026-11-18T00:00:00.000Z");
    const missing = unavailable<number>("Odoo", "HTTP 403", range);
    expect(zero.value).toBe(0);
    expect(zero.status).toBe("real");
    expect(isUsable(zero)).toBe(true);
    expect(missing.value).toBeNull();
    expect(missing.status).toBe("unavailable");
    expect(isUsable(missing)).toBe(false);
  });

  it("preserves stale and estimated provenance", () => {
    expect(stale(12, "Meta snapshot", "2026-11-17T00:00:00.000Z", range).status).toBe("stale");
    expect(estimated(12, "Forecast", range, "low sample").status).toBe("estimated");
  });
});
