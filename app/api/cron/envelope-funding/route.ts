import { NextRequest, NextResponse } from "next/server"
import { unauthorizedCronResponse } from "@/lib/cron-auth"
import { processEnvelopeFundingCron } from "@/lib/envelope-funding-cron"

export async function GET(req: NextRequest) {
  const cronAuth = unauthorizedCronResponse(req)
  if (cronAuth) return cronAuth

  try {
    const result = await processEnvelopeFundingCron()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[cron/envelope-funding] Error:", err)
    return NextResponse.json({ error: "Processing failed" }, { status: 500 })
  }
}
