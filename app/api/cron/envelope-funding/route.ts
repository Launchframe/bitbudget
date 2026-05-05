import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { processAllEnvelopeFunding } from "@/lib/envelope-funding"

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

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret == null || cronSecret === "") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!bearerMatches(cronSecret, req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const created = await processAllEnvelopeFunding()
    return NextResponse.json({ processed: created })
  } catch (err) {
    console.error("[cron/envelope-funding] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
