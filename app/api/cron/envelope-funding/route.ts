import { NextRequest } from "next/server"
import { cronAuthFailureResponse } from "@/lib/cron-auth"
import { processEnvelopeFundingCron } from "@/lib/envelope-funding-cron"
import { processAllRecurringFundingRules } from "@/lib/recurring-funding-processor"
import { runCron } from "@/lib/run-cron"

export async function GET(req: NextRequest) {
  const authFailure = cronAuthFailureResponse(req.headers.get("authorization"))
  if (authFailure) return authFailure

  return runCron("envelope-funding", async () => {
    const result = await processEnvelopeFundingCron()
    const recurringFunding = await processAllRecurringFundingRules()
    return {
      ...result,
      processed: result.usersProcessed,
      recurringFundingRulesProcessed: recurringFunding.rulesProcessed,
      recurringFundingLegsCreated: recurringFunding.legsCreated,
    }
  })
}
