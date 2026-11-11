/**
 * Validators & parsers for Bitcoin-backed loan (BtcLoan) create/update bodies
 * used by the Runway loans API (slice B2).
 *
 * Collateral is bitcoin the user sent to a lender — it is NOT a wallet balance.
 * These helpers only validate and normalize client payloads into the shape the
 * API route persists; the actual loan math lives in `lib/loan-health.ts` (B1),
 * whose types are reused here where possible.
 *
 * All errors are plain-language so they can surface directly in the UI.
 */

import { coerceDecimal12_2Input, roundToCents } from "@/lib/decimal-validation"
import type { BtcLoanInput, LoanPayoffStyle } from "@/lib/loan-health"

/** Valid payoff styles (mirrors `LoanPayoffStyle` in loan-health). */
export const LOAN_PAYOFF_STYLES = ["accrued", "full_bill"] as const

/** Lifecycle status for a loan row. */
export type LoanStatus = "open" | "paid" | "liquidated" | "rolled"
export const LOAN_STATUSES = ["open", "paid", "liquidated", "rolled"] as const

/** Label is plaintext but kept short so it stays a nickname, not an essay. */
export const MAX_LOAN_LABEL_LENGTH = 80

/**
 * Generous cap for APR as a fraction. 10 == 1000% APR — far above any real
 * loan, but it also fits the Decimal(6,4) column (max 99.9999).
 */
export const MAX_APR_FRACTION = 10

/** Largest sats value we accept — stays within JS safe-integer range. */
export const MAX_COLLATERAL_SATS = Number.MAX_SAFE_INTEGER

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Parsed, normalized create payload ready to persist. */
export interface LoanCreateInput {
  label: string
  principalUsd: number
  aprFraction: number
  openedOn: string
  maturityOn: string
  collateralSats: number
  lenderSellPriceUsd: number
  payoffStyle: LoanPayoffStyle
  maturityBillOverrideUsd: number | null
  status: LoanStatus
}

/**
 * Parsed update payload. Every key is optional; only provided fields are
 * updated. `maturityBillOverrideUsd: null` explicitly clears the override.
 */
export type LoanUpdateInput = Partial<LoanCreateInput>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Validate a `YYYY-MM-DD` string is a real calendar date. */
export function validateCalendarDate(value: unknown, label: string): ParseResult<string> {
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) {
    return { ok: false, error: `${label} must be a date in YYYY-MM-DD format` }
  }
  const trimmed = value.trim()
  const parsed = Date.parse(`${trimmed}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${label} is not a valid calendar date` }
  }
  // Guard against overflow like 2026-02-30 that Date.parse would roll over.
  const iso = new Date(parsed).toISOString().slice(0, 10)
  if (iso !== trimmed) {
    return { ok: false, error: `${label} is not a valid calendar date` }
  }
  return { ok: true, value: trimmed }
}

/** Validate APR expressed as a fraction (0.10 == 10%). */
export function validateAprFraction(value: unknown): ParseResult<number> {
  let num: number
  if (typeof value === "number") {
    num = value
  } else if (typeof value === "string" && value.trim() !== "") {
    num = Number(value.trim())
  } else {
    return { ok: false, error: "APR must be a number (as a fraction, e.g. 0.1 for 10%)" }
  }
  if (!Number.isFinite(num)) {
    return { ok: false, error: "APR must be a finite number" }
  }
  if (num < 0) {
    return { ok: false, error: "APR can't be negative" }
  }
  if (num > MAX_APR_FRACTION) {
    return { ok: false, error: "APR looks too high — enter it as a fraction (0.1 means 10%)" }
  }
  // Decimal(6,4): round to 4 fractional digits.
  return { ok: true, value: Math.round(num * 10_000) / 10_000 }
}

/** Validate a non-negative integer sats amount. */
export function validateSats(value: unknown, label: string): ParseResult<number> {
  let num: number
  if (typeof value === "number") {
    num = value
  } else if (typeof value === "bigint") {
    num = Number(value)
  } else if (typeof value === "string" && value.trim() !== "") {
    num = Number(value.trim())
  } else {
    return { ok: false, error: `${label} must be a whole number of sats` }
  }
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { ok: false, error: `${label} must be a whole number of sats` }
  }
  if (num < 0) {
    return { ok: false, error: `${label} can't be negative` }
  }
  if (num > MAX_COLLATERAL_SATS) {
    return { ok: false, error: `${label} is too large` }
  }
  return { ok: true, value: num }
}

function validateLabel(value: unknown): ParseResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: "Loan name is required" }
  }
  const trimmed = value.trim()
  if (trimmed === "") {
    return { ok: false, error: "Loan name is required" }
  }
  if (trimmed.length > MAX_LOAN_LABEL_LENGTH) {
    return { ok: false, error: `Loan name must be ${MAX_LOAN_LABEL_LENGTH} characters or fewer` }
  }
  return { ok: true, value: trimmed }
}

function validatePayoffStyle(value: unknown): ParseResult<LoanPayoffStyle> {
  if (value === "accrued" || value === "full_bill") {
    return { ok: true, value }
  }
  return { ok: false, error: "Payoff style must be either 'accrued' or 'full_bill'" }
}

function validateStatus(value: unknown): ParseResult<LoanStatus> {
  if (
    value === "open" ||
    value === "paid" ||
    value === "liquidated" ||
    value === "rolled"
  ) {
    return { ok: true, value }
  }
  return { ok: false, error: "Status must be one of: open, paid, liquidated, rolled" }
}

/** A positive USD amount within the Decimal(12,2) range. */
function validatePositiveUsd(value: unknown, label: string): ParseResult<number> {
  const res = coerceDecimal12_2Input(value, label)
  if (!res.ok) return res
  if (res.value <= 0) {
    return { ok: false, error: `${label} must be greater than zero` }
  }
  return res
}

/** A non-negative USD amount within the Decimal(12,2) range. */
function validateNonNegativeUsd(value: unknown, label: string): ParseResult<number> {
  return coerceDecimal12_2Input(value, label)
}

/**
 * Parse and validate a loan **create** body. Requires all core fields; applies
 * sensible defaults (`status: "open"`, no override). Ensures maturity is on or
 * after the open date.
 */
export function parseLoanCreateBody(raw: unknown): ParseResult<LoanCreateInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Expected a JSON object" }
  }

  const label = validateLabel(raw.label)
  if (!label.ok) return label

  const principalUsd = validatePositiveUsd(raw.principalUsd, "Principal")
  if (!principalUsd.ok) return principalUsd

  const aprFraction = validateAprFraction(raw.apr)
  if (!aprFraction.ok) return aprFraction

  const openedOn = validateCalendarDate(raw.openedOn, "Open date")
  if (!openedOn.ok) return openedOn

  const maturityOn = validateCalendarDate(raw.maturityOn, "Maturity date")
  if (!maturityOn.ok) return maturityOn

  if (maturityOn.value < openedOn.value) {
    return { ok: false, error: "Maturity date must be on or after the open date" }
  }

  const collateralSats = validateSats(raw.collateralSats, "Collateral")
  if (!collateralSats.ok) return collateralSats

  const lenderSellPriceUsd = validateNonNegativeUsd(raw.lenderSellPriceUsd, "Lender sell price")
  if (!lenderSellPriceUsd.ok) return lenderSellPriceUsd

  const payoffStyle = validatePayoffStyle(raw.payoffStyle)
  if (!payoffStyle.ok) return payoffStyle

  let maturityBillOverrideUsd: number | null = null
  if (raw.maturityBillOverrideUsd != null) {
    const override = validateNonNegativeUsd(raw.maturityBillOverrideUsd, "Maturity bill")
    if (!override.ok) return override
    maturityBillOverrideUsd = override.value
  }

  let status: LoanStatus = "open"
  if (raw.status != null) {
    const parsedStatus = validateStatus(raw.status)
    if (!parsedStatus.ok) return parsedStatus
    status = parsedStatus.value
  }

  return {
    ok: true,
    value: {
      label: label.value,
      principalUsd: principalUsd.value,
      aprFraction: aprFraction.value,
      openedOn: openedOn.value,
      maturityOn: maturityOn.value,
      collateralSats: collateralSats.value,
      lenderSellPriceUsd: lenderSellPriceUsd.value,
      payoffStyle: payoffStyle.value,
      maturityBillOverrideUsd,
      status,
    },
  }
}

/**
 * Parse and validate a loan **update** body. Only provided keys are validated
 * and returned. Requires at least one updatable field. `maturityBillOverrideUsd`
 * may be set to `null` to clear a previously-typed final bill.
 *
 * Cross-field date ordering is only enforced when **both** dates are present in
 * the same patch; callers that change a single date against a stored value
 * should re-check against the persisted row.
 */
export function parseLoanUpdateBody(raw: unknown): ParseResult<LoanUpdateInput> {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Expected a JSON object" }
  }

  const out: LoanUpdateInput = {}

  if ("label" in raw) {
    const r = validateLabel(raw.label)
    if (!r.ok) return r
    out.label = r.value
  }
  if ("principalUsd" in raw) {
    const r = validatePositiveUsd(raw.principalUsd, "Principal")
    if (!r.ok) return r
    out.principalUsd = r.value
  }
  if ("apr" in raw) {
    const r = validateAprFraction(raw.apr)
    if (!r.ok) return r
    out.aprFraction = r.value
  }
  if ("openedOn" in raw) {
    const r = validateCalendarDate(raw.openedOn, "Open date")
    if (!r.ok) return r
    out.openedOn = r.value
  }
  if ("maturityOn" in raw) {
    const r = validateCalendarDate(raw.maturityOn, "Maturity date")
    if (!r.ok) return r
    out.maturityOn = r.value
  }
  if ("collateralSats" in raw) {
    const r = validateSats(raw.collateralSats, "Collateral")
    if (!r.ok) return r
    out.collateralSats = r.value
  }
  if ("lenderSellPriceUsd" in raw) {
    const r = validateNonNegativeUsd(raw.lenderSellPriceUsd, "Lender sell price")
    if (!r.ok) return r
    out.lenderSellPriceUsd = r.value
  }
  if ("payoffStyle" in raw) {
    const r = validatePayoffStyle(raw.payoffStyle)
    if (!r.ok) return r
    out.payoffStyle = r.value
  }
  if ("maturityBillOverrideUsd" in raw) {
    if (raw.maturityBillOverrideUsd == null) {
      out.maturityBillOverrideUsd = null
    } else {
      const r = validateNonNegativeUsd(raw.maturityBillOverrideUsd, "Maturity bill")
      if (!r.ok) return r
      out.maturityBillOverrideUsd = r.value
    }
  }
  if ("status" in raw) {
    const r = validateStatus(raw.status)
    if (!r.ok) return r
    out.status = r.value
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, error: "No updatable fields were provided" }
  }

  if (
    out.openedOn != null &&
    out.maturityOn != null &&
    out.maturityOn < out.openedOn
  ) {
    return { ok: false, error: "Maturity date must be on or after the open date" }
  }

  return { ok: true, value: out }
}

/** Shape of a persisted loan row this module knows how to map to loan math. */
export interface BtcLoanRowForMath {
  id: string
  principalUsd: number
  apr: number
  openedOn: string
  maturityOn: string
  collateralSats: number
  lenderSellPriceUsd: number
  payoffStyle: LoanPayoffStyle
  /** Typed final bill overriding the computed maturity bill, or null. */
  maturityBillOverrideUsd?: number | null
}

/** Map a persisted loan row to the `BtcLoanInput` shape used by loan-health. */
export function toLoanHealthInput(row: BtcLoanRowForMath): BtcLoanInput {
  return {
    id: row.id,
    principalUsd: row.principalUsd,
    aprFraction: row.apr,
    openDate: row.openedOn,
    maturityDate: row.maturityOn,
    payoffStyle: row.payoffStyle,
    collateralSats: row.collateralSats,
    liquidationPriceUsd: row.lenderSellPriceUsd,
    maturityBillOverrideUsd: row.maturityBillOverrideUsd ?? null,
  }
}

/** Round a USD number to cents (re-exported convenience). */
export { roundToCents }
