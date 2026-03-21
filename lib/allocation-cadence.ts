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
