import type { Prisma, SavingsGoal } from "@prisma/client"
import { SAVINGS_GOAL_DEFAULT_PERIOD } from "@/lib/constants"
import { prisma } from "@/lib/db"

export { SAVINGS_GOAL_DEFAULT_PERIOD } from "@/lib/constants"
export const SAVINGS_GOAL_GRACE_DAYS = 7

export type SavingsGoalEditability = "editable" | "upward_only" | "closed"

export function savingsGoalEditability(
  row: Pick<SavingsGoal, "graceEndsAt" | "closedAt" | "periodKey">,
  now = new Date(),
): SavingsGoalEditability {
  if (row.periodKey === SAVINGS_GOAL_DEFAULT_PERIOD) return "editable"
  if (row.closedAt) return "closed"
  if (row.graceEndsAt && now >= row.graceEndsAt) return "upward_only"
  return "editable"
}

export function graceEndsAtForPeriod(params: {
  periodKey: string
  userCreatedAt: Date
}): Date | null {
  if (params.periodKey === SAVINGS_GOAL_DEFAULT_PERIOD) return null
  if (!/^\d{4}-\d{2}$/.test(params.periodKey)) return null
  const [y, m] = params.periodKey.split("-").map(Number)
  const periodStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const signup = params.userCreatedAt
  const base = periodStart.getTime() > signup.getTime() ? periodStart : signup
  const grace = new Date(base)
  grace.setUTCDate(grace.getUTCDate() + SAVINGS_GOAL_GRACE_DAYS)
  return grace
}

export async function resolveSavingsGoalTarget(userId: string, periodKey: string): Promise<number> {
  const explicit = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey } },
  })
  if (explicit) return Number(explicit.targetAmount)

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12)
  const prior = await prisma.savingsGoal.findFirst({
    where: {
      userId,
      periodKey: { not: SAVINGS_GOAL_DEFAULT_PERIOD },
      closedAt: { not: null, gte: twelveMonthsAgo },
    },
    orderBy: { periodKey: "desc" },
  })
  if (prior) return Number(prior.targetAmount)

  const def = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey: SAVINGS_GOAL_DEFAULT_PERIOD } },
  })
  if (def) return Number(def.targetAmount)
  return 0
}

export async function bestMonthHint(
  userId: string,
): Promise<{ amount: number; periodKey: string } | null> {
  const row = await prisma.savingsGoal.findFirst({
    where: {
      userId,
      achievedGoal: true,
      closedAt: { not: null },
      actualSavedAmount: { not: null },
    },
    orderBy: { actualSavedAmount: "desc" },
  })
  if (!row?.actualSavedAmount) return null
  return { amount: Number(row.actualSavedAmount), periodKey: row.periodKey }
}

export function decimalToNumber(v: Prisma.Decimal | null | undefined): number | null {
  if (v == null) return null
  return Number(v)
}
