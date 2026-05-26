import nacl from "tweetnacl"
import { publicKeyToHex } from "../../lib/crypto"
import { E2E_EMAIL_DOMAIN } from "./referral-e2e-constants"

/** Seeded user with Monthly Income set — keep in sync with `e2e/seed-income-importer-e2e.ts`. */
export const E2E_INCOME_IMPORT_USER_EMAIL = `e2e-income-import${E2E_EMAIL_DOMAIN}`

/** Seeded user with Monthly Income unset (0) — past-only import tests. */
export const E2E_INCOME_IMPORT_ZERO_MI_EMAIL = `e2e-income-import-zero-mi${E2E_EMAIL_DOMAIN}`

/** Fixed keypair for server-side income import encryption in e2e (not a production secret). */
const E2E_INCOME_IMPORT_SECRET = new Uint8Array(32)
E2E_INCOME_IMPORT_SECRET[31] = 42
const E2E_INCOME_IMPORT_KEYPAIR = nacl.box.keyPair.fromSecretKey(E2E_INCOME_IMPORT_SECRET)

export const E2E_INCOME_IMPORT_PUBLIC_KEY = publicKeyToHex(E2E_INCOME_IMPORT_KEYPAIR.publicKey)

export const INCOME_IMPORTER_DRAFT_KEY = "bitbudget-income-importer-draft"

/** Past-only months for stable paint/import assertions. */
export const E2E_IMPORT_PAST_YEAR = 2023
