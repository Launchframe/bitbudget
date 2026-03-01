import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCurrentBtcPrice, getBtcPriceOnDate, fetchBtcPriceRange } from "@/lib/btc-price"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const date = searchParams.get("date")
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  if (from && to) {
    const prices = await fetchBtcPriceRange(from, to)
    return NextResponse.json({ prices })
  }

  if (date) {
    const price = await getBtcPriceOnDate(date)
    return NextResponse.json({ date, price })
  }

  const price = await getCurrentBtcPrice()
  return NextResponse.json({ price })
}
