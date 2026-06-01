/**
 * Credit transaction routing logic for the statement importer.
 *
 * Credits in a bank statement can be:
 *  - Income / paycheck  → should be skipped (already tracked in monthly income)
 *  - Refund             → should go back to the same envelope as the original expense
 *  - Small reward       → probably cashback/reward; route to Savings
 *  - Unknown            → let user decide
 */

import type { Transaction } from "@/lib/data"
import type { ParsedTransaction } from "@/lib/csv"
import { normalizePayeeKey } from "@/lib/payee-canonical"

export type CreditOrigin = "income" | "refund" | "reward" | "unknown"

export interface CreditAnalysis {
  origin: CreditOrigin
  /** For refunds: the suggested destination envelope (matched from expense history). */
  refundEnvelopeId?: string
  /** Human-readable reason for the classification. */
  reason: string
}

/**
 * Detect whether a credit amount looks like income.
 * Matches within 15% of monthlyIncome or monthlyIncome / 2 (bi-monthly cadence).
 */
export function isLikelyIncome(amount: number, monthlyIncome: number): boolean {
  if (monthlyIncome <= 0) return false
  const tolerance = 0.15
  const fullMatch = Math.abs(amount - monthlyIncome) / monthlyIncome <= tolerance
  const halfMatch = Math.abs(amount - monthlyIncome / 2) / (monthlyIncome / 2) <= tolerance
  return fullMatch || halfMatch
}

/**
 * Find the most recent expense with the same payee (normalized key).
 * Used to suggest a refund envelope.
 */
function findMatchingExpense(
  payee: string,
  expenses: readonly (ParsedTransaction | Transaction)[],
): (ParsedTransaction | Transaction) | undefined {
  const norm = normalizePayeeKey(payee)
  return expenses.find((t) => t.type === "expense" && normalizePayeeKey(t.payee) === norm)
}

/**
 * Classify a credit transaction and suggest a routing action.
 *
 * @param credit         The credit row being classified
 * @param statementTxns  All transactions in this statement (for in-statement refund detection)
 * @param historyTxns    Existing decrypted transactions (for historical refund detection)
 * @param monthlyIncome  User's monthly income setting
 */
export function analyzeCreditRouting(
  credit: ParsedTransaction,
  statementTxns: ParsedTransaction[],
  historyTxns: readonly Transaction[],
  monthlyIncome: number,
  savingsEnvelopeId: string | undefined,
): CreditAnalysis {
  void savingsEnvelopeId // reserved for future reward routing to Savings
  // 1. Income detection
  if (isLikelyIncome(credit.amount, monthlyIncome)) {
    return {
      origin: "income",
      reason: `Amount ($${credit.amount.toFixed(2)}) looks like a paycheck — skip to avoid double-counting`,
    }
  }

  // 2. Refund detection — same payee as expense in this statement
  const statementExpenses = statementTxns.filter((t) => t.type === "expense")
  const statementMatch = findMatchingExpense(credit.payee, statementExpenses)
  if (statementMatch) {
    return {
      origin: "refund",
      reason: `"${credit.payee}" also appears as an expense in this statement`,
    }
  }

  // 3. Refund detection — same payee as expense in transaction history
  const historyMatch = findMatchingExpense(credit.payee, historyTxns)
  if (historyMatch && "envelopeId" in historyMatch) {
    return {
      origin: "refund",
      refundEnvelopeId: (historyMatch as Transaction).envelopeId,
      reason: `"${credit.payee}" matches a past expense`,
    }
  }

  // 4. Small reward / cashback — less than 10% of monthly income
  if (monthlyIncome > 0 && credit.amount < monthlyIncome * 0.1) {
    return {
      origin: "reward",
      reason: "Small credit — probably cashback or a reward",
    }
  }

  return {
    origin: "unknown",
    reason: "Credit origin unclear — please choose how to handle it",
  }
}
