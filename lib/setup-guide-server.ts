import { prisma } from "@/lib/db"
import {
  SYSTEM_ENVELOPE_ROLE_SAVINGS,
  TX_SOURCE_ENVELOPE_SWEEP,
} from "@/lib/constants"
import type { Envelope } from "@/lib/data"
import { getCurrentMonthKey } from "@/lib/data"
import { MONTHLY_INCOME_SOURCES } from "@/lib/savings-ui-metrics"
import {
  SETUP_GUIDE_ALLOTMENT_EPSILON,
  type SetupGuideTransactionSignals,
} from "@/lib/setup-guide-status"

export type { SetupGuideTransactionSignals }

function monthDateRange(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split("-").map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { start, end }
}

export async function loadSetupGuideTransactionSignals(
  userId: string,
  savingsEnvelopeId: string | undefined,
  monthKey: string = getCurrentMonthKey(),
): Promise<SetupGuideTransactionSignals> {
  const { start, end } = monthDateRange(monthKey)

  const [incomeAgg, anyTxn, sweepTxn] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId,
        excludeFromMainHistory: false,
        type: "credit",
        date: { gte: start, lt: end },
        source: { in: [...MONTHLY_INCOME_SOURCES] },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.findFirst({
      where: {
        userId,
        excludeFromMainHistory: false,
        type: { in: ["expense", "credit"] },
      },
      select: { id: true },
    }),
    savingsEnvelopeId
      ? prisma.transaction.findFirst({
          where: {
            userId,
            excludeFromMainHistory: false,
            type: "credit",
            envelopeId: savingsEnvelopeId,
            source: TX_SOURCE_ENVELOPE_SWEEP,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])

  const fundedSum = Number(incomeAgg._sum.amount ?? 0)
  return {
    hasFundedIncomeThisMonth: fundedSum > SETUP_GUIDE_ALLOTMENT_EPSILON,
    hasAnyTransaction: anyTxn != null,
    hasSweepToSavings: sweepTxn != null,
  }
}

export async function loadSetupGuideEnvelopes(userId: string): Promise<Envelope[]> {
  const rows = await prisma.envelope.findMany({
    where: { userId, archived: false },
    select: {
      id: true,
      name: true,
      monthlyAllotment: true,
      color: true,
      icon: true,
      archived: true,
      systemRole: true,
      sweepPolicy: true,
      sweepCapMultiplier: true,
    },
  })
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    monthlyAllotment: e.monthlyAllotment,
    color: e.color,
    icon: e.icon,
    archived: e.archived,
    systemRole: e.systemRole,
    sweepPolicy: e.sweepPolicy ?? undefined,
    sweepCapMultiplier: e.sweepCapMultiplier != null ? Number(e.sweepCapMultiplier) : null,
  }))
}

export function findSavingsEnvelopeId(envelopes: readonly Envelope[]): string | undefined {
  return envelopes.find((e) => e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)?.id
}
