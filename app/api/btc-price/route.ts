import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { fetchBtcPriceHistory, getCurrentBtcPrice } from "@/lib/btc-price"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const days = searchParams.get("days")

  // Primary endpoint: fetch history + current price in one call
  // GET /api/btc-price?days=730
  if (days) {
    const result = await fetchBtcPriceHistory(parseInt(days, 10))
    return NextResponse.json(result)
  }

  // Lightweight: just current price
  // GET /api/btc-price
  const price = await getCurrentBtcPrice()
  return NextResponse.json({ price })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { count } = await prisma.btcPriceCache.deleteMany({})
  return NextResponse.json({ cleared: count })
}
