import { NextRequest, NextResponse } from "next/server"
import { isCronRequestAuthorized } from "@/lib/cron-auth"
import { processAllRecurringTransactions } from "@/lib/recurring"

export async function GET(req: NextRequest) {
  if (!isCronRequestAuthorized(req)) {
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
