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
 * A zero BTC price values coins at $0. A negative, infinite, or NaN quote does
 * not: the stack is NaN whenever any bitcoin is held, so a broken price cannot
 * look like the coins disappeared. A NaN amount due is also NaN, not $0.
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
 * A 366-day span (a leap year sitting inside the term) accrues 366/365 of a
 * year. Dates must be real `YYYY-MM-DD` calendar days — 31 Feb does not roll
 * into March. This matches the worked example exactly: borrow $50,000 at 10%
 * APR for a 365-day term → $5,000 interest → a $55,000 maturity bill.
 */

export type LoanPayoffStyle = "accrued" | "full_bill"

const SATS_PER_BTC = 100_000_000
const DAYS_PER_YEAR = 365
const MS_PER_DAY = 86_400_000
/**
 * Spot and the rollover breakeven can disagree by a couple of binary ulps when
 * the bill is exactly the max borrow. 1e-9 relative is under a tenth of a cent
 * on a $100k coin and well above that noise, so the cover flag matches the
 * price the row reports.
 */
const ROLLOVER_PRICE_REL_EPS = 1e-9
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Default omitted optional inputs to 0. NaN and negatives pass through. */
function orZero(value: number | undefined): number {
  return value ?? 0
}

/**
 * UTC midnight for a real `YYYY-MM-DD` calendar day, or NaN.
 * `Date.parse` / `Date.UTC` overflow impossible days (31 Feb → 3 Mar); the
 * round-trip rejects those so a bad maturity cannot shorten or lengthen interest.
 */
function utcDayMs(isoDate: string): number {
  if (typeof isoDate !== "string") return Number.NaN
  const match = ISO_DAY.exec(isoDate)
  if (!match) return Number.NaN
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return Number.NaN
  }
  return ms
}

/**
 * Convert an integer sats amount to its USD value at a given price.
 * Zero sats are worth $0 even if the quote is unusable. Any other holding with
 * a negative or non-finite price is NaN — never silently $0.
 */
export function satsToUsd(sats: number, btcPriceUsd: number): number {
  if (sats === 0) return 0
  if (!Number.isFinite(sats) || !Number.isFinite(btcPriceUsd) || btcPriceUsd < 0) {
    return Number.NaN
  }
  return (sats / SATS_PER_BTC) * btcPriceUsd
}

/**
 * Convert a BTC quantity to integer sats, rounded half away from zero.
 * `Math.round(1.5e-8 * 1e8)` is 1 because the product is 1.4999...; decimal
 * rounding recovers the half-sat. Non-finite input and amounts that do not fit
 * in a safe integer are NaN, not 0.
 */
export function btcToSats(btc: number): number {
  if (!Number.isFinite(btc)) return Number.NaN
  const negative = btc < 0
  const text = Math.abs(btc).toFixed(12)
  if (text.includes("e") || text.includes("E")) return Number.NaN
  const [whole, frac = ""] = text.split(".")
  const digits = (frac + "000000000000").slice(0, 12)
  const wholeSats = Number(whole) * SATS_PER_BTC
  const subSats = Number(digits.slice(0, 8))
  const remainder = Number(digits.slice(8))
  let sats = wholeSats + subSats
  if (remainder >= 5000) sats += 1
  if (!Number.isSafeInteger(sats)) return Number.NaN
  return negative ? -sats : sats
}

/**
 * Whole calendar days between two `YYYY-MM-DD` dates (end − start), using UTC
 * midnight so the result is timezone-independent and deterministic. May be
 * negative if `end` precedes `start`. NaN when either date is not a real
 * calendar day (invalid strings, 31 Feb, 29 Feb in a non-leap year).
 */
export function daysBetween(startDate: string, endDate: string): number {
  const start = utcDayMs(startDate)
  const end = utcDayMs(endDate)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN
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
}

function simpleInterestUsd(principalUsd: number, aprFraction: number, days: number): number {
  if (!Number.isFinite(principalUsd) || !Number.isFinite(aprFraction) || !Number.isFinite(days)) {
    return Number.NaN
  }
  if (days <= 0) return 0
  return principalUsd * aprFraction * (days / DAYS_PER_YEAR)
}

/** Whole-term interest for a loan (the interest baked into the maturity bill). */
export function maturityInterestUsd(loan: BtcLoanInput): number {
  const termDays = daysBetween(loan.openDate, loan.maturityDate)
  if (!Number.isFinite(termDays)) return Number.NaN
  return simpleInterestUsd(loan.principalUsd, loan.aprFraction, Math.max(0, termDays))
}

/** The single balloon bill owed on the maturity date (principal + full interest). */
export function maturityBillUsd(loan: BtcLoanInput): number {
  const interest = maturityInterestUsd(loan)
  if (!Number.isFinite(loan.principalUsd) || !Number.isFinite(interest)) return Number.NaN
  return loan.principalUsd + interest
}

/**
 * Amount due as of a given date.
 *
 * - `accrued`   → principal + interest accrued so far (pro-rata actual/365,
 *                 clamped to the term so nothing accrues before open or after
 *                 maturity).
 * - `full_bill` → the full maturity bill for the entire term (locked day one).
 *
 * NaN when dates, principal, or APR are not finite — a bad rate must not look
 * like zero interest, and a bad maturity must not look like a same-day loan.
 */
export function amountDueUsd(loan: BtcLoanInput, asOfDate: string): number {
  if (loan.payoffStyle === "full_bill") return maturityBillUsd(loan)
  if (loan.payoffStyle !== "accrued") return Number.NaN
  const termDays = daysBetween(loan.openDate, loan.maturityDate)
  const elapsedRaw = daysBetween(loan.openDate, asOfDate)
  if (!Number.isFinite(termDays) || !Number.isFinite(elapsedRaw)) return Number.NaN
  const elapsed = Math.min(Math.max(0, elapsedRaw), Math.max(0, termDays))
  const accrued = simpleInterestUsd(loan.principalUsd, loan.aprFraction, elapsed)
  if (!Number.isFinite(loan.principalUsd) || !Number.isFinite(accrued)) return Number.NaN
  return loan.principalUsd + accrued
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
 * NaN when any included piece cannot be valued (broken BTC quote while coins
 * are held, or a non-finite amount due). Omitted "on the way" fields count as 0.
 */
export function stackUsd(input: StackInput): number {
  const totalSats =
    orZero(input.walletSats) + orZero(input.lenderHeldSats) + orZero(input.bitcoinOnTheWaySats)
  const btcValue = satsToUsd(totalSats, input.btcPriceUsd)
  const cash = orZero(input.cashUsd) + orZero(input.cashOnTheWayUsd)
  const due = orZero(input.amountDueUsd)
  if (!Number.isFinite(btcValue) || !Number.isFinite(cash) || !Number.isFinite(due)) {
    return Number.NaN
  }
  return cash + btcValue - due
}

export interface LiquidationDistanceInput {
  /** Current BTC price in USD. */
  btcPriceUsd: number
  /** Lender's liquidation ("sell") price in USD. */
  lenderSellPriceUsd: number
}

export interface LiquidationDistance {
  /**
   * USD room before liquidation: `btcPriceUsd − lenderSellPriceUsd`.
   * `null` when the spot price is not a positive finite quote or the sell
   * price is not finite — a $0 or missing price is not "already liquidated".
   */
  absoluteUsd: number | null
  /**
   * Fraction of the current price that must be lost to hit the sell price:
   * `(btcPriceUsd − lenderSellPriceUsd) / btcPriceUsd`. Negative when already
   * below the sell price. `null` when the distance is not defined (non-positive
   * or non-finite spot, non-finite sell, or a ratio that overflows).
   */
  percent: number | null
}

/** How far today's price is from the lender's liquidation price. */
export function liquidationDistance(input: LiquidationDistanceInput): LiquidationDistance {
  const price = input.btcPriceUsd
  const sell = input.lenderSellPriceUsd
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(sell)) {
    return { absoluteUsd: null, percent: null }
  }
  const absoluteUsd = price - sell
  const percent = absoluteUsd / price
  return {
    absoluteUsd,
    percent: Number.isFinite(percent) ? percent : null,
  }
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
 * - `0` when nothing is owed (`amountDueUsd <= 0`): already covered at every
 *   price, including with no collateral.
 * - `NaN` when the bill, collateral, or cap is not finite.
 * - `+Infinity` when a positive bill can never be covered (no positive
 *   collateral, no positive borrow cap, or the ratio overflows). Negative
 *   collateral and a negative cap do not cancel into a finite price.
 */
export function rolloverPriceUsd(input: RolloverPriceInput): number {
  const due = input.amountDueUsd
  if (!Number.isFinite(due)) return Number.NaN
  if (due <= 0) return 0
  const sats = input.collateralSats
  const cap = input.borrowCapFraction
  if (!Number.isFinite(sats) || !Number.isFinite(cap)) return Number.NaN
  if (sats <= 0 || cap <= 0) return Number.POSITIVE_INFINITY
  const denom = (sats / SATS_PER_BTC) * cap
  if (!Number.isFinite(denom) || denom <= 0) return Number.POSITIVE_INFINITY
  const price = due / denom
  return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY
}

function rolloverCoversBill(btcPriceUsd: number, rolloverPrice: number, amountDue: number): boolean {
  if (Number.isFinite(amountDue) && amountDue <= 0) return true
  if (!Number.isFinite(btcPriceUsd) || !Number.isFinite(rolloverPrice)) return false
  if (btcPriceUsd >= rolloverPrice) return true
  const scale = Math.max(Math.abs(btcPriceUsd), Math.abs(rolloverPrice), 1)
  return rolloverPrice - btcPriceUsd <= scale * ROLLOVER_PRICE_REL_EPS
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
  /**
   * Whether a rollover at today's price (at the cap) covers today's amount due.
   * True when nothing is owed. False when today's price or the breakeven is
   * not a finite number (`+Infinity` breakeven means no price covers the bill).
   */
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
    rolloverCoversBillAtToday: rolloverCoversBill(ctx.btcPriceUsd, rollover, amountDueToday),
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
    totalLenderHeldSats: loans.reduce((s, l) => s + orZero(l.collateralSats), 0),
  }
}
