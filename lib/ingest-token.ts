import { randomBytes, timingSafeEqual } from "node:crypto"

/** 32 random bytes → 64 hex chars for per-user ingest webhooks. */
export function generateIngestToken(): string {
  return randomBytes(32).toString("hex")
}

export function ingestTokenMatches(provided: string, stored: string | null | undefined): boolean {
  if (!stored || !provided) return false
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(stored, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function extractIngestTokenFromRequest(
  authorizationHeader: string | null,
  customHeader: string | null,
): string | null {
  const custom = customHeader?.trim()
  if (custom) return custom
  const auth = authorizationHeader?.trim()
  if (!auth) return null
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)
  return bearer ? bearer[1].trim() : null
}
