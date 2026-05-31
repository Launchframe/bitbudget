/** Per-envelope allocation cadence in onboarding (amount in field is in these units). */
export type AllocationCadence = "weekly" | "biweekly" | "monthly"

const CADENCE_MULTIPLIERS: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
}

export function toMonthly(amount: number, cadence: string): number {
  return Math.round(amount * (CADENCE_MULTIPLIERS[cadence] ?? 1) * 100) / 100
}

export function fromMonthly(monthly: number, cadence: string): number {
  const mult = CADENCE_MULTIPLIERS[cadence] ?? 1
  return Math.round((monthly / mult) * 100) / 100
}

/** Integer string shown in the allocation text field (empty when no monthly amount). */
export function cadenceDisplayInteger(monthlyAllotment: number, cadence: string): string {
  if (monthlyAllotment <= 0) return ""
  return String(Math.round(fromMonthly(monthlyAllotment, cadence)))
}

/**
 * Strip non-digits and compute stored monthly allotment from the user's cadence-scaled amount.
 * Does not apply slider $50 snapping — use for manual typing only.
 */
export function monthlyFromDigitOnlyInput(
  rawInput: string,
  cadence: AllocationCadence,
  sliderMax: number,
): number {
  const digits = rawInput.replace(/\D/g, "")
  if (digits === "") return 0

  const cadenceMax = fromMonthly(sliderMax, cadence)
  const maxWhole = Math.max(0, Math.floor(cadenceMax + 1e-9))

  let cadenceAmount = parseInt(digits, 10)
  if (!Number.isFinite(cadenceAmount) || cadenceAmount < 0) cadenceAmount = 0
  cadenceAmount = Math.min(cadenceAmount, maxWhole)

  const monthly = Math.round(toMonthly(cadenceAmount, cadence))
  return Math.min(sliderMax, Math.max(0, monthly))
}

/** Round to nearest cent (USD). */
export function roundMoneyCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100) / 100
}

/** Display string for an allotment text field (empty when zero). */
export function formatAllotmentInputDisplay(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return ""
  const rounded = roundMoneyCents(amount)
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(2)
}

/**
 * Parse in-progress money input while typing. Returns null when the field is empty
 * or only a decimal point — do not snap or overwrite the draft string in that case.
 */
export function parsePartialMoneyInput(rawInput: string): number | null {
  const trimmed = rawInput.trim()
  if (trimmed === "" || trimmed === ".") return null

  const cleaned = trimmed.replace(/[^0-9.]/g, "")
  if (cleaned === "" || cleaned === ".") return null

  const dotIdx = cleaned.indexOf(".")
  if (dotIdx !== -1 && cleaned.indexOf(".", dotIdx + 1) !== -1) return null

  const parts = cleaned.split(".")
  if (parts.length > 2) return null
  const frac = parts[1] ?? ""
  if (frac.length > 2) return null

  const n = parseFloat(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/** Commit a money text field to a monthly allotment clamped to `[0, max]` (penny precision). */
export function monthlyFromMoneyInput(rawInput: string, max: number): number {
  const parsed = parsePartialMoneyInput(rawInput)
  if (parsed === null) return 0
  const capped = Math.min(max, Math.max(0, roundMoneyCents(parsed)))
  return capped
}
