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

/** True when daily cadence must not run (e.g. production without INTERNAL_PAY_CADENCES). */
export function isDailyCadenceBlocked(
  cadence: string,
  dailyAllowed: boolean = isDailyPayCadenceAllowed(),
): boolean {
  return cadence === "daily" && !dailyAllowed
}

/** Reject persisting `daily` when disallowed. */
export function assertPayCadencePersistable(cadence: string): void {
  if (cadence === "daily" && !isDailyPayCadenceAllowed()) {
    throw new Error("PAY_CADENCE_DAILY_DISABLED")
  }
}
