import { NextRequest, NextResponse } from "next/server"
import { unauthorizedCronResponse } from "@/lib/cron-auth"
import { backfillBtcPrices, fetchBtcPriceHistory } from "@/lib/btc-price"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const cronAuth = unauthorizedCronResponse(req)
  if (cronAuth) return cronAuth

  try {
    await fetchBtcPriceHistory(365)

    let status: "in_progress" | "complete" = "in_progress"
    let chunks = 0

    while (status === "in_progress" && chunks < 5) {
      const result = await backfillBtcPrices()
      status = result.status
      chunks++
    }

    return NextResponse.json({ status, chunks })
  } catch (err) {
    console.error("[cron/btc-backfill] Error:", err)
    return NextResponse.json(
      { error: "Backfill failed", message: String(err) },
      { status: 500 },
    )
  }
}
