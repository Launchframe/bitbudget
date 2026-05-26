import { E2E_EMAIL_DOMAIN } from "./referral-e2e-constants"

export const E2E_ONBOARDING_PASSPHRASE = "4242"

/** Prefix for per-test disposable onboarding users (`${prefix}-${runId}@bitbudget.test`). */
export const E2E_ONBOARDING_EMAIL_PREFIX = "e2e-onb"

export function onboardingTestEmail(suffix: string): string {
  return `${E2E_ONBOARDING_EMAIL_PREFIX}-${suffix}${E2E_EMAIL_DOMAIN}`
}
