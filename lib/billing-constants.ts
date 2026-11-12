/** Development-only simulated checkout grants this many days of premium-trial access. */
export const DEV_PREMIUM_SIMULATE_TRIAL_DAYS = 15

/** True when running `next dev` / NODE_ENV=development (never production builds). */
export function isBillingDevSimulateEnabled(): boolean {
  return process.env.NODE_ENV === "development"
}
