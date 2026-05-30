import { NextRequest } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { processEnvelopeFundingCron } from "@/lib/envelope-funding-cron"
import { runCron } from "@/lib/run-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("envelope-funding", async () => {
    const result = await processEnvelopeFundingCron()
    return { ...result, processed: result.usersProcessed }
  })
}
