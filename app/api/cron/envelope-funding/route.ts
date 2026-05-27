import { NextRequest, NextResponse } from "next/server"
import { isCronRequestAuthorized } from "@/lib/cron-auth"
import { processEnvelopeFundingCron } from "@/lib/envelope-funding-cron"

export async function GET(req: NextRequest) {
  if (!isCronRequestAuthorized(req)) {
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
