import { timingSafeEqual } from "crypto"

function bearerMatches(secret: string, authHeader: string | null): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8")
  const received = Buffer.from(authHeader ?? "", "utf8")
  if (expected.length !== received.length) return false
  try {
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

/**
 * Validates `Authorization: Bearer <CRON_SECRET>` for scheduled job routes.
 * Returns false when CRON_SECRET is unset or empty (never accept `Bearer undefined`).
 */
export function isCronRequestAuthorized(req: { headers: Headers }): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret == null || cronSecret === "") {
    return false
  }
  return bearerMatches(cronSecret, req.headers.get("authorization"))
}
