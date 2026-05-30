import { NextRequest } from "next/server"
import { backfillBtcPrices, fetchBtcPriceHistory } from "@/lib/btc-price"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { runCron } from "@/lib/run-cron"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("btc-backfill", async () => {
    await fetchBtcPriceHistory(365)

    let status: "in_progress" | "complete" = "in_progress"
    let chunks = 0

    while (status === "in_progress" && chunks < 5) {
      const result = await backfillBtcPrices()
      status = result.status
      chunks++
    }

    return { status, chunks }
  })
}
