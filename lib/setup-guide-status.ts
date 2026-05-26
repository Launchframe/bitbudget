import { TX_SOURCE_ENVELOPE_SWEEP, SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import { getCurrentMonthKey } from "@/lib/data"
import { sumMonthlyIncomeCredits } from "@/lib/savings-ui-metrics"

export const SETUP_GUIDE_TASK_IDS = [
  "income",
  "allocations",
  "first_expense",
  "savings_goal",
  "first_sweep",
  "account_email",
  "plaid",
  "receipt_inbox",
] as const

export type SetupGuideTaskId = (typeof SETUP_GUIDE_TASK_IDS)[number]

export type SetupGuideTaskStatus = {
  id: SetupGuideTaskId
  complete: boolean
  premiumOnly?: boolean
}

export type SetupGuideTransactionSignals = {
  hasFundedIncomeThisMonth: boolean
  hasAnyTransaction: boolean
  hasSweepToSavings: boolean
}

export type SetupGuideClientInput = {
  monthlyIncome: number
  envelopes: readonly Envelope[]
  /** Omit when `transactionSignals` is provided (server-side setup-status). */
  transactions?: readonly Transaction[]
  transactionSignals?: SetupGuideTransactionSignals
  hasAccountEmail: boolean
  hasPremiumFeatures: boolean
  savingsGoalSet: boolean
  hasPlaidLink: boolean
  hasReceiptInboxActivity: boolean
}

export const SETUP_GUIDE_ALLOTMENT_EPSILON = 0.001

/** Setup tasks that can flip when transaction fields change (server txn signals). */
export const SETUP_GUIDE_TRANSACTION_TASK_IDS: readonly SetupGuideTaskId[] = [
  "income",
  "first_expense",
  "first_sweep",
  "receipt_inbox",
]

const TX_SETUP_TASK_IDS = new Set<SetupGuideTaskId>(SETUP_GUIDE_TRANSACTION_TASK_IDS)

const ALLOTMENT_EPSILON = SETUP_GUIDE_ALLOTMENT_EPSILON

/**
 * Whether the client should scan transactions on each change. False when every
 * txn-dependent task is done (even if other setup tasks remain, e.g. a future
 * long-running goal). Before the first status load, returns true.
 */
export function needsTransactionSetupTracking(
  tasks: readonly SetupGuideTaskStatus[] | undefined,
  monthlyIncome: number,
): boolean {
  if (!tasks?.length) return true

  const incomeFromSettings = monthlyIncome > ALLOTMENT_EPSILON

  for (const task of tasks) {
    if (!TX_SETUP_TASK_IDS.has(task.id)) continue
    if (!task.complete) return true
    if (task.id === "income" && task.complete && !incomeFromSettings) return true
  }
  return false
}

/** Whether allotment signature refetch is still needed (allocations task open). */
export function needsAllotmentSetupTracking(
  tasks: readonly SetupGuideTaskStatus[] | undefined,
): boolean {
  if (!tasks?.length) return true
  const allocations = tasks.find((t) => t.id === "allocations")
  return allocations != null && !allocations.complete
}

/** Whether changes to settings monthly income can still affect setup tasks. */
export function needsMonthlyIncomeSetupTracking(
  tasks: readonly SetupGuideTaskStatus[] | undefined,
): boolean {
  if (!tasks?.length) return true
  const income = tasks.find((t) => t.id === "income")
  const allocations = tasks.find((t) => t.id === "allocations")
  return (
    (income != null && !income.complete) ||
    (allocations != null && !allocations.complete)
  )
}

export function hasIncomeSignal(
  monthlyIncome: number,
  transactions: readonly Transaction[] = [],
  monthKey: string = getCurrentMonthKey(),
  fundedIncomeThisMonth?: boolean,
): boolean {
  if (monthlyIncome > ALLOTMENT_EPSILON) return true
  if (fundedIncomeThisMonth === true) return true
  if (transactions.length === 0) return false
  return sumMonthlyIncomeCredits(transactions, monthKey) > ALLOTMENT_EPSILON
}

export function allocationsComplete(
  discretionaryEnvelopes: readonly Envelope[],
  monthlyIncome: number,
  transactions: readonly Transaction[] = [],
  fundedIncomeThisMonth?: boolean,
): boolean {
  if (discretionaryEnvelopes.length === 0) return false
  if (!hasIncomeSignal(monthlyIncome, transactions, getCurrentMonthKey(), fundedIncomeThisMonth)) {
    return false
  }
  return discretionaryEnvelopes.every((e) => (e.monthlyAllotment ?? 0) > ALLOTMENT_EPSILON)
}

export function hasFirstExpense(transactions: readonly Transaction[]): boolean {
  return transactions.some(
    (t) => !t.excludeFromMainHistory && (t.type === "expense" || t.type === "credit"),
  )
}

export function hasFirstSweep(
  transactions: readonly Transaction[],
  savingsEnvelopeId: string | undefined,
): boolean {
  if (!savingsEnvelopeId) return false
  return transactions.some(
    (t) =>
      !t.excludeFromMainHistory &&
      t.type === "credit" &&
      t.envelopeId === savingsEnvelopeId &&
      t.source === TX_SOURCE_ENVELOPE_SWEEP,
  )
}

export function computeSetupGuideTasks(input: SetupGuideClientInput): SetupGuideTaskStatus[] {
  const discretionary = input.envelopes.filter(
    (e) => !e.archived && e.systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS,
  )
  const txns = input.transactions ?? []
  const signals = input.transactionSignals
  const savingsId = input.envelopes.find((e) => e.systemRole === SYSTEM_ENVELOPE_ROLE_SAVINGS)?.id
  const funded = signals?.hasFundedIncomeThisMonth

  const core: SetupGuideTaskStatus[] = [
    {
      id: "income",
      complete: hasIncomeSignal(input.monthlyIncome, txns, getCurrentMonthKey(), funded),
    },
    {
      id: "allocations",
      complete: allocationsComplete(discretionary, input.monthlyIncome, txns, funded),
    },
    {
      id: "first_expense",
      complete: signals ? signals.hasAnyTransaction : hasFirstExpense(txns),
    },
    {
      id: "savings_goal",
      complete: input.savingsGoalSet,
    },
    {
      id: "first_sweep",
      complete: signals ? signals.hasSweepToSavings : hasFirstSweep(txns, savingsId),
    },
    {
      id: "account_email",
      complete: input.hasAccountEmail,
    },
  ]

  if (input.hasPremiumFeatures) {
    core.push(
      { id: "plaid", complete: input.hasPlaidLink, premiumOnly: true },
      { id: "receipt_inbox", complete: input.hasReceiptInboxActivity, premiumOnly: true },
    )
  }

  return core
}

export function setupGuideProgress(tasks: readonly SetupGuideTaskStatus[]): {
  completedCount: number
  totalCount: number
  allComplete: boolean
} {
  const totalCount = tasks.length
  const completedCount = tasks.filter((t) => t.complete).length
  return {
    completedCount,
    totalCount,
    allComplete: totalCount > 0 && completedCount === totalCount,
  }
}

/** Whether the dashboard card should render (caller still checks onboarding). */
export function shouldShowSetupGuideOnDashboard(input: {
  showOnDashboard: boolean
  dismissed: boolean
  snoozedUntil: string | null
  allComplete: boolean
  now?: Date
}): boolean {
  if (!input.showOnDashboard || input.dismissed || input.allComplete) return false
  if (!input.snoozedUntil) return true
  const until = new Date(input.snoozedUntil)
  const now = input.now ?? new Date()
  return Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()
}

export const SETUP_GUIDE_SNOOZE_MS = 24 * 60 * 60 * 1000
