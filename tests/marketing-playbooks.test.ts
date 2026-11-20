import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("marketing capability playbooks", () => {
  it("contain source-bounded guardrails and no provider mutation imports", () => {
    const dir = path.join(process.cwd(), "docs", "marketing-playbooks");
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".md") && !["THIRD-PARTY-NOTICE.md", "README.md"].includes(name));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      if (file !== "BUSINESS-POLICY-TEMPLATE.md") expect(text).toMatch(/Version:/);
      expect(text).toMatch(/Decision role|Guardrail|Rules/);
      expect(text).not.toMatch(/META_ACCESS_TOKEN|GOOGLE_ADS_REFRESH_TOKEN|ODOO_API_KEY|glpat_|AIza/);
    }
  });

  it("keeps the business policy template fail-closed by default", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "docs/marketing-playbooks/BUSINESS-POLICY-TEMPLATE.md"), "utf8");
    expect(text).toContain("globalEnabled: false");
    expect(text).toContain("applyEnabled: false");
    expect(text).toContain("requiredForBudgetChange: true");
    expect(text).toContain("protectedCampaignIds");
  });
});
