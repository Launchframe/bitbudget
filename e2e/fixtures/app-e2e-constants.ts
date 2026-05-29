import { E2E_EMAIL_DOMAIN } from "./referral-e2e-constants"

/** Fully onboarded user with deterministic encryption (see encryption-e2e-constants). */
export const E2E_APP_USER_EMAIL = `e2e-app${E2E_EMAIL_DOMAIN}`

/** Premium OC user for analytics/settings gating. */
export const E2E_PREMIUM_USER_EMAIL = `e2e-premium${E2E_EMAIL_DOMAIN}`

/** Free billing tier with active premium trial (voice/receipt gating). */
export const E2E_TRIAL_USER_EMAIL = `e2e-trial${E2E_EMAIL_DOMAIN}`

export const E2E_APP_ENVELOPE_A = "E2E Groceries"
export const E2E_APP_ENVELOPE_B = "E2E Transport"
export const E2E_APP_TAG = "e2e-tag"
