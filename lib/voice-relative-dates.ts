import { todayTransactionCalendarDay } from "@/lib/transaction-dates"

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function addLocalCalendarDays(isoDay: string, deltaDays: number): string {
  const [y, m, d] = isoDay.split("-").map(Number)
  const dt = new Date(y!, m! - 1, d!)
  dt.setDate(dt.getDate() + deltaDays)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, "0")
  const dd = String(dt.getDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

/**
 * Resolve relative date phrases in a voice transcript against a known local calendar day.
 * Returns null when the transcript does not mention a supported relative date.
 *
 * Supported: today, tomorrow, yesterday, "{n} days ago"
 */
export function resolveRelativeDateFromTranscript(
  transcript: string,
  todayIso: string,
): string | null {
  const text = transcript.trim().toLowerCase()
  if (!text || !ISO_DAY.test(todayIso)) return null

  const daysAgo = text.match(/\b(\d+)\s+days?\s+ago\b/)
  if (daysAgo) {
    const n = Number(daysAgo[1])
    if (Number.isFinite(n) && n >= 0) return addLocalCalendarDays(todayIso, -n)
  }

  if (/\btoday\b/.test(text)) return todayIso
  if (/\btomorrow\b/.test(text)) return addLocalCalendarDays(todayIso, 1)
  if (/\byesterday\b/.test(text)) return addLocalCalendarDays(todayIso, -1)

  return null
}

/**
 * Pick the transaction calendar day for a voice parse result.
 * Relative phrases in the transcript win over the model date (models often invent dates for "today").
 */
export function resolveVoiceTransactionDate(opts: {
  transcript: string
  /** Client-provided local calendar day; falls back to server local today. */
  clientToday?: string | null
  /** Model-returned YYYY-MM-DD, or null/empty when unspecified. */
  modelDate?: string | null
  now?: Date
}): string {
  const today =
    opts.clientToday && ISO_DAY.test(opts.clientToday)
      ? opts.clientToday
      : todayTransactionCalendarDay(opts.now ?? new Date())

  const fromTranscript = resolveRelativeDateFromTranscript(opts.transcript, today)
  if (fromTranscript) return fromTranscript

  const model = opts.modelDate?.trim() ?? ""
  if (ISO_DAY.test(model)) return model

  return today
}
