import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchXbtPriceHistory, getCurrentXbtPrice } from "@/lib/xbt-price"

/** Match BTC’s CoinGecko free-tier window; Neoxa history is shorter today. */
const MAX_HISTORY_DAYS = 365

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const days = searchParams.get("days")

  if (days) {
    const parsed = parseInt(days, 10)
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_HISTORY_DAYS) {
      return NextResponse.json(
        { error: `days must be an integer from 1 to ${MAX_HISTORY_DAYS}` },
        { status: 400 },
      )
    }
    const result = await fetchXbtPriceHistory(parsed)
    return NextResponse.json(result)
  }

  const price = await getCurrentXbtPrice()
  return NextResponse.json({ price })
}
