/** Schedule helpers for `RecurringFundingRule.nextRunAt` advancement. */

export const RECURRING_FUNDING_FREQUENCIES = [
  "weekly",
  "bimonthly",
  "monthly",
  "every_2mo",
  "every_3mo",
  "every_6mo",
  "annually",
] as const

export type RecurringFundingFrequency = (typeof RECURRING_FUNDING_FREQUENCIES)[number]

function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + months
  // Clamp the day to the last day of the target month so that e.g. Jan 31 + 1 month
  // → Feb 28 (not March 3 via Date.UTC overflow), preventing monthly rules from
  // silently skipping an entire calendar month.
  const lastDayOfTargetMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const day = Math.min(date.getUTCDate(), lastDayOfTargetMonth)
  return new Date(Date.UTC(y, m, day, 12, 0, 0, 0))
}

export function isRecurringFundingFrequency(value: string): value is RecurringFundingFrequency {
  return (RECURRING_FUNDING_FREQUENCIES as readonly string[]).includes(value)
}

export function nextRunFromFrequency(frequency: string, from: Date): Date {
  switch (frequency) {
    case "weekly":
      return new Date(from.getTime() + 7 * 86_400_000)
    case "bimonthly":
      return new Date(from.getTime() + 14 * 86_400_000)
    case "monthly":
      return addMonthsUtc(from, 1)
    case "every_2mo":
      return addMonthsUtc(from, 2)
    case "every_3mo":
      return addMonthsUtc(from, 3)
    case "every_6mo":
      return addMonthsUtc(from, 6)
    case "annually":
      return addMonthsUtc(from, 12)
    default:
      return addMonthsUtc(from, 1)
  }
}
