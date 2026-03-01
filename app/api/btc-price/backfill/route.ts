import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { backfillBtcPrices } from "@/lib/btc-price"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await backfillBtcPrices()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[btc-price/backfill] Error:", err)
    return NextResponse.json(
      { error: "Backfill chunk failed", message: String(err) },
      { status: 502 },
    )
  }
}
