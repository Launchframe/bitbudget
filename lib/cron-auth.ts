import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

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
 * Validates `Authorization: Bearer <CRON_SECRET>` for cron routes.
 * Returns a 401 response when the secret is unset or the header does not match.
 */
export function unauthorizedCronResponse(req: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret == null || cronSecret === "") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!bearerMatches(cronSecret, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}
