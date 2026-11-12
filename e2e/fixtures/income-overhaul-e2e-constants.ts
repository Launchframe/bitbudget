import { E2E_EMAIL_DOMAIN } from "./referral-e2e-constants"
import { E2E_INCOME_IMPORT_PUBLIC_KEY } from "./income-importer-e2e-constants"

/** Primary income-overhaul e2e user (pay on 15th, discretionary envelopes with allotments). */
export const E2E_INCOME_OVERHAUL_EMAIL = `e2e-income-overhaul${E2E_EMAIL_DOMAIN}`

/** Same pay cadence but zero monthly envelope allotments — income stays in Savings. */
export const E2E_INCOME_OVERHAUL_ZERO_ALLOC_EMAIL = `e2e-income-overhaul-zero${E2E_EMAIL_DOMAIN}`

export const E2E_OVERHAUL_ENVELOPE_A = "E2E Overhaul Groceries"
export const E2E_OVERHAUL_ENVELOPE_B = "E2E Overhaul Transport"

/** Server-side encryption for paycheck / irregular income in e2e. */
export const E2E_OVERHAUL_PUBLIC_KEY = E2E_INCOME_IMPORT_PUBLIC_KEY
