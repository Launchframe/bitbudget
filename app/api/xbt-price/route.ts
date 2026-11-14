import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { fetchXbtPriceHistory, getCurrentXbtPrice } from "@/lib/xbt-price"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const days = searchParams.get("days")

  if (days) {
    const parsed = parseInt(days, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "days must be a positive integer" }, { status: 400 })
    }
    const result = await fetchXbtPriceHistory(parsed)
    return NextResponse.json(result)
  }

  const price = await getCurrentXbtPrice()
  return NextResponse.json({ price })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { count } = await prisma.xbtPriceCache.deleteMany({})
  return NextResponse.json({ cleared: count })
}
