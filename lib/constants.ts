/**
 * Shared constants used across client components and server-side routes.
 * Keep this file free of client-only or server-only imports.
 */

export const PRESET_ENVELOPE_COLORS = [
  "#F7931A", "#3B82F6", "#10B981", "#8B5CF6",
  "#EF4444", "#EAB308", "#EC4899", "#06B6D4",
  "#F97316", "#84CC16", "#14B8A6",
]

/** Reserved display name for the system-managed Savings envelope (ledger funding). */
export const RESERVED_SAVINGS_ENVELOPE_NAME = "Savings"

/** Prisma `Envelope.systemRole` value for the Savings envelope. */
export const SYSTEM_ENVELOPE_ROLE_SAVINGS = "savings"

/** Visible Income rows use this plaintext label server-side before asymmetric encrypt. */
export const LEDGER_INCOME_PAYEE_LABEL = "Income"

/** Funding allocation legs use this plaintext label (hidden from main history). */
export const LEDGER_ALLOCATION_PAYEE_LABEL = "Envelope allocation"

export const SWEEP_POLICY_RESET = "reset"
export const SWEEP_POLICY_CARRY_FORWARD = "carry_forward"
export const SWEEP_POLICY_CAPPED = "capped"

export const SAVINGS_EXPERIENCE_ENGAGED = "engaged"
export const SAVINGS_EXPERIENCE_DISMISSED = "dismissed"

/** Soft-deleted envelopes can be restored within this window before purge. */
export const ENVELOPE_DELETE_GRACE_DAYS = 30

/** Rolling fallback row in SavingsGoal when no per-month override exists. */
export const SAVINGS_GOAL_DEFAULT_PERIOD = "default"

/** Savings UI accent (distinct from Bitcoin orange #F7931A). */
export const SAVINGS_GOLD_ACCENT = "#D4AF37"

/** Draw-from-Savings vs balance: D/B below low → green; between low and high → orange; at or above high → red. */
export const SAVINGS_DRAW_WARN_RATIO_LOW = 0.25
export const SAVINGS_DRAW_WARN_RATIO_HIGH = 0.4

/** Adjust envelopes → bidirectional Savings ↔ spending envelopes (rebalance dialog source=savings). */
export const MOVE_TO_FROM_SAVINGS_TITLE = "Move to/from Savings"

/** Premium renewal pricing (USD) — shown in renewal reminders until live checkout. */
export const PREMIUM_PRICE_MONTHLY_USD = 5
export const PREMIUM_PRICE_ANNUAL_USD = 50
export const PREMIUM_ANNUAL_SAVINGS_MONTHS = 2

export const TX_SOURCE_INCOME_IMPORT = "income_import"
export const TX_SOURCE_PAYCHECK = "paycheck"
/** One-time catch-up credit for income before BitBudget (Savings + proportional envelope legs). */
export const TX_SOURCE_RETRO_PAYCHECK = "retro_paycheck"
export const TX_SOURCE_IRREGULAR_INCOME = "irregular_income"
export const TX_SOURCE_FUNDING_OUT = "envelope_funding_out"
export const TX_SOURCE_FUNDING_IN = "envelope_funding_in"
export const TX_SOURCE_ENVELOPE_SWEEP = "envelope_sweep"
export const TX_SOURCE_DEFICIT_COVER = "deficit_cover"
export const TX_SOURCE_ENVELOPE_TRANSFER_IN = "envelope_transfer_in"
export const TX_SOURCE_ENVELOPE_TRANSFER_OUT = "envelope_transfer_out"

// ---------------------------------------------------------------------------
// Financial Runway stack-move sources
//
// These mark transactions that rearrange the user's "stack" (cash + bitcoin +
// loan liability) without being income the user earned or money the user spent:
//   - Selling bitcoin is a CONVERSION of bitcoin into cash. It must never count
//     as income or as a savings-goal credit (it does not grow net worth).
//   - Opening, rolling, paying off, or liquidating a bitcoin-backed loan moves
//     the stack together (cash ↔ liability ↔ collateral). None of these legs are
//     income or spending.
// Keeping them out of the income / savings-inflow / cash-inflow allowlists (and
// out of user-facing spending) preserves the runway posting contract.
// ---------------------------------------------------------------------------

/** Proceeds leg when the user sells bitcoin — a bitcoin→cash conversion, not income. */
export const TX_SOURCE_BTC_SALE_CONVERSION = "btc_sale_conversion"
/** Cash received when a bitcoin-backed loan is opened (paired with a liability). */
export const TX_SOURCE_LOAN_OPEN = "loan_open"
/** Rolling / refinancing an existing loan into a new one (stack move, not spend). */
export const TX_SOURCE_LOAN_ROLL = "loan_roll"
/** Paying off a loan's balloon bill at maturity (stack move, not spend). */
export const TX_SOURCE_LOAN_PAYOFF = "loan_payoff"
/** Lender liquidates collateral to cover the bill (stack move, not spend). */
export const TX_SOURCE_LOAN_LIQUIDATION = "loan_liquidation"

/** Shared shopping — payer's own grocery share. */
export const TX_SOURCE_SHOPPING_OWN_EXPENSE = "shopping_own_expense"
/** Cash the payer advanced for someone else's groceries. Not personal spend. */
export const TX_SOURCE_SHOPPING_ADVANCE_OUT = "shopping_advance_out"
/** Cash returned when a co-shopper repays an advance. Not income. */
export const TX_SOURCE_SHOPPING_ADVANCE_RECOVERY = "shopping_advance_recovery"
/** Co-shopper's grocery spend recorded when they repay. */
export const TX_SOURCE_SHOPPING_REPAYMENT_EXPENSE = "shopping_repayment_expense"
/** Overpayment sent beyond outstanding debt (prepaid credit). */
export const TX_SOURCE_SHOPPING_PREPAID_OUT = "shopping_prepaid_out"
/** Overpayment received / unused prepaid refunded. Not income. */
export const TX_SOURCE_SHOPPING_PREPAID_IN = "shopping_prepaid_in"
/** Non-cash reclass: prior prepaid becomes grocery spend. */
export const TX_SOURCE_SHOPPING_PREPAID_APPLY = "shopping_prepaid_apply"
/** Offset row when a shared receipt or payment is corrected. */
export const TX_SOURCE_SHOPPING_CORRECTION = "shopping_correction"

export const ENVELOPE_FUNDING_BATCH_KIND_FUND = "fund"
export const ENVELOPE_FUNDING_BATCH_KIND_SWEEP = "sweep"
export const ENVELOPE_FUNDING_BATCH_KIND_REBALANCE = "rebalance"
/** @deprecated Use ENVELOPE_FUNDING_BATCH_KIND_REBALANCE */
export const ENVELOPE_FUNDING_BATCH_KIND_MOVE_FUNDS = "move_funds"
export const ENVELOPE_FUNDING_BATCH_KIND_DEFICIT_COVER = "deficit_cover"

/** Plaintext payee for manual deficit cover credits on envelopes. */
export const DEFICIT_COVER_FROM_SAVINGS_LABEL = "Covered from Savings"

export function isReservedSavingsEnvelopeName(name: string): boolean {
  return name.trim().toLowerCase() === RESERVED_SAVINGS_ENVELOPE_NAME.toLowerCase()
}

/** Budget envelopes receive allotment slices; system Savings holds unallocated income. */
export function isBudgetEnvelope(systemRole: string | null | undefined): boolean {
  return systemRole !== SYSTEM_ENVELOPE_ROLE_SAVINGS
}
