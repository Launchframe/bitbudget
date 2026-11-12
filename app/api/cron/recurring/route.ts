import { NextRequest } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { processAllRecurringTransactions } from "@/lib/recurring"
import { runCron } from "@/lib/run-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("recurring", async () => {
    const processed = await processAllRecurringTransactions()
    return { processed }
  })
}
