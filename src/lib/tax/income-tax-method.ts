// Resolve income tax method (8% vs Graduated) per tax year.

import {
  INCOME_TAX_METHOD,
  type IncomeTaxMethod,
} from "./calendar-constants";

export type IncomeTaxMethodSettings = {
  /** Active tax year in Settings → Tax year. */
  year: number;
  /** Method for the active tax year. */
  incomeTaxMethod: IncomeTaxMethod;
  /** Explicit overrides keyed by calendar year string ("2026"). */
  incomeTaxMethodsByYear: Record<string, IncomeTaxMethod>;
};

/**
 * Seed rule: 2026 → 8%; 2027 onward → Graduated.
 * Explicit per-year overrides and the active-year field win when set.
 */
export function incomeTaxMethodForYear(
  settings: IncomeTaxMethodSettings,
  year: number,
): IncomeTaxMethod {
  const fromMap = settings.incomeTaxMethodsByYear[String(year)];
  if (fromMap === INCOME_TAX_METHOD.EIGHT_PERCENT || fromMap === INCOME_TAX_METHOD.GRADUATED) {
    return fromMap;
  }
  if (year === settings.year) return settings.incomeTaxMethod;
  if (year <= 2026) return INCOME_TAX_METHOD.EIGHT_PERCENT;
  return INCOME_TAX_METHOD.GRADUATED;
}

/** Persist the active-year method into the by-year map. */
export function withIncomeTaxMethodForActiveYear(
  settings: IncomeTaxMethodSettings,
): IncomeTaxMethodSettings {
  return {
    ...settings,
    incomeTaxMethodsByYear: {
      ...settings.incomeTaxMethodsByYear,
      [String(settings.year)]: settings.incomeTaxMethod,
    },
  };
}

export function isEightPercent(method: IncomeTaxMethod): boolean {
  return method === INCOME_TAX_METHOD.EIGHT_PERCENT;
}

export function isGraduated(method: IncomeTaxMethod): boolean {
  return method === INCOME_TAX_METHOD.GRADUATED;
}
