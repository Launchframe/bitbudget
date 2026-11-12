/**
 * Financial Runway plan types, defaults, and validation helpers.
 *
 * A3 is a standalone slice: it must NOT import from the (separately proposed)
 * runway-need or expense-insight modules. All string unions and shapes used by
 * the plan are defined locally here so this slice can land independently.
 *
 * Validation helpers return a discriminated result ({ ok: true, value } or
 * { ok: false, error }) with plain-language error strings. They never throw on
 * bad input and never log anything.
 */

import {
  MAX_DECIMAL_12_2,
  roundToCents,
} from "@/lib/decimal-validation"

// ---------------------------------------------------------------------------
// String unions (defined locally — do not import from A1/A2)
// ---------------------------------------------------------------------------

export const RUNWAY_PHASES = ["buildup", "runway"] as const
export type RunwayPhase = (typeof RUNWAY_PHASES)[number]

/** How a user wants to react to a Bitcoin price dip during runway. */
export const DIP_RESPONSES = ["wait", "cut", "sell"] as const
export type DipResponse = (typeof DIP_RESPONSES)[number]

/** How much of the runway the user wants backed by Bitcoin vs cash. */
export const BTC_SHARE_PREFERENCES = ["little", "half", "most"] as const
export type BtcSharePreference = (typeof BTC_SHARE_PREFERENCES)[number]

/** Appetite for borrowing against Bitcoin instead of selling. */
export const BORROW_STANCES = ["never", "deep_drop", "ok"] as const
export type BorrowStance = (typeof BORROW_STANCES)[number]

/** How a planned spending line affects the current budget. */
export const PLANNED_LINE_MODES = ["add", "replaces"] as const
export type PlannedLineMode = (typeof PLANNED_LINE_MODES)[number]

/** Per-envelope priority used when stress-testing the runway. */
export const ENVELOPE_PRIORITIES = ["essential", "flexible"] as const
export type EnvelopePriority = (typeof ENVELOPE_PRIORITIES)[number]

// ---------------------------------------------------------------------------
// JSON shapes
// ---------------------------------------------------------------------------

export interface PlannedLine {
  id: string
  group: string
  label: string
  monthlyUsd: number
  mode: PlannedLineMode
  /** Only meaningful for mode "replaces": the prior monthly average this line replaces. */
  replacesMonthlyUsd?: number
}

export interface RunwayScenario {
  id: string
  label: string
  monthlyDeltaUsd: number
  oneTimeUsd: number
  enabled: boolean
}

export type EnvelopePriorityMap = Record<string, EnvelopePriority>

/** Fully-resolved plan values (numbers as numbers, defaults filled in). */
export interface RunwayPlanValues {
  phase: RunwayPhase
  quitDate: string | null
  horizonMonths: number
  runwayIncomeUsd: number
  livingBaselineOverrideUsd: number | null
  inflationRateYear: number
  stressPercent: number
  growthRateYear: number | null
  dipResponse: DipResponse
  btcSharePreference: BtcSharePreference
  borrowStance: BorrowStance
  editedCashFloorUsd: number | null
  editedBorrowCapFraction: number | null
  cashOverrideUsd: number | null
  /** Sats as an integer; null = no manual override. */
  bitcoinOverrideSats: number | null
  plannedLines: PlannedLine[]
  scenarios: RunwayScenario[]
  envelopePriorities: EnvelopePriorityMap
  checkupOpenedMonthKey: string | null
}

// ---------------------------------------------------------------------------
// Defaults (must match prisma schema defaults)
// ---------------------------------------------------------------------------

export const RUNWAY_PLAN_DEFAULTS: RunwayPlanValues = {
  phase: "buildup",
  quitDate: null,
  horizonMonths: 24,
  runwayIncomeUsd: 0,
  livingBaselineOverrideUsd: null,
  inflationRateYear: 0.05,
  stressPercent: 0.5,
  growthRateYear: null,
  dipResponse: "cut",
  btcSharePreference: "half",
  borrowStance: "deep_drop",
  editedCashFloorUsd: null,
  editedBorrowCapFraction: null,
  cashOverrideUsd: null,
  bitcoinOverrideSats: null,
  plannedLines: [],
  scenarios: [],
  envelopePriorities: {},
  checkupOpenedMonthKey: null,
}

// Bounds for "reasonable" values. Rates are stored as Decimal(8, 4).
export const MIN_HORIZON_MONTHS = 1
export const MAX_HORIZON_MONTHS = 600 // 50 years
/** Annual inflation assumption: allow mild deflation up to very high inflation. */
export const MIN_INFLATION_RATE_YEAR = -0.5
export const MAX_INFLATION_RATE_YEAR = 2
/** Annual growth assumption for savings/Bitcoin; -1 = total loss. */
export const MIN_GROWTH_RATE_YEAR = -1
export const MAX_GROWTH_RATE_YEAR = 5
/** Largest sat value we accept (21,000,000 BTC in sats). */
export const MAX_BITCOIN_OVERRIDE_SATS = 21_000_000 * 100_000_000

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const MONTH_KEY_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** Accepts a number or a non-empty numeric string; returns a finite number. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Non-negative USD amount (Decimal(12,2)), rounded to cents. */
function validateUsdNonNegative(
  value: unknown,
  label: string,
): ValidationResult<number> {
  const n = toFiniteNumber(value)
  if (n === null) return { ok: false, error: `${label} must be a number.` }
  const rounded = roundToCents(n)
  if (rounded < 0) return { ok: false, error: `${label} cannot be negative.` }
  if (rounded > MAX_DECIMAL_12_2) {
    return { ok: false, error: `${label} is too large.` }
  }
  return { ok: true, value: rounded }
}

/** Signed USD amount (Decimal(12,2)) — used for scenario deltas. */
function validateUsdSigned(
  value: unknown,
  label: string,
): ValidationResult<number> {
  const n = toFiniteNumber(value)
  if (n === null) return { ok: false, error: `${label} must be a number.` }
  const rounded = roundToCents(n)
  if (Math.abs(rounded) > MAX_DECIMAL_12_2) {
    return { ok: false, error: `${label} is too large.` }
  }
  return { ok: true, value: rounded }
}

function validateRateInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const n = toFiniteNumber(value)
  if (n === null) return { ok: false, error: `${label} must be a number.` }
  const rounded = round4(n)
  if (rounded < min || rounded > max) {
    return { ok: false, error: `${label} is outside the allowed range.` }
  }
  return { ok: true, value: rounded }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

export function validatePlannedLines(
  value: unknown,
): ValidationResult<PlannedLine[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Planned lines must be a list." }
  }
  const out: PlannedLine[] = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    const where = `Planned line ${i + 1}`
    if (!isPlainObject(item)) {
      return { ok: false, error: `${where} is not valid.` }
    }
    if (typeof item.id !== "string" || item.id.trim() === "") {
      return { ok: false, error: `${where} is missing an id.` }
    }
    if (typeof item.group !== "string") {
      return { ok: false, error: `${where} is missing a group.` }
    }
    if (typeof item.label !== "string") {
      return { ok: false, error: `${where} is missing a label.` }
    }
    if (!PLANNED_LINE_MODES.includes(item.mode as PlannedLineMode)) {
      return {
        ok: false,
        error: `${where} has an unknown type. Use add or replaces.`,
      }
    }
    const monthly = validateUsdNonNegative(item.monthlyUsd, `${where} amount`)
    if (!monthly.ok) return monthly

    const line: PlannedLine = {
      id: item.id,
      group: item.group,
      label: item.label,
      mode: item.mode as PlannedLineMode,
      monthlyUsd: monthly.value,
    }

    if (
      item.replacesMonthlyUsd !== undefined &&
      item.replacesMonthlyUsd !== null
    ) {
      const replaces = validateUsdNonNegative(
        item.replacesMonthlyUsd,
        `${where} replaced amount`,
      )
      if (!replaces.ok) return replaces
      line.replacesMonthlyUsd = replaces.value
    }

    out.push(line)
  }
  return { ok: true, value: out }
}

export function validateScenarios(
  value: unknown,
): ValidationResult<RunwayScenario[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Scenarios must be a list." }
  }
  const out: RunwayScenario[] = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    const where = `Scenario ${i + 1}`
    if (!isPlainObject(item)) {
      return { ok: false, error: `${where} is not valid.` }
    }
    if (typeof item.id !== "string" || item.id.trim() === "") {
      return { ok: false, error: `${where} is missing an id.` }
    }
    if (typeof item.label !== "string") {
      return { ok: false, error: `${where} is missing a label.` }
    }
    if (typeof item.enabled !== "boolean") {
      return { ok: false, error: `${where} must be on or off.` }
    }
    const monthlyDelta = validateUsdSigned(
      item.monthlyDeltaUsd,
      `${where} monthly change`,
    )
    if (!monthlyDelta.ok) return monthlyDelta
    const oneTime = validateUsdSigned(item.oneTimeUsd, `${where} one-time amount`)
    if (!oneTime.ok) return oneTime

    out.push({
      id: item.id,
      label: item.label,
      monthlyDeltaUsd: monthlyDelta.value,
      oneTimeUsd: oneTime.value,
      enabled: item.enabled,
    })
  }
  return { ok: true, value: out }
}

export function validateEnvelopePriorities(
  value: unknown,
): ValidationResult<EnvelopePriorityMap> {
  if (!isPlainObject(value)) {
    return { ok: false, error: "Envelope priorities must be an object." }
  }
  const out: EnvelopePriorityMap = {}
  for (const [envelopeId, priority] of Object.entries(value)) {
    if (!ENVELOPE_PRIORITIES.includes(priority as EnvelopePriority)) {
      return {
        ok: false,
        error: "Each envelope must be marked essential or flexible.",
      }
    }
    out[envelopeId] = priority as EnvelopePriority
  }
  return { ok: true, value: out }
}

/**
 * Validates the three questionnaire "risk" answers. Each is optional in the
 * body; when omitted the caller's default is used.
 */
export function validateRiskFields(value: unknown): ValidationResult<{
  dipResponse: DipResponse
  btcSharePreference: BtcSharePreference
  borrowStance: BorrowStance
}> {
  if (!isPlainObject(value)) {
    return { ok: false, error: "Answers must be an object." }
  }

  let dipResponse: DipResponse = RUNWAY_PLAN_DEFAULTS.dipResponse
  if (value.dipResponse !== undefined) {
    if (!DIP_RESPONSES.includes(value.dipResponse as DipResponse)) {
      return {
        ok: false,
        error: "Choose how you'd respond to a dip: wait, cut, or sell.",
      }
    }
    dipResponse = value.dipResponse as DipResponse
  }

  let btcSharePreference: BtcSharePreference =
    RUNWAY_PLAN_DEFAULTS.btcSharePreference
  if (value.btcSharePreference !== undefined) {
    if (
      !BTC_SHARE_PREFERENCES.includes(
        value.btcSharePreference as BtcSharePreference,
      )
    ) {
      return {
        ok: false,
        error: "Choose how much Bitcoin to lean on: little, half, or most.",
      }
    }
    btcSharePreference = value.btcSharePreference as BtcSharePreference
  }

  let borrowStance: BorrowStance = RUNWAY_PLAN_DEFAULTS.borrowStance
  if (value.borrowStance !== undefined) {
    if (!BORROW_STANCES.includes(value.borrowStance as BorrowStance)) {
      return {
        ok: false,
        error: "Choose a borrowing comfort level: never, deep_drop, or ok.",
      }
    }
    borrowStance = value.borrowStance as BorrowStance
  }

  return { ok: true, value: { dipResponse, btcSharePreference, borrowStance } }
}

function validateQuitDate(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    return { ok: false, error: "Quit date must look like YYYY-MM-DD." }
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  // Date() normalizes overflow (e.g. 2027-02-31 → March 3) instead of failing,
  // so round-trip the components to reject impossible calendar dates.
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return { ok: false, error: "Quit date is not a real date." }
  }
  return { ok: true, value }
}

function validateMonthKey(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  if (typeof value !== "string" || !MONTH_KEY_RE.test(value)) {
    return { ok: false, error: "Month must look like YYYY-MM." }
  }
  // The regex allows any two digits; reject months outside 01–12.
  const month = Number(value.slice(5, 7))
  if (month < 1 || month > 12) {
    return { ok: false, error: "Month must be between 01 and 12." }
  }
  return { ok: true, value }
}

function validateHorizonMonths(value: unknown): ValidationResult<number> {
  const n = toFiniteNumber(value)
  if (n === null || !Number.isInteger(n)) {
    return { ok: false, error: "Horizon must be a whole number of months." }
  }
  if (n < MIN_HORIZON_MONTHS || n > MAX_HORIZON_MONTHS) {
    return {
      ok: false,
      error: `Horizon must be between ${MIN_HORIZON_MONTHS} and ${MAX_HORIZON_MONTHS} months.`,
    }
  }
  return { ok: true, value: n }
}

function validateSatsNonNegative(
  value: unknown,
): ValidationResult<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  const n = toFiniteNumber(value)
  if (n === null || !Number.isInteger(n)) {
    return { ok: false, error: "Bitcoin override must be a whole number of sats." }
  }
  if (n < 0) {
    return { ok: false, error: "Bitcoin override cannot be negative." }
  }
  if (n > MAX_BITCOIN_OVERRIDE_SATS) {
    return { ok: false, error: "Bitcoin override is too large." }
  }
  return { ok: true, value: n }
}

/**
 * Optional non-negative USD override that may be explicitly cleared (null).
 */
function validateOptionalUsd(
  value: unknown,
  label: string,
): ValidationResult<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  return validateUsdNonNegative(value, label)
}

function validateOptionalRate(
  value: unknown,
  label: string,
  min: number,
  max: number,
): ValidationResult<number | null> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null }
  }
  return validateRateInRange(value, label, min, max)
}

// ---------------------------------------------------------------------------
// Top-level body parser
// ---------------------------------------------------------------------------

/**
 * Parse and normalize a full Runway plan body. Every field is optional; missing
 * fields fall back to {@link RUNWAY_PLAN_DEFAULTS}. The returned value is safe to
 * upsert directly. Does not touch user identity — the caller supplies userId
 * from the session.
 */
export function parseRunwayPlanBody(
  body: unknown,
): ValidationResult<RunwayPlanValues> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Expected a plan object." }
  }

  const result: RunwayPlanValues = { ...RUNWAY_PLAN_DEFAULTS }

  if (body.phase !== undefined) {
    if (!RUNWAY_PHASES.includes(body.phase as RunwayPhase)) {
      return { ok: false, error: "Phase must be buildup or runway." }
    }
    result.phase = body.phase as RunwayPhase
  }

  const quitDate = validateQuitDate(body.quitDate)
  if (!quitDate.ok) return quitDate
  result.quitDate = quitDate.value

  if (body.horizonMonths !== undefined) {
    const horizon = validateHorizonMonths(body.horizonMonths)
    if (!horizon.ok) return horizon
    result.horizonMonths = horizon.value
  }

  if (body.runwayIncomeUsd !== undefined) {
    const income = validateUsdNonNegative(body.runwayIncomeUsd, "Runway income")
    if (!income.ok) return income
    result.runwayIncomeUsd = income.value
  }

  const livingBaseline = validateOptionalUsd(
    body.livingBaselineOverrideUsd,
    "Living baseline",
  )
  if (!livingBaseline.ok) return livingBaseline
  result.livingBaselineOverrideUsd = livingBaseline.value

  if (body.inflationRateYear !== undefined) {
    const inflation = validateRateInRange(
      body.inflationRateYear,
      "Inflation rate",
      MIN_INFLATION_RATE_YEAR,
      MAX_INFLATION_RATE_YEAR,
    )
    if (!inflation.ok) return inflation
    result.inflationRateYear = inflation.value
  }

  if (body.stressPercent !== undefined) {
    const stress = validateRateInRange(body.stressPercent, "Stress amount", 0, 1)
    if (!stress.ok) return stress
    result.stressPercent = stress.value
  }

  const growth = validateOptionalRate(
    body.growthRateYear,
    "Growth rate",
    MIN_GROWTH_RATE_YEAR,
    MAX_GROWTH_RATE_YEAR,
  )
  if (!growth.ok) return growth
  result.growthRateYear = growth.value

  // Risk questionnaire answers.
  const risk = validateRiskFields({
    dipResponse: body.dipResponse,
    btcSharePreference: body.btcSharePreference,
    borrowStance: body.borrowStance,
  })
  if (!risk.ok) return risk
  result.dipResponse = risk.value.dipResponse
  result.btcSharePreference = risk.value.btcSharePreference
  result.borrowStance = risk.value.borrowStance

  const editedFloor = validateOptionalUsd(
    body.editedCashFloorUsd,
    "Cash floor",
  )
  if (!editedFloor.ok) return editedFloor
  result.editedCashFloorUsd = editedFloor.value

  const borrowCap = validateOptionalRate(
    body.editedBorrowCapFraction,
    "Borrow cap",
    0,
    1,
  )
  if (!borrowCap.ok) return borrowCap
  result.editedBorrowCapFraction = borrowCap.value

  const cashOverride = validateOptionalUsd(body.cashOverrideUsd, "Cash override")
  if (!cashOverride.ok) return cashOverride
  result.cashOverrideUsd = cashOverride.value

  const sats = validateSatsNonNegative(body.bitcoinOverrideSats)
  if (!sats.ok) return sats
  result.bitcoinOverrideSats = sats.value

  if (body.plannedLines !== undefined) {
    const lines = validatePlannedLines(body.plannedLines)
    if (!lines.ok) return lines
    result.plannedLines = lines.value
  }

  if (body.scenarios !== undefined) {
    const scenarios = validateScenarios(body.scenarios)
    if (!scenarios.ok) return scenarios
    result.scenarios = scenarios.value
  }

  if (body.envelopePriorities !== undefined) {
    const priorities = validateEnvelopePriorities(body.envelopePriorities)
    if (!priorities.ok) return priorities
    result.envelopePriorities = priorities.value
  }

  const checkup = validateMonthKey(body.checkupOpenedMonthKey)
  if (!checkup.ok) return checkup
  result.checkupOpenedMonthKey = checkup.value

  return { ok: true, value: result }
}

/**
 * Fields a plan PUT may replace. The monthly checkup mark is written only by
 * POST /api/runway/checkup/opened — echoing it from the client lets a stale
 * totals or setup save clear the dashboard prompt.
 */
export function planValuesForClientWrite(
  values: RunwayPlanValues,
): Omit<RunwayPlanValues, "checkupOpenedMonthKey"> {
  const { checkupOpenedMonthKey, ...writable } = values
  void checkupOpenedMonthKey
  return writable
}
