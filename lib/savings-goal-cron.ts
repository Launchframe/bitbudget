import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  monthKeyFromDate,
  netSavingsInflowForPeriod,
  periodBoundsUtc,
  savingsEnvelopeBalanceBefore,
} from "@/lib/envelope-balance-server"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import {
  graceEndsAtForPeriod,
  resolveSavingsGoalTarget,
  SAVINGS_GOAL_DEFAULT_PERIOD,
} from "@/lib/savings-goal"

export function previousMonthKey(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey
  const [y, m] = monthKey.split("-").map(Number)
  const prev = new Date(Date.UTC(y, m - 2, 1))
  return monthKeyFromDate(prev)
}

export function computeCloseSnapshots(params: {
  startBalance: number
  endBalance: number
  netSavingsInflow: number
  targetAmount: number
}): {
  actualSavedAmount: number
  netSavingsInflow: number
  achievedGoal: boolean
  progressPct: number | null
} {
  const actualSavedAmount = Math.round((params.endBalance - params.startBalance) * 100) / 100
  const netSavingsInflow = params.netSavingsInflow
  const achievedGoal = actualSavedAmount >= params.targetAmount
  const progressPct =
    params.targetAmount > 0
      ? Math.round((actualSavedAmount / params.targetAmount) * 10_000) / 10_000
      : null
  return { actualSavedAmount, netSavingsInflow, achievedGoal, progressPct }
}

/**
 * Close the prior calendar month's goal row if still open.
 * Returns true when a row was closed.
 */
export async function closePreviousPeriodGoal(userId: string, todayUtc?: Date): Promise<boolean> {
  const now = todayUtc ?? new Date()
  const currentKey = monthKeyFromDate(now)
  const priorKey = previousMonthKey(currentKey)

  const row = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey: priorKey } },
  })
  if (!row || row.closedAt != null || row.startBalance == null) return false

  const bounds = periodBoundsUtc(priorKey)
  if (!bounds) return false

  const savings = await ensureSystemSavingsEnvelope(userId)
  const endBalance = await savingsEnvelopeBalanceBefore(userId, savings.id, bounds.end)
  const startBalance = Number(row.startBalance)
  const netInflow = await netSavingsInflowForPeriod(userId, savings.id, priorKey)
  const targetAmount = Number(row.targetAmount)
  const snapshots = computeCloseSnapshots({
    startBalance,
    endBalance,
    netSavingsInflow: netInflow,
    targetAmount,
  })

  await prisma.savingsGoal.update({
    where: { id: row.id },
    data: {
      closedAt: now,
      endBalance: new Prisma.Decimal(endBalance),
      actualSavedAmount: new Prisma.Decimal(snapshots.actualSavedAmount),
      netSavingsInflow: new Prisma.Decimal(snapshots.netSavingsInflow),
      achievedGoal: snapshots.achievedGoal,
      progressPct:
        snapshots.progressPct != null ? new Prisma.Decimal(snapshots.progressPct) : null,
    },
  })
  return true
}

/**
 * Open the current calendar month's goal row (idempotent once startBalance is set).
 * Returns true when a row was opened or finalized for the period.
 */
export async function openCurrentPeriodGoal(userId: string, todayUtc?: Date): Promise<boolean> {
  const now = todayUtc ?? new Date()
  const periodKey = monthKeyFromDate(now)
  if (periodKey === SAVINGS_GOAL_DEFAULT_PERIOD) return false

  const existing = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey } },
  })
  if (existing?.startBalance != null) return false

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  })
  if (!user) return false

  const savings = await ensureSystemSavingsEnvelope(userId)

  const [y, m] = periodKey.split("-").map(Number)
  const periodStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const baseInstant =
    periodStart.getTime() > user.createdAt.getTime() ? periodStart : user.createdAt
  const startBalance = await savingsEnvelopeBalanceBefore(userId, savings.id, baseInstant)
  const targetAmount =
    existing != null
      ? Number(existing.targetAmount)
      : await resolveSavingsGoalTarget(userId, periodKey)
  const graceEndsAt = graceEndsAtForPeriod({ periodKey, userCreatedAt: user.createdAt })

  if (existing) {
    await prisma.savingsGoal.update({
      where: { id: existing.id },
      data: {
        startBalance: new Prisma.Decimal(startBalance),
        graceEndsAt,
        targetAmount: new Prisma.Decimal(targetAmount),
      },
    })
    return true
  }

  await prisma.savingsGoal.create({
    data: {
      userId,
      periodKey,
      targetAmount: new Prisma.Decimal(targetAmount),
      graceEndsAt,
      startBalance: new Prisma.Decimal(startBalance),
    },
  })
  return true
}
