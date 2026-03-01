import { NextRequest, NextResponse } from "next/server"
import { processAllRecurringTransactions } from "@/lib/recurring"

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const created = await processAllRecurringTransactions()
    return NextResponse.json({ processed: created })
  } catch (err) {
    console.error("[cron/recurring] Error:", err)
    return NextResponse.json(
      { error: "Processing failed", message: String(err) },
      { status: 500 },
    )
  }
}
