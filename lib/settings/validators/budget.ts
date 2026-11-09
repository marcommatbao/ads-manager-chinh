// Budget config validator
// Rule: daily_budget ≤ monthly_cap, no negatives, threshold 0-100.

export interface CompanyBudget {
  daily_budget: number;
  monthly_cap: number;
  auto_redistribute: boolean;
  redistribution_threshold: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateCompanyBudget(
  company: string,
  data: Partial<CompanyBudget>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const daily   = Number(data.daily_budget  ?? 0);
  const monthly = Number(data.monthly_cap   ?? 0);
  const thresh  = Number(data.redistribution_threshold ?? 0);

  if (data.daily_budget !== undefined) {
    if (isNaN(daily) || daily < 0) {
      errors.push({ field: `${company}.daily_budget`, message: "Ngân sách ngày không được âm" });
    }
  }

  if (data.monthly_cap !== undefined) {
    if (isNaN(monthly) || monthly < 0) {
      errors.push({ field: `${company}.monthly_cap`, message: "Giới hạn tháng không được âm" });
    }
  }

  if (
    data.daily_budget !== undefined &&
    data.monthly_cap  !== undefined &&
    !isNaN(daily) && !isNaN(monthly) &&
    daily > 0 && monthly > 0 &&
    daily > monthly
  ) {
    errors.push({
      field: `${company}.daily_budget`,
      message: `Ngân sách ngày (${fmtVND(daily)}) không được vượt quá giới hạn tháng (${fmtVND(monthly)})`,
    });
  }

  if (data.redistribution_threshold !== undefined) {
    if (isNaN(thresh) || thresh < 0 || thresh > 100) {
      errors.push({ field: `${company}.redistribution_threshold`, message: "Ngưỡng phân phối phải từ 0-100%" });
    }
  }

  return errors;
}

function fmtVND(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n) + " ₫";
}
