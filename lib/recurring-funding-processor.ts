import { Prisma } from "@prisma/client"
import { isBudgetEnvelope, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import { prisma } from "@/lib/db"
import {
  envelopeBalancesAllTimeBatch,
  savingsEnvelopeBalanceAllTime,
} from "@/lib/envelope-balance-server"
import { ensureSystemSavingsEnvelope } from "@/lib/envelope-funding"
import { createRebalanceBatch } from "@/lib/rebalance-envelopes"
import { computeDistribution } from "@/lib/rebalance-math"
import {
  parseRecurringFundingConfig,
  type IncomeDistributionRuleConfig,
  type RebalanceRuleConfig,
} from "@/lib/recurring-funding-config"
import { nextRunFromFrequency } from "@/lib/recurring-funding-schedule"

type DueRuleRow = {
  id: string
  userId: string
  kind: string
  frequency: string
  distributionConfig: Prisma.JsonValue
  nextRunAt: Date
}

export function recurringFundingBatchPeriodKey(ruleId: string, runDateUtc: Date): string {
  const day = runDateUtc.toISOString().split("T")[0]!
  return `recurring-funding-${ruleId}-${day}`
}

async function loadEnvelopesForDistribution(userId: string) {
  const rows = await prisma.envelope.findMany({
    where: {
      userId,
      archived: false,
      OR: [{ systemRole: null }, { systemRole: { not: SYSTEM_ENVELOPE_ROLE_SAVINGS } }],
    },
    select: { id: true, monthlyAllotment: true, systemRole: true },
  })

  const budgetRows = rows.filter((e) => isBudgetEnvelope(e.systemRole))
  // Use all-time balance (credits minus expenses over the envelope's lifetime, including
  // prior-month carryover) so that set_to_budget correctly computes gap = allotment − remaining.
  // Month-scoped balance is negative after the user spends in the current period, causing
  // the gap to be overstated and Savings to be silently over-drained.
  const balances = await envelopeBalancesAllTimeBatch(
    userId,
    budgetRows.map((e) => e.id),
  )

  return budgetRows.map((e) => ({
    id: e.id,
    monthlyAllotment: e.monthlyAllotment,
    currentMonthBalance: balances.get(e.id) ?? 0,
  }))
}

async function executeIncomeDistribution(
  userId: string,
  config: IncomeDistributionRuleConfig,
  runDateUtc: Date,
  periodKey: string,
): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { monthlyIncome: true, publicKey: true },
  })
  if (!user?.publicKey?.trim()) return 0

  const envelopes = await loadEnvelopesForDistribution(userId)
  if (envelopes.length === 0) return 0

  const savings = await ensureSystemSavingsEnvelope(userId)
  const savingsBal = await savingsEnvelopeBalanceAllTime(userId, savings.id)

  const grossUsd =
    typeof config.grossUsd === "number" && config.grossUsd > 0
      ? config.grossUsd
      : user.monthlyIncome

  const customMap = config.customByEnvelopeId
    ? new Map(Object.entries(config.customByEnvelopeId))
    : undefined

  const dist = computeDistribution({
    behavior: config.distributionBehavior,
    envelopes,
    grossUsd,
    savingsBalance: savingsBal,
    fundOverageFromSavings: config.fundOverageFromSavings,
    customByEnvelopeId: customMap,
  })

  if (dist.invalid || dist.lines.length === 0) return 0

  const entries = dist.lines
    .filter((line) => line.deltaUsd > 0.005)
    .map((line) => ({ envelopeId: line.envelopeId, deltaUsd: line.deltaUsd }))

  if (entries.length === 0) return 0

  return createRebalanceBatch(userId, entries, "independent", {
    periodKey,
    runDateUtc,
  })
}

async function executeRebalanceRule(
  userId: string,
  config: RebalanceRuleConfig,
  runDateUtc: Date,
  periodKey: string,
): Promise<number> {
  return createRebalanceBatch(userId, config.entries, config.mode, {
    periodKey,
    runDateUtc,
  })
}

/**
 * Run one due recurring funding rule and advance its schedule.
 * Returns ledger legs created (0 if skipped, invalid, or idempotent duplicate).
 */
export async function processOneRecurringFundingRule(
  rule: DueRuleRow,
  asOf?: Date,
): Promise<number> {
  const runAt = asOf ?? new Date()
  const parsed = parseRecurringFundingConfig(rule.kind, rule.distributionConfig)
  if (!parsed) {
    await prisma.recurringFundingRule.update({
      where: { id: rule.id },
      data: {
        lastRunAt: runAt,
        nextRunAt: nextRunFromFrequency(rule.frequency, runAt),
      },
    })
    return 0
  }

  const periodKey = recurringFundingBatchPeriodKey(rule.id, runAt)
  let legs = 0

  if (parsed.kind === "income_distribution") {
    legs = await executeIncomeDistribution(rule.userId, parsed.config, runAt, periodKey)
  } else {
    legs = await executeRebalanceRule(rule.userId, parsed.config, runAt, periodKey)
  }

  await prisma.recurringFundingRule.update({
    where: { id: rule.id },
    data: {
      lastRunAt: runAt,
      nextRunAt: nextRunFromFrequency(rule.frequency, runAt),
    },
  })

  return legs
}

/**
 * Process all enabled rules due on or before the end of `asOf`'s UTC calendar day.
 */
export async function processRecurringFundingRules(
  userId: string,
  asOf?: Date,
): Promise<number> {
  const endOfDay = new Date(asOf ?? new Date())
  endOfDay.setUTCHours(23, 59, 59, 999)

  const due = await prisma.recurringFundingRule.findMany({
    where: {
      userId,
      enabled: true,
      nextRunAt: { lte: endOfDay },
    },
    orderBy: { nextRunAt: "asc" },
  })

  let totalLegs = 0
  for (const rule of due) {
    totalLegs += await processOneRecurringFundingRule(rule, asOf)
  }
  return totalLegs
}

/** Cron entry: all users with due recurring funding rules. */
export async function processAllRecurringFundingRules(asOf?: Date): Promise<{
  rulesProcessed: number
  legsCreated: number
}> {
  const endOfDay = new Date(asOf ?? new Date())
  endOfDay.setUTCHours(23, 59, 59, 999)

  const due = await prisma.recurringFundingRule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: endOfDay },
    },
    orderBy: [{ userId: "asc" }, { nextRunAt: "asc" }],
  })

  let legsCreated = 0
  for (const rule of due) {
    legsCreated += await processOneRecurringFundingRule(rule, asOf)
  }

  return { rulesProcessed: due.length, legsCreated }
}
