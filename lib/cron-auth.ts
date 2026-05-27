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

/** Returns a 401 response when cron auth fails; null when the request may proceed. */
export function cronAuthFailureResponse(authHeader: string | null): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!bearerMatches(cronSecret, authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}
