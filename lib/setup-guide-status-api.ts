import { prisma } from "@/lib/db"
import type { SetupGuideAchievementFlags } from "@/lib/achievements"
import { getCurrentMonthKey } from "@/lib/data"
import {
  computeSetupGuideTasks,
  setupGuideProgress,
  type SetupGuideTaskStatus,
} from "@/lib/setup-guide-status"
import {
  findSavingsEnvelopeId,
  loadSetupGuideEnvelopes,
  loadSetupGuideTransactionSignals,
} from "@/lib/setup-guide-server"
import { resolveEffectiveTier } from "@/lib/subscription"

const RECEIPT_INBOX_SOURCES = ["email_forward"] as const

export type SetupStatusPayload = {
  tasks: SetupGuideTaskStatus[]
  completedCount: number
  totalCount: number
  allComplete: boolean
  setupGuideSnoozedUntil: string | null
  setupGuideDismissed: boolean
  setupGuideShowOnDashboard: boolean
  hasPremiumFeatures: boolean
  monthKey: string
  setupFlags: SetupGuideAchievementFlags
}

export async function buildSetupStatusPayload(userId: string): Promise<SetupStatusPayload | null> {
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

  if (!user) return null

  const effectiveTier = resolveEffectiveTier(user, now)
  const hasPremiumFeatures = effectiveTier === "premium" || effectiveTier === "premium-trial"

  const envelopes = await loadSetupGuideEnvelopes(userId)
  const savingsId = findSavingsEnvelopeId(envelopes)

  const [transactionSignals, savingsGoal, defaultGoal, plaidCount, receiptPending, receiptPosted] =
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
      prisma.pendingTransaction.findFirst({
        where: {
          userId,
          source: { in: [...RECEIPT_INBOX_SOURCES] },
        },
        select: { id: true },
      }),
      prisma.transaction.findFirst({
        where: {
          userId,
          excludeFromMainHistory: false,
          source: { in: [...RECEIPT_INBOX_SOURCES] },
        },
        select: { id: true },
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
    hasReceiptInboxActivity: receiptPending != null || receiptPosted != null,
  })
  const progress = setupGuideProgress(tasks)

  const setupFlags: SetupGuideAchievementFlags = {
    allocations: tasks.find((t) => t.id === "allocations")?.complete ?? false,
    accountEmail: tasks.find((t) => t.id === "account_email")?.complete ?? false,
    plaid: tasks.find((t) => t.id === "plaid")?.complete ?? false,
    receiptInbox: tasks.find((t) => t.id === "receipt_inbox")?.complete ?? false,
  }

  return {
    tasks,
    ...progress,
    setupGuideSnoozedUntil: user.setupGuideSnoozedUntil?.toISOString() ?? null,
    setupGuideDismissed: user.setupGuideDismissed,
    setupGuideShowOnDashboard: user.setupGuideShowOnDashboard,
    hasPremiumFeatures,
    monthKey,
    setupFlags,
  }
}

export function setupStatusJsonResponse(
  payload: SetupStatusPayload,
  extra?: { newlyAwarded?: number },
) {
  return {
    tasks: payload.tasks,
    completedCount: payload.completedCount,
    totalCount: payload.totalCount,
    allComplete: payload.allComplete,
    setupGuideSnoozedUntil: payload.setupGuideSnoozedUntil,
    setupGuideDismissed: payload.setupGuideDismissed,
    setupGuideShowOnDashboard: payload.setupGuideShowOnDashboard,
    hasPremiumFeatures: payload.hasPremiumFeatures,
    monthKey: payload.monthKey,
    ...extra,
  }
}
