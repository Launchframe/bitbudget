/** Shared with seed script and Playwright specs — keep in sync. */
export const E2E_EMAIL_DOMAIN = "@bitbudget.test"

export const E2E_EMAIL_CODE = process.env.E2E_EMAIL_CODE?.trim() || "424242"

export const E2E_REFERRER_PREMIUM_EMAIL = `e2e-referrer-premium${E2E_EMAIL_DOMAIN}`
export const E2E_REFERRER_FREE_EMAIL = `e2e-referrer-free${E2E_EMAIL_DOMAIN}`

/** Premium billing referrer → 3-month referee trial after activation */
export const E2E_USER_CODE_PREMIUM_REFERRER = "E2EPREM1"

/** Free-tier referrer → 1-month referee trial after activation */
export const E2E_USER_CODE_FREE_REFERRER = "E2EFREE1"

/** Offer-style slug (lowercase) */
export const E2E_OFFER_SLUG = "e2e-offer-test"

/** maxUses 1, usedCount 1 — validate should reject */
export const E2E_EXHAUSTED_CODE = "E2EXHAUST"
