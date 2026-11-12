import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import {
  isBudgetEnvelope,
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  TX_SOURCE_ENVELOPE_SWEEP,
  TX_SOURCE_INCOME_IMPORT,
} from "@/lib/constants"
import {
  envelopeBalancesBeforeMonthEndsBatch,
  monthKeyFromDate,
  savingsEnvelopeBalanceAllTime,
} from "@/lib/envelope-balance-server"
import { TX_SOURCE_IRREGULAR_INCOME } from "@/lib/constants"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import { currentGoalStreakFromClosed } from "@/lib/savings-goal-streak"

export const ACHIEVEMENT_CODES = [
  "first_dollar",
  "first_hundred",
  "first_thousand",
  "first_ten_thousand",
  "first_hundred_thousand",
  "goal_hit",
  "streak_3",
  "streak_6",
  "streak_12",
  "over_saver",
  "swept_first",
  "swept_clean_month",
  "irregular_income_first",
  "import_complete",
  "year_one",
  "setup_allocations",
  "setup_plaid",
  "setup_receipt_inbox",
  "setup_account_email",
] as const

export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number]

const BALANCE_THRESHOLDS: Array<{ code: AchievementCode; min: number }> = [
  { code: "first_dollar", min: 0.01 },
  { code: "first_hundred", min: 100 },
  { code: "first_thousand", min: 1000 },
  { code: "first_ten_thousand", min: 10_000 },
  { code: "first_hundred_thousand", min: 100_000 },
]

const STREAK_CODES: Array<{ code: AchievementCode; length: number }> = [
  { code: "streak_3", length: 3 },
  { code: "streak_6", length: 6 },
  { code: "streak_12", length: 12 },
]

/** Max closed months to load end-of-period envelope balances for swept_clean_month. */
const SWEPT_CLEAN_MONTH_BALANCE_LOOKBACK = 24

/** Max closed goal rows scanned for streak / goal achievements. */
const GOAL_ACHIEVEMENT_LOOKBACK_MONTHS = 36

function minPeriodKeyMonthsAgo(months: number, asOf: Date): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (months - 1), 1))
  return monthKeyFromDate(d)
}

/** Idempotent insert; returns true when a new row was created. */
export async function awardIfMissing(
  userId: string,
  code: string,
  metadata?: Prisma.InputJsonValue,
): Promise<boolean> {
  try {
    await prisma.userAchievement.create({
      data: { userId, code, metadata: metadata ?? undefined },
    })
    return true
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return false
    }
    throw e
  }
}

export function computeGoalStreakFromClosed(
  closedGoals: Array<{ periodKey: string; achievedGoal: boolean | null }>,
): number {
  return currentGoalStreakFromClosed(closedGoals)
}

async function detectBalanceAchievements(userId: string, balance: number): Promise<number> {
  let awarded = 0
  for (const { code, min } of BALANCE_THRESHOLDS) {
    if (balance >= min) {
      if (await awardIfMissing(userId, code, { balance })) awarded++
    }
  }
  return awarded
}

async function detectGoalAchievements(userId: string, asOf: Date): Promise<number> {
  let awarded = 0
  const minPeriodKey = minPeriodKeyMonthsAgo(GOAL_ACHIEVEMENT_LOOKBACK_MONTHS, asOf)
  const closed = await prisma.savingsGoal.findMany({
    where: {
      userId,
      closedAt: { not: null },
      periodKey: { not: "default", gte: minPeriodKey },
    },
    select: {
      periodKey: true,
      achievedGoal: true,
      progressPct: true,
      closedAt: true,
    },
    orderBy: { periodKey: "desc" },
  })

  if (closed.some((g) => g.achievedGoal === true)) {
    if (await awardIfMissing(userId, "goal_hit")) awarded++
  }

  if (closed.some((g) => g.progressPct != null && Number(g.progressPct) >= 1.5)) {
    if (await awardIfMissing(userId, "over_saver")) awarded++
  }

  const streak = computeGoalStreakFromClosed(
    closed.map((g) => ({ periodKey: g.periodKey, achievedGoal: g.achievedGoal })),
  )
  for (const { code, length } of STREAK_CODES) {
    if (streak >= length) {
      if (await awardIfMissing(userId, code, { streak })) awarded++
    }
  }

  const budgetEnvelopes = await prisma.envelope.findMany({
    where: {
      userId,
      archived: false,
      OR: [{ systemRole: null }, { systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS } }],
    },
    select: { id: true, systemRole: true },
  })
  const budgetIds = budgetEnvelopes.filter((e) => isBudgetEnvelope(e.systemRole)).map((e) => e.id)

  const closedMonthKeys = [
    ...new Set(
      closed.map((g) => g.periodKey).filter((pk) => /^\d{4}-\d{2}$/.test(pk)),
    ),
  ]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, SWEPT_CLEAN_MONTH_BALANCE_LOOKBACK)

  const balancesByMonth =
    budgetIds.length > 0 && closedMonthKeys.length > 0
      ? await envelopeBalancesBeforeMonthEndsBatch(userId, budgetIds, closedMonthKeys)
      : new Map<string, Map<string, number>>()

  for (const goal of closed) {
    if (!/^\d{4}-\d{2}$/.test(goal.periodKey)) continue
    const balances = balancesByMonth.get(goal.periodKey)
    if (!balances || budgetIds.length === 0) continue
    let allClean = true
    for (const envId of budgetIds) {
      if ((balances.get(envId) ?? 0) > 0.01) {
        allClean = false
        break
      }
    }
    if (allClean) {
      if (await awardIfMissing(userId, "swept_clean_month", { periodKey: goal.periodKey })) {
        awarded++
        break
      }
    }
  }

  return awarded
}

async function detectTransactionAchievements(userId: string, savingsId: string): Promise<number> {
  let awarded = 0

  const sweepCount = await prisma.transaction.count({
    where: {
      userId,
      envelopeId: savingsId,
      type: "credit",
      source: TX_SOURCE_ENVELOPE_SWEEP,
    },
  })
  if (sweepCount > 0 && (await awardIfMissing(userId, "swept_first"))) awarded++

  const irregularCount = await prisma.transaction.count({
    where: {
      userId,
      envelopeId: savingsId,
      type: "credit",
      source: TX_SOURCE_IRREGULAR_INCOME,
    },
  })
  if (irregularCount > 0 && (await awardIfMissing(userId, "irregular_income_first"))) awarded++

  const importCount = await prisma.transaction.count({
    where: {
      userId,
      envelopeId: savingsId,
      type: "credit",
      source: TX_SOURCE_INCOME_IMPORT,
    },
  })
  if (importCount > 0 && (await awardIfMissing(userId, "import_complete"))) awarded++

  return awarded
}

export type SetupGuideAchievementFlags = {
  allocations: boolean
  accountEmail: boolean
  plaid: boolean
  receiptInbox: boolean
}

export async function awardSetupGuideAchievements(
  userId: string,
  flags: SetupGuideAchievementFlags,
): Promise<number> {
  let awarded = 0
  if (flags.allocations && (await awardIfMissing(userId, "setup_allocations"))) awarded++
  if (flags.accountEmail && (await awardIfMissing(userId, "setup_account_email"))) awarded++
  if (flags.plaid && (await awardIfMissing(userId, "setup_plaid"))) awarded++
  if (flags.receiptInbox && (await awardIfMissing(userId, "setup_receipt_inbox"))) awarded++
  return awarded
}

/**
 * Scan Savings goals and transactions; award any newly earned achievements.
 * Returns count of achievements newly awarded.
 */
export async function detectAchievementsForUser(userId: string, asOf?: Date): Promise<number> {
  const now = asOf ?? new Date()
  let awarded = 0

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  })
  if (!user) return 0

  const savings = await ensureSystemSavingsEnvelope(userId)
  const balance = await savingsEnvelopeBalanceAllTime(userId, savings.id)

  awarded += await detectBalanceAchievements(userId, balance)
  awarded += await detectGoalAchievements(userId, now)
  awarded += await detectTransactionAchievements(userId, savings.id)

  const oneYearMs = 365 * 24 * 60 * 60 * 1000
  if (now.getTime() - user.createdAt.getTime() >= oneYearMs) {
    if (await awardIfMissing(userId, "year_one")) awarded++
  }

  return awarded
}
