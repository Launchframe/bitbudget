// Pure posting-semantics helpers for the Financial Runway feature (D1).
//
// These classify whether a transaction (by its `source`) is a Runway "stack
// move" — a rearrangement of the user's stack (cash + bitcoin + loan liability)
// that is NOT income the user earned nor money the user spent — versus ordinary
// income / spending / savings-goal credits.
//
// Posting contract (from the Runway plan):
//   - Selling bitcoin is a CONVERSION of bitcoin into cash. It is excluded from
//     income and from the savings goal (it does not grow net worth; it only
//     changes the form the stack is held in).
//   - Opening, rolling, paying off, and liquidating a bitcoin-backed loan move
//     the stack together (cash ↔ liability ↔ collateral). None of those legs are
//     income or spending.
//
// No Prisma, no React, no crypto — arithmetic/predicate only, so the server and
// client can share it. The predicates accept any object exposing `source` (and,
// for the spending check, `type` / `excludeFromMainHistory`).

import {
  TX_SOURCE_BTC_SALE_CONVERSION,
  TX_SOURCE_LOAN_LIQUIDATION,
  TX_SOURCE_LOAN_OPEN,
  TX_SOURCE_LOAN_PAYOFF,
  TX_SOURCE_LOAN_ROLL,
} from "@/lib/constants"

/** Sources that represent a bitcoin↔cash conversion (selling bitcoin). */
export const RUNWAY_BTC_CONVERSION_SOURCES: ReadonlySet<string> = new Set([
  TX_SOURCE_BTC_SALE_CONVERSION,
])

/** Sources that represent a loan stack move (open / roll / payoff / liquidation). */
export const RUNWAY_LOAN_STACK_SOURCES: ReadonlySet<string> = new Set([
  TX_SOURCE_LOAN_OPEN,
  TX_SOURCE_LOAN_ROLL,
  TX_SOURCE_LOAN_PAYOFF,
  TX_SOURCE_LOAN_LIQUIDATION,
])

/** Every Runway stack-move source (conversions + loan moves). */
export const RUNWAY_STACK_MOVE_SOURCES: ReadonlySet<string> = new Set([
  ...RUNWAY_BTC_CONVERSION_SOURCES,
  ...RUNWAY_LOAN_STACK_SOURCES,
])

type HasSource = { source?: string | null }

function sourceOf(txn: HasSource): string {
  return txn.source ?? "manual"
}

/** True when the transaction is a bitcoin→cash conversion (a bitcoin sale). */
export function isBtcSaleConversion(txn: HasSource): boolean {
  return RUNWAY_BTC_CONVERSION_SOURCES.has(sourceOf(txn))
}

/** True when the transaction is a loan stack move (open / roll / payoff / liquidation). */
export function isLoanStackMove(txn: HasSource): boolean {
  return RUNWAY_LOAN_STACK_SOURCES.has(sourceOf(txn))
}

/** True when the transaction is any Runway stack move (conversion or loan move). */
export function isRunwayStackMove(txn: HasSource): boolean {
  return RUNWAY_STACK_MOVE_SOURCES.has(sourceOf(txn))
}

/** Discriminated classification of a transaction's Runway posting role. */
export type RunwayPostingKind =
  | "btc_sale_conversion"
  | "loan_stack_move"
  | "other"

/** Classify a transaction's Runway posting role from its source. */
export function classifyRunwayPosting(txn: HasSource): RunwayPostingKind {
  if (isBtcSaleConversion(txn)) return "btc_sale_conversion"
  if (isLoanStackMove(txn)) return "loan_stack_move"
  return "other"
}

// ---------------------------------------------------------------------------
// Posting contract predicates
//
// These express the three "counts as …" questions from the slice. They answer
// the Runway-specific exclusions only: a stack move never counts as income,
// savings-goal credit, or user-facing spending. They do NOT decide that a
// non-stack-move row IS income/spending — that stays with the existing
// allowlist/denylist helpers (transaction-visibility, savings-ui-metrics,
// cash-flow-series). OR these into those checks to enforce the contract.
// ---------------------------------------------------------------------------

/** A Runway stack move never counts as income (earned money). */
export function countsAsRunwayIncome(txn: HasSource): boolean {
  return !isRunwayStackMove(txn)
}

/**
 * A bitcoin→cash conversion is excluded from the savings goal (it does not grow
 * net worth), and loan stack moves are excluded too. So no stack move counts as
 * a savings-goal credit.
 */
export function countsAsSavingsGoalCredit(txn: HasSource): boolean {
  return !isRunwayStackMove(txn)
}

/** A Runway stack move is never user-facing spending. */
export function countsAsUserFacingExpense(txn: HasSource): boolean {
  return !isRunwayStackMove(txn)
}
