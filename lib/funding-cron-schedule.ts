import type { Prisma } from "@prisma/client"
import { isFundingDayForUser } from "@/lib/pay-cadence-server"
import type { PaydayUserFields } from "@/lib/payday-cadence"

/** UTC calendar 1st — close prior month goal and open current month goal. */
export function isGoalMaintenanceDay(runDateUtc: Date): boolean {
  return runDateUtc.getUTCDate() === 1
}

/** True when this user may need goal, sweep, or fund work on the cron run date. */
export function shouldRunFundingCronForUser(
  user: PaydayUserFields,
  runDateUtc: Date,
): boolean {
  if (isGoalMaintenanceDay(runDateUtc)) return true
  return isFundingDayForUser(user, runDateUtc)
}

/** Narrows the user query: irregular/mixed never auto-fund; skip them on non–goal days. */
export function fundingCronUserWhere(runDateUtc: Date): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    publicKey: { not: null },
    NOT: { publicKey: "" },
  }
  if (isGoalMaintenanceDay(runDateUtc)) return base
  return {
    ...base,
    payCadence: { notIn: ["irregular", "mixed"] },
  }
}
