/**
 * Client-safe encryption reset constants and parsers.
 * Keep Prisma / DB work in `encryption-reset-server.ts` so Unlock UI can import this safely.
 */

export const ENCRYPTION_RESET_CONFIRM = "RESET"

export type EncryptionResetMode = "encrypted_data" | "all_data"

export function parseEncryptionResetMode(value: unknown): EncryptionResetMode | null {
  if (value === "encrypted_data" || value === "all_data") return value
  return null
}
