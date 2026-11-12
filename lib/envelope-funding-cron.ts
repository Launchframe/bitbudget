import { detectAchievementsForUser } from "@/lib/achievements"
import { isBudgetAllocationDay } from "@/lib/budget-period"
import {
  creditPaycheckToSavings,
  processMonthlyBudgetAllocations,
} from "@/lib/envelope-funding"
import { sweepDiscretionaryEnvelopesForUser } from "@/lib/envelope-sweep"
import {
  fundingCronUserWhere,
  isGoalMaintenanceDay,
  shouldRunFundingCronForUser,
} from "@/lib/funding-cron-schedule"
import { mapWithConcurrency } from "@/lib/map-with-concurrency"
import { isPaydayForUser, type PaydayUserFields } from "@/lib/payday-cadence"
import { prisma } from "@/lib/db"
import { closePreviousPeriodGoal, openCurrentPeriodGoal } from "@/lib/savings-goal-cron"

/** Max users processed in parallel during envelope funding cron. */
export const ENVELOPE_FUNDING_CRON_CONCURRENCY = 5

type FundingCronUserRow = {
  id: string
  payCadence: string
  payDays: number[]
  payDayOfWeek: number | null
  lastPaydayAt: Date | null
}

export interface EnvelopeFundingCronUserResult {
  goalsClosed: number
  goalsOpened: number
  sweepTransactionsCreated: number
  paycheckCreditsCreated: number
  allocationLegsCreated: number
  /** @deprecated Use paycheckCreditsCreated + allocationLegsCreated */
  fundTransactionsCreated: number
  achievementsDetected: number
}

export interface EnvelopeFundingCronResult extends EnvelopeFundingCronUserResult {
  usersProcessed: number
}

export async function processFundingCronUser(
  u: FundingCronUserRow,
  now: Date,
  goalDay: boolean,
): Promise<EnvelopeFundingCronUserResult> {
  const paydayUser: PaydayUserFields = {
    payCadence: u.payCadence,
    payDays: u.payDays,
    payDayOfWeek: u.payDayOfWeek,
    lastPaydayAt: u.lastPaydayAt,
  }

  const partial: EnvelopeFundingCronUserResult = {
    goalsClosed: 0,
    goalsOpened: 0,
    sweepTransactionsCreated: 0,
    paycheckCreditsCreated: 0,
    allocationLegsCreated: 0,
    fundTransactionsCreated: 0,
    achievementsDetected: 0,
  }

  let goalClosed = false
  let goalOpened = false
  if (goalDay) {
    goalClosed = await closePreviousPeriodGoal(u.id, now)
    if (goalClosed) partial.goalsClosed++

    goalOpened = await openCurrentPeriodGoal(u.id, now)
    if (goalOpened) partial.goalsOpened++
  }

  let sweepCreated = 0
  let paycheckCreated = 0
  let allocCreated = 0

  if (isBudgetAllocationDay(now)) {
    sweepCreated = await sweepDiscretionaryEnvelopesForUser(u.id, now)
    allocCreated = await processMonthlyBudgetAllocations(u.id, now)
    partial.sweepTransactionsCreated += sweepCreated
    partial.allocationLegsCreated += allocCreated
  }

  if (isPaydayForUser(paydayUser, now)) {
    paycheckCreated = await creditPaycheckToSavings(u.id, now)
    partial.paycheckCreditsCreated += paycheckCreated
  }

  partial.fundTransactionsCreated += paycheckCreated + allocCreated

  if (goalClosed || goalOpened || sweepCreated > 0 || paycheckCreated > 0 || allocCreated > 0) {
    partial.achievementsDetected += await detectAchievementsForUser(u.id, now)
  }

  return partial
}

/** Daily cron pipeline per user: close goal → open goal → sweep → fund → achievements. */
export async function processEnvelopeFundingCron(asOf?: Date): Promise<EnvelopeFundingCronResult> {
  const now = asOf ?? new Date()
  const goalDay = isGoalMaintenanceDay(now)
  const users = await prisma.user.findMany({
    where: fundingCronUserWhere(now),
    select: {
      id: true,
      payCadence: true,
      payDays: true,
      payDayOfWeek: true,
      lastPaydayAt: true,
    },
  })

  const candidates = users.filter((u) =>
    shouldRunFundingCronForUser(
      {
        payCadence: u.payCadence,
        payDays: u.payDays,
        payDayOfWeek: u.payDayOfWeek,
        lastPaydayAt: u.lastPaydayAt,
      },
      now,
    ),
  )

  const parts = await mapWithConcurrency(
    candidates,
    ENVELOPE_FUNDING_CRON_CONCURRENCY,
    (u) => processFundingCronUser(u, now, goalDay),
  )

  const result: EnvelopeFundingCronResult = {
    usersProcessed: candidates.length,
    goalsClosed: 0,
    goalsOpened: 0,
    sweepTransactionsCreated: 0,
    paycheckCreditsCreated: 0,
    allocationLegsCreated: 0,
    fundTransactionsCreated: 0,
    achievementsDetected: 0,
  }

  for (const part of parts) {
    result.goalsClosed += part.goalsClosed
    result.goalsOpened += part.goalsOpened
    result.sweepTransactionsCreated += part.sweepTransactionsCreated
    result.paycheckCreditsCreated += part.paycheckCreditsCreated
    result.allocationLegsCreated += part.allocationLegsCreated
    result.fundTransactionsCreated += part.fundTransactionsCreated
    result.achievementsDetected += part.achievementsDetected
  }

  return result
}
