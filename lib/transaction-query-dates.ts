const ISO_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse `YYYY-MM-DD` as a UTC calendar date for API query bounds.
 * Rejects malformed strings, full ISO timestamps, and invalid calendar days (e.g. 2025-02-30).
 */
export function parseTransactionQueryCalendarDate(value: string): Date | null {
  if (!ISO_CALENDAR_DAY.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  if (d.toISOString().slice(0, 10) !== value) return null
  return d
}

/** Inclusive UTC end-of-day for a validated calendar `YYYY-MM-DD`. */
export function utcEndOfCalendarDay(isoDate: string): Date | null {
  if (parseTransactionQueryCalendarDate(isoDate) == null) return null
  const d = new Date(`${isoDate}T23:59:59.999Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
