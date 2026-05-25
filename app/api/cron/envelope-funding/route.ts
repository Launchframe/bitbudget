import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  processEnvelopeFundingCron,
  type EnvelopeFundingCronResult,
} from "@/lib/envelope-funding-cron"

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

export type { EnvelopeFundingCronResult }

export { processEnvelopeFundingCron } from "@/lib/envelope-funding-cron"

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret == null || cronSecret === "") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!bearerMatches(cronSecret, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await processEnvelopeFundingCron()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[cron/envelope-funding] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
