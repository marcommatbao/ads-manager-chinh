import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditEntry, writeAuditSnapshot } from "@/lib/settings/audit";
import { validateCompanyBudget } from "@/lib/settings/validators/budget";
import { guardEditBudget, guardBudgetCompanyScope, scopeBudgetToCompanies } from "@/lib/settings/guards";
import fs from "fs";
import { writeFileAtomicSync } from "@/lib/fs-atomic";
import path from "path";
import { companyIds } from "@/lib/companies"

const BUDGET_CONFIG_FILE = path.join(process.cwd(), "data", "global-budget-config.json");

interface CompanyBudget {
  daily_budget: number;
  monthly_cap: number;
  auto_redistribute: boolean;
  redistribution_threshold: number;
}

type GlobalBudgetConfig = Record<string, CompanyBudget>;

const DEFAULT_CONFIG: GlobalBudgetConfig = {
  MBC: {
    daily_budget: 5000000,
    monthly_cap: 100000000,
    auto_redistribute: true,
    redistribution_threshold: 80,
  },
  MBI: {
    daily_budget: 3000000,
    monthly_cap: 60000000,
    auto_redistribute: true,
    redistribution_threshold: 75,
  },
};

function getBudgetConfig(): GlobalBudgetConfig {
  try {
    if (fs.existsSync(BUDGET_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUDGET_CONFIG_FILE, "utf-8"));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (err) {
    console.error("[Budget API] Error reading config:", err);
  }
  return DEFAULT_CONFIG;
}

function saveBudgetConfig(config: GlobalBudgetConfig): void {
  const dir = path.dirname(BUDGET_CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeFileAtomicSync(BUDGET_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const config = getBudgetConfig();
    // Scope response to companies the user can access (super_admin → full config)
    const scoped = scopeBudgetToCompanies(user, config as unknown as Record<string, unknown>);
    return NextResponse.json(scoped);
  } catch (err) {
    console.error("[Budget API GET]", err);
    return NextResponse.json({ error: "Failed to load budget config" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Role gate: only admins with can_manage_budget
    const roleGuard = guardEditBudget(user);
    if (roleGuard) return roleGuard;

    const body = await req.json() as Partial<GlobalBudgetConfig>;

    // Company-scope gate: admins cannot write sibling company's budget
    const scopeGuard = guardBudgetCompanyScope(user, body as Record<string, unknown>);
    if (scopeGuard) return scopeGuard;
    const currentConfig = getBudgetConfig();

    const newConfig: GlobalBudgetConfig = {
      MBC: { ...currentConfig.MBC, ...(body.MBC || {}) },
      MBI: { ...currentConfig.MBI, ...(body.MBI || {}) },
    };

    // Validate
    const errors = [
      ...validateCompanyBudget("MBC", newConfig.MBC),
      ...validateCompanyBudget("MBI", newConfig.MBI),
    ];
    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 422 });
    }

    // Snapshot current config before overwriting (enables rollback)
    await writeAuditSnapshot("budget", user, currentConfig);

    // Diff and log each changed field
    const auditPromises: Promise<void>[] = [];
    for (const company of companyIds()) {
      const oldC = currentConfig[company];
      const newC = newConfig[company];
      if (!oldC || !newC) continue;
      for (const key of Object.keys(newC) as (keyof CompanyBudget)[]) {
        if (oldC[key] !== newC[key]) {
          auditPromises.push(
            writeAuditEntry("budget", user, "update", `${company}.${key}`, oldC[key], newC[key], company),
          );
        }
      }
    }
    await Promise.all(auditPromises);

    saveBudgetConfig(newConfig);

    return NextResponse.json({ success: true, data: newConfig });
  } catch (err) {
    console.error("[Budget API PUT]", err);
    return NextResponse.json({ success: false, error: "Failed to save budget config" }, { status: 500 });
  }
}
