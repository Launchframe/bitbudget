/**
 * Bitcoin-backed loan health & "stack" math (Runway slice B1).
 *
 * A BitBudget user can borrow USD against bitcoin they send to a lender. These
 * loans are **balloon** style: interest is part of the single amount due on the
 * maturity date, not a recurring monthly bill. Because of that, a loan does NOT
 * change the user's monthly draw — it only changes what they *owe* and what they
 * *hold*. This module is pure, deterministic math (no Prisma, no React, no
 * runway-need imports) so it can be unit-tested in isolation and reused by the
 * UI/aggregation layers later.
 *
 * ## The "stack"
 * The stack is the user's total net bitcoin-denominated-and-cash position,
 * valued in USD:
 *
 *     stack = cash
 *           + cash on the way
 *           + bitcoin you hold (wallet)
 *           + bitcoin a lender holds (collateral)
 *           + bitcoin on the way
 *           − amount due
 *
 * Collateral the lender holds still counts toward the stack because it is still
 * the user's bitcoin — it is only "borrowed against", not sold. Taking a loan is
 * stack-neutral at open under the `accrued` payoff style (you gain cash and a
 * matching debt); interest is what erodes the stack over time.
 *
 * ## Payoff styles
 * - `accrued`   — the amount due today is principal plus interest accrued *so
 *                 far* (grows toward the maturity bill over the term).
 * - `full_bill` — the full maturity interest is locked in from day one, so the
 *                 amount due is the maturity bill for the entire term. This steps
 *                 the stack down immediately by the full interest at open.
 *
 * ## APR day-count convention
 * Interest is **simple, pro-rata, actual/365**: a term of exactly 365 days
 * accrues exactly one year of interest. For a loan of principal `P` at annual
 * rate `r` running `d` days:
 *
 *     maturityInterest = P * r * (termDays / 365)
 *     accruedInterest  = P * r * (min(elapsedDays, termDays) / 365)
 *
 * This matches the worked example exactly: borrow $50,000 at 10% APR for a
 * 365-day term → $5,000 interest → a $55,000 maturity bill.
 */

export type LoanPayoffStyle = "accrued" | "full_bill"

const SATS_PER_BTC = 100_000_000
const DAYS_PER_YEAR = 365
const MS_PER_DAY = 86_400_000

/** Convert an integer sats amount to its USD value at a given price. */
export function satsToUsd(sats: number, btcPriceUsd: number): number {
  if (!Number.isFinite(sats) || !Number.isFinite(btcPriceUsd)) return 0
  return (sats / SATS_PER_BTC) * btcPriceUsd
}

/** Convert a BTC quantity to integer sats (rounded). */
export function btcToSats(btc: number): number {
  if (!Number.isFinite(btc)) return 0
  return Math.round(btc * SATS_PER_BTC)
}

/**
 * Whole calendar days between two `YYYY-MM-DD` dates (end − start), using UTC
 * midnight so the result is timezone-independent and deterministic. May be
 * negative if `end` precedes `start`.
 */
export function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`)
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round((end - start) / MS_PER_DAY)
}

export interface BtcLoanInput {
  /** Optional stable id so callers can key rows / aggregates. */
  id?: string
  /** USD borrowed (cash received at open). */
  principalUsd: number
  /** Annual interest rate as a fraction, e.g. `0.1` for 10% APR. */
  aprFraction: number
  /** Loan open date, `YYYY-MM-DD`. */
  openDate: string
  /** Balloon maturity date, `YYYY-MM-DD`. */
  maturityDate: string
  /** How the amount due is recognized over the term. */
  payoffStyle: LoanPayoffStyle
  /** Bitcoin sent to the lender as collateral, in integer sats. */
  collateralSats: number
  /** Lender's liquidation ("sell") price in USD for the collateral. */
  liquidationPriceUsd: number
  /**
   * Optional typed final bill that overrides the computed maturity bill. When
   * present (finite), it is the authoritative amount owed at maturity, so both
   * `maturityBillUsd` and (through it) the interest portion and accrued due are
   * derived from it instead of principal + APR interest.
   */
  maturityBillOverrideUsd?: number | null
}

/** The override maturity bill when it is set and usable, else null. */
function overrideBillUsd(loan: BtcLoanInput): number | null {
  const override = loan.maturityBillOverrideUsd
  return override != null && Number.isFinite(override) ? override : null
}

/** Computed (non-override) whole-term interest, simple pro-rata actual/365. */
function computedMaturityInterestUsd(loan: BtcLoanInput): number {
  const termDays = Math.max(0, daysBetween(loan.openDate, loan.maturityDate))
  if (!Number.isFinite(loan.principalUsd) || !Number.isFinite(loan.aprFraction)) return 0
  return loan.principalUsd * loan.aprFraction * (termDays / DAYS_PER_YEAR)
}

/**
 * The single balloon bill owed on the maturity date. A typed override takes
 * precedence over the computed principal + full interest.
 */
export function maturityBillUsd(loan: BtcLoanInput): number {
  const override = overrideBillUsd(loan)
  if (override != null) return override
  return loan.principalUsd + computedMaturityInterestUsd(loan)
}

/**
 * Interest baked into the maturity bill (bill − principal), so it stays
 * consistent with any typed override. May be negative if an override bill is
 * below principal.
 */
export function maturityInterestUsd(loan: BtcLoanInput): number {
  return maturityBillUsd(loan) - loan.principalUsd
}

/**
 * Amount due as of a given date.
 *
 * - `accrued`   → principal + interest accrued so far, pro-rata over the term
 *                 toward the (possibly overridden) maturity interest, clamped so
 *                 nothing accrues before open or after maturity.
 * - `full_bill` → the full maturity bill for the entire term (locked day one).
 */
export function amountDueUsd(loan: BtcLoanInput, asOfDate: string): number {
  if (loan.payoffStyle === "full_bill") {
    return maturityBillUsd(loan)
  }
  const termDays = Math.max(0, daysBetween(loan.openDate, loan.maturityDate))
  // A zero-day term matures immediately: the full bill is due on/after open.
  if (termDays <= 0) {
    return maturityBillUsd(loan)
  }
  const elapsed = Math.min(Math.max(0, daysBetween(loan.openDate, asOfDate)), termDays)
  const fraction = elapsed / termDays
  return loan.principalUsd + maturityInterestUsd(loan) * fraction
}

export interface StackInput {
  /** Cash on hand in USD. */
  cashUsd: number
  /** Cash expected to arrive (pending inflows) in USD. */
  cashOnTheWayUsd?: number
  /** Bitcoin the user holds directly, in integer sats. */
  walletSats: number
  /** Bitcoin a lender holds as collateral, in integer sats. */
  lenderHeldSats: number
  /** Bitcoin expected to arrive (pending), in integer sats. */
  bitcoinOnTheWaySats?: number
  /** Total amount currently due across loans, in USD. */
  amountDueUsd: number
  /** BTC price in USD used to value all bitcoin pieces. */
  btcPriceUsd: number
}

/**
 * Total stack in USD: cash + cash on the way + all bitcoin the user controls
 * (wallet + lender-held collateral + bitcoin on the way) − amount due.
 */
export function stackUsd(input: StackInput): number {
  const totalSats =
    (input.walletSats || 0) + (input.lenderHeldSats || 0) + (input.bitcoinOnTheWaySats || 0)
  return (
    (input.cashUsd || 0) +
    (input.cashOnTheWayUsd || 0) +
    satsToUsd(totalSats, input.btcPriceUsd) -
    (input.amountDueUsd || 0)
  )
}

export interface LiquidationDistanceInput {
  /** Current BTC price in USD. */
  btcPriceUsd: number
  /** Lender's liquidation ("sell") price in USD. */
  lenderSellPriceUsd: number
}

export interface LiquidationDistance {
  /** USD room before liquidation: `btcPriceUsd − lenderSellPriceUsd`. */
  absoluteUsd: number
  /**
   * Fraction of the current price that must be lost to hit the sell price:
   * `(btcPriceUsd − lenderSellPriceUsd) / btcPriceUsd`. Negative when already
   * at/below the sell price. `null` when the current price is not positive.
   */
  percent: number | null
}

/** How far today's price is from the lender's liquidation price. */
export function liquidationDistance(input: LiquidationDistanceInput): LiquidationDistance {
  const absoluteUsd = input.btcPriceUsd - input.lenderSellPriceUsd
  const percent =
    input.btcPriceUsd > 0 && Number.isFinite(input.btcPriceUsd)
      ? absoluteUsd / input.btcPriceUsd
      : null
  return { absoluteUsd, percent }
}

export interface RolloverPriceInput {
  /** The bill a rollover loan must cover, in USD. */
  amountDueUsd: number
  /** Collateral available for the new loan, in integer sats. */
  collateralSats: number
  /** Borrow cap / max LTV for a new loan as a fraction, e.g. `0.5`. */
  borrowCapFraction: number
}

/**
 * Price at which a brand-new loan on the same collateral, at the borrow cap,
 * would raise exactly `amountDueUsd`:
 *
 *     maxBorrow = collateralBtc * price * borrowCapFraction = amountDueUsd
 *     price     = amountDueUsd / (collateralBtc * borrowCapFraction)
 *
 * Returns `Infinity` when there is no collateral or no borrow capacity (no price
 * can ever cover the bill).
 */
export function rolloverPriceUsd(input: RolloverPriceInput): number {
  const collateralBtc = (input.collateralSats || 0) / SATS_PER_BTC
  const denom = collateralBtc * (input.borrowCapFraction || 0)
  if (denom <= 0) return Number.POSITIVE_INFINITY
  return input.amountDueUsd / denom
}

export interface EvaluateLoanContext {
  /** Current BTC price in USD. */
  btcPriceUsd: number
  /** Date to evaluate "due today" against, `YYYY-MM-DD`. */
  asOfDate: string
  /** Borrow cap / max LTV used for the rollover check, as a fraction. */
  borrowCapFraction: number
}

export interface LoanEvaluation {
  id?: string
  /** Full balloon bill owed on the maturity date. */
  billAtMaturityUsd: number
  /** Interest portion of the maturity bill. */
  maturityInterestUsd: number
  /** Amount due as of `asOfDate` (accrued vs full_bill aware). */
  amountDueTodayUsd: number
  /** Collateral the lender holds, in integer sats. */
  collateralSats: number
  /** Lender's liquidation price in USD. */
  liquidationPriceUsd: number
  /** Distance from today's price to the liquidation price. */
  liquidationRoom: LiquidationDistance
  /** Price at which a rollover at the cap would cover today's amount due. */
  rolloverPriceUsd: number
  /** Whether a rollover at today's price (at the cap) covers today's amount due. */
  rolloverCoversBillAtToday: boolean
}

/** One-row health summary for a single loan, ready for a UI table. */
export function evaluateLoan(loan: BtcLoanInput, ctx: EvaluateLoanContext): LoanEvaluation {
  const amountDueToday = amountDueUsd(loan, ctx.asOfDate)
  const rollover = rolloverPriceUsd({
    amountDueUsd: amountDueToday,
    collateralSats: loan.collateralSats,
    borrowCapFraction: ctx.borrowCapFraction,
  })
  const maxBorrowAtToday =
    satsToUsd(loan.collateralSats, ctx.btcPriceUsd) * (ctx.borrowCapFraction || 0)
  return {
    id: loan.id,
    billAtMaturityUsd: maturityBillUsd(loan),
    maturityInterestUsd: maturityInterestUsd(loan),
    amountDueTodayUsd: amountDueToday,
    collateralSats: loan.collateralSats,
    liquidationPriceUsd: loan.liquidationPriceUsd,
    liquidationRoom: liquidationDistance({
      btcPriceUsd: ctx.btcPriceUsd,
      lenderSellPriceUsd: loan.liquidationPriceUsd,
    }),
    rolloverPriceUsd: rollover,
    rolloverCoversBillAtToday: maxBorrowAtToday >= amountDueToday,
  }
}

export interface LoansEvaluation {
  loans: LoanEvaluation[]
  /** Sum of amount due today across all loans, in USD. */
  totalAmountDueTodayUsd: number
  /** Sum of maturity bills across all loans, in USD. */
  totalBillAtMaturityUsd: number
  /** Total collateral held by lenders across all loans, in integer sats. */
  totalLenderHeldSats: number
}

/** Evaluate a list of loans plus portfolio-level aggregates. */
export function evaluateLoans(
  loans: readonly BtcLoanInput[],
  ctx: EvaluateLoanContext,
): LoansEvaluation {
  const evaluated = loans.map((loan) => evaluateLoan(loan, ctx))
  return {
    loans: evaluated,
    totalAmountDueTodayUsd: evaluated.reduce((s, l) => s + l.amountDueTodayUsd, 0),
    totalBillAtMaturityUsd: evaluated.reduce((s, l) => s + l.billAtMaturityUsd, 0),
    totalLenderHeldSats: loans.reduce((s, l) => s + (l.collateralSats || 0), 0),
  }
}
