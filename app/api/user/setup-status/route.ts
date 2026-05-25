import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  awardSetupGuideAchievements,
  detectAchievementsForUser,
} from "@/lib/achievements"
import type { Envelope, Transaction, TransactionSource } from "@/lib/data"
import { getCurrentMonthKey } from "@/lib/data"
import {
  computeSetupGuideTasks,
  setupGuideProgress,
  type SetupGuideClientInput,
} from "@/lib/setup-guide-status"
import { requirePremiumOrTrial } from "@/lib/subscription"

const RECEIPT_INBOX_SOURCES = ["email_forward"] as const

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const now = new Date()
  const monthKey = getCurrentMonthKey()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      monthlyIncome: true,
      email: true,
      emailVerified: true,
      setupGuideSnoozedUntil: true,
      setupGuideDismissed: true,
      setupGuideShowOnDashboard: true,
      subscriptionTier: true,
      premiumGratisUntil: true,
      premiumTrialUntil: true,
    },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const hasPremiumFeatures = await requirePremiumOrTrial(userId)

  const [envelopes, transactions, savingsGoal, plaidCount, receiptPending] = await Promise.all([
    prisma.envelope.findMany({
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
    }),
    prisma.transaction.findMany({
      where: { userId, excludeFromMainHistory: false },
      select: {
        id: true,
        envelopeId: true,
        date: true,
        payee: true,
        amount: true,
        type: true,
        source: true,
        excludeFromMainHistory: true,
        tags: true,
      },
      take: 5000,
      orderBy: { date: "desc" },
    }),
    prisma.savingsGoal.findUnique({
      where: { userId_periodKey: { userId, periodKey: monthKey } },
      select: { targetAmount: true },
    }),
    prisma.plaidItem.count({ where: { userId } }),
    prisma.pendingTransaction.count({
      where: {
        userId,
        source: { in: [...RECEIPT_INBOX_SOURCES] },
      },
    }),
  ])

  const clientEnvelopes: Envelope[] = envelopes.map((e) => ({
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

  const clientTxns: Transaction[] = transactions.map((t) => ({
    id: t.id,
    envelopeId: t.envelopeId,
    date: t.date.toISOString().slice(0, 10),
    payee: t.payee,
    amount: t.amount,
    type: t.type as Transaction["type"],
    source: (t.source as TransactionSource | null) ?? undefined,
    tags: [],
    excludeFromMainHistory: t.excludeFromMainHistory ?? false,
  }))

  const defaultGoal = await prisma.savingsGoal.findUnique({
    where: { userId_periodKey: { userId, periodKey: "default" } },
    select: { targetAmount: true },
  })

  const monthTarget = savingsGoal?.targetAmount != null ? Number(savingsGoal.targetAmount) : 0
  const defaultTarget = defaultGoal?.targetAmount != null ? Number(defaultGoal.targetAmount) : 0
  const savingsGoalSet = monthTarget > 0 || defaultTarget > 0

  const input: SetupGuideClientInput = {
    monthlyIncome: user.monthlyIncome,
    envelopes: clientEnvelopes,
    transactions: clientTxns,
    hasAccountEmail: Boolean(user.email && user.emailVerified),
    hasPremiumFeatures,
    savingsGoalSet,
    hasPlaidLink: plaidCount > 0,
    hasReceiptInboxActivity: receiptPending > 0,
  }

  const tasks = computeSetupGuideTasks(input)
  const progress = setupGuideProgress(tasks)

  const setupFlags = {
    allocations: tasks.find((t) => t.id === "allocations")?.complete ?? false,
    accountEmail: tasks.find((t) => t.id === "account_email")?.complete ?? false,
    plaid: tasks.find((t) => t.id === "plaid")?.complete ?? false,
    receiptInbox: tasks.find((t) => t.id === "receipt_inbox")?.complete ?? false,
  }

  await awardSetupGuideAchievements(userId, setupFlags)
  await detectAchievementsForUser(userId, now)

  return NextResponse.json({
    tasks,
    ...progress,
    setupGuideSnoozedUntil: user.setupGuideSnoozedUntil?.toISOString() ?? null,
    setupGuideDismissed: user.setupGuideDismissed,
    setupGuideShowOnDashboard: user.setupGuideShowOnDashboard,
    hasPremiumFeatures,
    monthKey,
  })
}
