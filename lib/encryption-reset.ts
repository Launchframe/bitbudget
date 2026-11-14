/**
 * Client-safe encryption reset constants and parsers.
 * Keep Prisma / DB work in `encryption-reset-server.ts` so Unlock UI can import this safely.
 */

export const ENCRYPTION_RESET_CONFIRM = "RESET"

/** Shown when IndexedDB still holds pre-reset history and must be wiped before a new passphrase. */
export const LOCAL_HISTORY_WIPE_FAILED =
  "Could not clear local history (another tab may be open). Close other BitBudget tabs and try again — do not continue until this succeeds."

export type EncryptionResetMode = "encrypted_data" | "all_data"

/**
 * Auth.js names the session cookie from the configured auth URL protocol
 * (`__Secure-` on https). `getToken({ secureCookie })` must use the same flag
 * or production resets never see `iat` and always return REAUTH_REQUIRED.
 */
export function authSessionCookieIsSecure(input: {
  authUrl?: string | null
  nextAuthUrl?: string | null
  forwardedProto?: string | null
  requestProtocol?: string | null
}): boolean {
  const envUrl = input.authUrl?.trim() || input.nextAuthUrl?.trim()
  if (envUrl) {
    try {
      return new URL(envUrl).protocol === "https:"
    } catch {
      return false
    }
  }
  const raw =
    input.forwardedProto?.split(",")[0]?.trim() ||
    input.requestProtocol ||
    "https"
  const proto = raw.endsWith(":") ? raw.slice(0, -1) : raw
  return proto.toLowerCase() === "https"
}

export function parseEncryptionResetMode(value: unknown): EncryptionResetMode | null {
  if (value === "encrypted_data" || value === "all_data") return value
  return null
}
