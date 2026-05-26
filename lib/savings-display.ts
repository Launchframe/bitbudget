import type { Envelope, Transaction } from "@/lib/data"
import { findTransactionHistoryStart } from "@/lib/income-import-tx0"

export function isoDateOnly(iso: string): string {
  return iso.split("T")[0]!
}

/** When BitBudget savings tracking begins for display (tx0 → onboarding → signup). */
export function resolveSavingsTrackingStart(params: {
  tx0Date: string | null
  onboardingCompletedAt: string | null
  accountCreatedAt: string | null
}): string | null {
  if (params.tx0Date) return params.tx0Date
  if (params.onboardingCompletedAt) return isoDateOnly(params.onboardingCompletedAt)
  if (params.accountCreatedAt) return isoDateOnly(params.accountCreatedAt)
  return null
}

export function resolveSavingsTrackingStartFromTransactions(
  transactions: readonly Transaction[],
  onboardingCompletedAt: string | null,
  accountCreatedAt: string | null,
): string | null {
  const tx0 = findTransactionHistoryStart(transactions)
  return resolveSavingsTrackingStart({
    tx0Date: tx0?.dateIso ?? null,
    onboardingCompletedAt,
    accountCreatedAt,
  })
}

export function formatSavingsSinceLabel(startDateIso: string): string {
  const d = new Date(`${startDateIso}T12:00:00.000Z`)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** Savings envelope balance from transactions on or after the tracking start date. */
export function savingsBalanceSince(
  transactions: readonly Transaction[],
  savingsEnvelope: Envelope | undefined,
  startDateIso: string,
): number {
  if (!savingsEnvelope) return 0
  const txns = transactions.filter(
    (t) => t.envelopeId === savingsEnvelope.id && isoDateOnly(t.date) >= startDateIso,
  )
  const expenses = txns.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)
  const credits = txns.filter((t) => t.type === "credit").reduce((sum, t) => sum + t.amount, 0)
  return credits - expenses
}
