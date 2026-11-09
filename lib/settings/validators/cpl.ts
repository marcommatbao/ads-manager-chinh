// CPL threshold settings validator.
// good/warning/critical are computed from KPI now (not stored), so the only
// thing left to validate is MBC's referenceAov — must be a positive number.

export interface ValidationError {
  field: string;
  message: string;
}

export interface CplSettingsPatch {
  MBC?: { referenceAov?: number };
}

export function validateCplConfig(config: CplSettingsPatch): ValidationError[] {
  const errors: ValidationError[] = [];

  if (config.MBC?.referenceAov !== undefined) {
    const v = Number(config.MBC.referenceAov);
    if (isNaN(v) || v <= 0) {
      errors.push({ field: "MBC.referenceAov", message: "AOV tham chiếu MBC phải là số dương" });
    }
  }

  return errors;
}
