import { NextRequest, NextResponse } from "next/server"
import { unauthorizedCronResponse } from "@/lib/cron-auth"
import { processAllRecurringTransactions } from "@/lib/recurring"

export async function GET(req: NextRequest) {
  const cronAuth = unauthorizedCronResponse(req)
  if (cronAuth) return cronAuth

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
