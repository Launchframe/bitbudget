import { NextRequest, NextResponse } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { processEnvelopeFundingCron } from "@/lib/envelope-funding-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  try {
    const result = await processEnvelopeFundingCron()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[cron/envelope-funding] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
