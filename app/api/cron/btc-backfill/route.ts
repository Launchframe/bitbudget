import { NextRequest, NextResponse } from "next/server"
import { backfillBtcPrices, fetchBtcPriceHistory } from "@/lib/btc-price"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
