import { NextRequest, NextResponse } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { processAllRecurringTransactions } from "@/lib/recurring"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

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
