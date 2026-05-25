import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  awardSetupGuideAchievements,
  detectAchievementsForUser,
} from "@/lib/achievements"
import { getCurrentMonthKey } from "@/lib/data"
import {
  computeSetupGuideTasks,
  setupGuideProgress,
} from "@/lib/setup-guide-status"
import {
  findSavingsEnvelopeId,
  loadSetupGuideEnvelopes,
  loadSetupGuideTransactionSignals,
} from "@/lib/setup-guide-server"
import { resolveEffectiveTier } from "@/lib/subscription"

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

  const effectiveTier = resolveEffectiveTier(user, now)
  const hasPremiumFeatures = effectiveTier === "premium" || effectiveTier === "premium-trial"

  const envelopes = await loadSetupGuideEnvelopes(userId)
  const savingsId = findSavingsEnvelopeId(envelopes)

  const [transactionSignals, savingsGoal, defaultGoal, plaidCount, receiptPending] =
    await Promise.all([
      loadSetupGuideTransactionSignals(userId, savingsId, monthKey),
      prisma.savingsGoal.findUnique({
        where: { userId_periodKey: { userId, periodKey: monthKey } },
        select: { targetAmount: true },
      }),
      prisma.savingsGoal.findUnique({
        where: { userId_periodKey: { userId, periodKey: "default" } },
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

  const monthTarget = savingsGoal?.targetAmount != null ? Number(savingsGoal.targetAmount) : 0
  const defaultTarget = defaultGoal?.targetAmount != null ? Number(defaultGoal.targetAmount) : 0
  const savingsGoalSet = monthTarget > 0 || defaultTarget > 0

  const tasks = computeSetupGuideTasks({
    monthlyIncome: user.monthlyIncome,
    envelopes,
    transactionSignals,
    hasAccountEmail: Boolean(user.email && user.emailVerified),
    hasPremiumFeatures,
    savingsGoalSet,
    hasPlaidLink: plaidCount > 0,
    hasReceiptInboxActivity: receiptPending > 0,
  })
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
