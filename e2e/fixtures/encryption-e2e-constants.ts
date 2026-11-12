/** Deterministic passphrase + wrapped privacy key for seeded e2e users (Node-generated). */
export const E2E_TEST_PASSPHRASE = "4242"

export const E2E_TEST_PRIVACY_KEY_HEX =
  "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"

export const E2E_TEST_PRIVACY_KEY_SALT_HEX =
  "abababababababababababababababab"

/** JSON blob for `User.encryptedPrivacyKey` (AES-GCM wrap of privacy key with passphrase). */
export const E2E_TEST_ENCRYPTED_PRIVACY_KEY_JSON =
  '{"iv":"010101010101010101010101","ciphertext":"c67a62e38f73227b9867bc17f4f97ef1a9863255f553f6938f88748f3894227200a75a57ac893854df4a27feeb027378"}'
