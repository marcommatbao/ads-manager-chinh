// Revenue targets validator
// Rule: monthly_target must be a positive number

export interface ValidationError {
  field: string;
  message: string;
}

export type RevenueTargets = Record<string, { monthly_target?: number } | undefined>;

export function validateRevenueTargets(targets: RevenueTargets): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const company of companyIds()) {
    const t = targets[company];
    if (!t) continue;
    if (t.monthly_target !== undefined) {
      const v = Number(t.monthly_target);
      if (isNaN(v) || v <= 0) {
        errors.push({
          field: `${company}.monthly_target`,
          message: `Doanh thu mục tiêu ${company} phải là số dương`,
        });
      }
    }
  }

  return errors;
}

import { companyIds } from "@/lib/companies"