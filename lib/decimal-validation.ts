/** Matches Prisma @db.Decimal(12, 2) — ten integer digits + two fractional. */
export const MAX_DECIMAL_12_2 = 9_999_999_999.99

/** Matches Prisma @db.Decimal(4, 2). */
export const MAX_DECIMAL_4_2 = 99.99

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100
}

export type DecimalValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

export function validateDecimal12_2(
  value: number,
  label: string,
): DecimalValidationResult {
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a finite number` }
  }
  const rounded = roundToCents(value)
  if (rounded < 0) {
    return { ok: false, error: `${label} must be non-negative` }
  }
  if (rounded > MAX_DECIMAL_12_2) {
    return { ok: false, error: `${label} exceeds the maximum allowed value` }
  }
  return { ok: true, value: rounded }
}

export function validateDecimal4_2Positive(
  value: number,
  label: string,
): DecimalValidationResult {
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a finite number` }
  }
  const rounded = roundToCents(value)
  if (rounded <= 0) {
    return { ok: false, error: `${label} must be a positive number` }
  }
  if (rounded > MAX_DECIMAL_4_2) {
    return { ok: false, error: `${label} exceeds the maximum allowed value` }
  }
  return { ok: true, value: rounded }
}
