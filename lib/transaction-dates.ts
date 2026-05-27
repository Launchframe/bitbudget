import { parseIsoDateLocal } from "@/lib/chart-x-axis-format"
import { parseTransactionQueryCalendarDate } from "@/lib/transaction-query-dates"

const ISO_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/** True when the value is a calendar day only (`YYYY-MM-DD`), not a full timestamp. */
export function isCalendarDateOnly(value: string): boolean {
  return ISO_CALENDAR_DAY.test(value)
}

/** Store a calendar day at local noon (avoids UTC-midnight off-by-one). */
export function calendarDateToStorageInstant(isoDate: string): Date {
  return parseIsoDateLocal(isoDate)
}

/** True when the DB instant is a date-only value (legacy UTC midnight or local noon). */
export function isDateOnlyStorageInstant(d: Date): boolean {
  const iso = d.toISOString()
  if (iso.endsWith("T00:00:00.000Z")) return true
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const cal = `${y}-${m}-${day}`
  return d.getTime() === parseIsoDateLocal(cal).getTime()
}

function dateOnlyStorageCalendarDay(d: Date): string {
  const iso = d.toISOString()
  if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10)
  return transactionCalendarDayFromDate(d)
}

/**
 * Parse client/API transaction date input for DB storage.
 * Calendar days use local noon; full ISO strings use the instant.
 */
export function parseTransactionDateInput(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (isCalendarDateOnly(trimmed)) {
    if (parseTransactionQueryCalendarDate(trimmed) == null) return null
    return calendarDateToStorageInstant(trimmed)
  }
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Serialize a stored transaction `DateTime` for API/client (preserve real capture times). */
export function serializeTransactionDateForClient(d: Date): string {
  if (isDateOnlyStorageInstant(d)) {
    return dateOnlyStorageCalendarDay(d)
  }
  return d.toISOString()
}

function transactionCalendarDayFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Local calendar day `YYYY-MM-DD` for filters, month keys, and date inputs. */
export function transactionCalendarDay(value: string): string {
  if (isCalendarDateOnly(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  if (isDateOnlyStorageInstant(d)) return dateOnlyStorageCalendarDay(d)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Current local calendar day for transaction date inputs. */
export function todayTransactionCalendarDay(now = new Date()): string {
  return transactionCalendarDay(now.toISOString())
}

/** Value for `<input type="date" />` from a transaction date string. */
export function dateInputValueFromTransactionDate(value: string): string {
  return transactionCalendarDay(value)
}

/**
 * When the user edits the calendar day on a datetime transaction, keep the local time-of-day.
 */
export function mergeCalendarDayIntoTransactionDate(
  existing: string,
  newCalendarDay: string,
): string {
  if (!isCalendarDateOnly(newCalendarDay)) return newCalendarDay
  if (isCalendarDateOnly(existing)) return newCalendarDay
  const d = new Date(existing)
  if (Number.isNaN(d.getTime())) return newCalendarDay
  const [y, m, day] = newCalendarDay.split("-").map(Number)
  if (y == null || m == null || day == null) return newCalendarDay
  d.setFullYear(y, m - 1, day)
  return d.toISOString()
}

/** Table/list: calendar date only, timezone-safe (no UTC off-by-one). */
export function formatTransactionTableDate(
  value: string,
  locale = "en-US",
): string {
  const day = transactionCalendarDay(value)
  return parseIsoDateLocal(day).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Detail view: full local date and time when a timestamp is stored; otherwise date only. */
export function formatTransactionDetailDateTime(
  value: string,
  locale = "en-US",
): string {
  if (isCalendarDateOnly(value)) {
    return parseIsoDateLocal(value).toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    return formatTransactionDetailDateTime(transactionCalendarDay(value), locale)
  }
  if (isDateOnlyStorageInstant(d)) {
    return parseIsoDateLocal(dateOnlyStorageCalendarDay(d)).toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  }
  return d.toLocaleString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function transactionDateFromDb(d: Date): string {
  return serializeTransactionDateForClient(d)
}

/**
 * Receipt photo prefill: OCR calendar day when available, local capture time from file metadata.
 */
export function receiptCapturePrefillDate(ocrCalendarDay: string, fileLastModifiedMs: number): string {
  if (fileLastModifiedMs <= 0) return ocrCalendarDay
  const captured = new Date(fileLastModifiedMs)
  if (isCalendarDateOnly(ocrCalendarDay)) {
    const [y, m, day] = ocrCalendarDay.split("-").map(Number)
    if (y != null && m != null && day != null) {
      captured.setFullYear(y, m - 1, day)
      return captured.toISOString()
    }
  }
  if (ocrCalendarDay) {
    const parsed = parseTransactionDateInput(ocrCalendarDay)
    if (parsed) return parsed.toISOString()
  }
  return captured.toISOString()
}
