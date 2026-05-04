/**
 * Pay cadence helpers — server-only (`NODE_ENV`, optional env flags).
 */

/** Whether `daily` pay cadence may be stored or honored (never in production unless explicitly flagged). */
export function isDailyPayCadenceAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.INTERNAL_PAY_CADENCES === "true"
  )
}

/** Reject persisting `daily` when disallowed. */
export function assertPayCadencePersistable(cadence: string): void {
  if (cadence === "daily" && !isDailyPayCadenceAllowed()) {
    throw new Error("PAY_CADENCE_DAILY_DISABLED")
  }
}
