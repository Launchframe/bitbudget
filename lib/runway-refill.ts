// Pure math for "Runway refill" (slice B6): when cash drops under the untouched
// cash floor, work out the shortfall, how soon spending will punch through the
// floor, and the ways to refill it — sell bitcoin, borrow against bitcoin, or
// draw on rollover surplus from existing collateral.
//
// No Prisma, no React, no network — arithmetic only, so the server and client
// can share it. All bitcoin amounts are integer sats; dollar amounts are plain
// numbers (USD). Stack before/after marks reuse `stackUsd` from loan-health so
// every surface values the stack the same way.

import { roundToCents } from "@/lib/decimal-validation"
import { satsToUsd, stackUsd, type StackInput } from "@/lib/loan-health"

const SATS_PER_BTC = 100_000_000

/** Convert a USD amount to the integer sats it buys at a spot price (ceil so a
 * sale/borrow raises at least the target). Non-positive price/amount → 0. */
function usdToSatsCeil(usd: number, priceUsd: number): number {
  if (usd <= 0 || priceUsd <= 0 || !Number.isFinite(priceUsd)) return 0
  return Math.max(0, Math.ceil((usd / priceUsd) * SATS_PER_BTC))
}

// ---------------------------------------------------------------------------
// Cash-floor shortfall
// ---------------------------------------------------------------------------

/** Why cash slipped under the floor, when previous values are known. */
export type FloorBreachReason = "cash_fell" | "floor_rose" | "both" | null

export interface CashFloorShortfallInput {
  /** Cash on hand today, USD. */
  cashUsd: number
  /** The untouched cash floor today, USD. */
  cashFloorUsd: number
  /** Cash at the last checkpoint, if known (to explain why we're under). */
  previousCashUsd?: number | null
  /** Floor at the last checkpoint, if known. */
  previousCashFloorUsd?: number | null
}

export interface CashFloorShortfallResult {
  /** Dollars needed to get back to the floor (0 when at/above it). */
  shortfallUsd: number
  /** True when cash is under the floor. */
  underFloor: boolean
  /** Whether cash fell, the floor rose, or both — null when not under or unknown. */
  reason: FloorBreachReason
}

/**
 * Cash-floor shortfall = max(0, floor − cash), rounded to cents. When prior
 * values are supplied, also classify whether cash fell, the floor rose, or both
 * pushed cash under the floor (a ~$0.50 deadband avoids noise from rounding).
 */
export function cashFloorShortfall(
  input: CashFloorShortfallInput,
): CashFloorShortfallResult {
  const shortfallUsd = roundToCents(Math.max(0, input.cashFloorUsd - input.cashUsd))
  const underFloor = shortfallUsd > 0
  let reason: FloorBreachReason = null
  if (underFloor) {
    const cashFell =
      input.previousCashUsd != null && input.cashUsd < input.previousCashUsd - 0.5
    const floorRose =
      input.previousCashFloorUsd != null &&
      input.cashFloorUsd > input.previousCashFloorUsd + 0.5
    if (cashFell && floorRose) reason = "both"
    else if (cashFell) reason = "cash_fell"
    else if (floorRose) reason = "floor_rose"
  }
  return { shortfallUsd, underFloor, reason }
}

// ---------------------------------------------------------------------------
// Months until the floor is breached (simple recent-net-cash-flow projection)
// ---------------------------------------------------------------------------

export interface FloorBreachInput {
  cashUsd: number
  cashFloorUsd: number
  /** Recent net monthly cash flow: cash-in − spending (negative = draining). */
  netMonthlyCashFlowUsd: number
}

/**
 * Months until cash would fall to the floor at the recent net monthly cash
 * flow. Returns:
 *   - 0      when already at/under the floor,
 *   - null   when cash is above the floor and net flow is ≥ 0 (never breaches),
 *   - months otherwise (can be fractional; caller rounds for copy).
 */
export function monthsUntilFloorBreach(input: FloorBreachInput): number | null {
  const headroom = input.cashUsd - input.cashFloorUsd
  if (headroom <= 0) return 0
  const net = input.netMonthlyCashFlowUsd
  if (!Number.isFinite(net) || net >= 0) return null
  const months = headroom / -net
  return months > 0 ? months : 0
}

export interface RefillStatusInput {
  /** Cash on hand today, USD. */
  cashUsd: number
  /** Cash in transit from open sales (reduces the live shortfall). */
  cashOnTheWayUsd?: number
  /** The untouched cash floor, USD. */
  cashFloorUsd: number
  /** Monthly draw on the stack (living − income); 0 when income covers living. */
  monthlyDrawUsd: number
}

export interface RefillStatus {
  /** Dollars needed to get back to the floor (0 when at/above it). */
  shortfallUsd: number
  /** True when effective cash is under the floor. */
  underFloor: boolean
  /** Months until cash reaches the floor at the current draw (null = never, 0 = now). */
  monthsUntilBreach: number | null
}

/**
 * One-call refill status for a surface that already has a RunwayNeedResult.
 * Cash in transit counts toward the floor (the sale is already addressing it).
 * When under the floor, breach is "now" (0); otherwise it projects from the
 * monthly draw (income − living), which drains cash toward the floor.
 */
export function refillStatus(input: RefillStatusInput): RefillStatus {
  const effectiveCashUsd = input.cashUsd + Math.max(0, input.cashOnTheWayUsd ?? 0)
  const { shortfallUsd, underFloor } = cashFloorShortfall({
    cashUsd: effectiveCashUsd,
    cashFloorUsd: input.cashFloorUsd,
  })
  const monthsUntilBreach = underFloor
    ? 0
    : monthsUntilFloorBreach({
        cashUsd: effectiveCashUsd,
        cashFloorUsd: input.cashFloorUsd,
        netMonthlyCashFlowUsd: -Math.max(0, input.monthlyDrawUsd),
      })
  return { shortfallUsd, underFloor, monthsUntilBreach }
}

// ---------------------------------------------------------------------------
// Paycheck coverage (while still earning)
// ---------------------------------------------------------------------------

export interface PaycheckCoverageResult {
  /** Dollars of the shortfall the next paycheck covers. */
  coveredUsd: number
  /** Dollars of shortfall still left after the paycheck. */
  remainingUsd: number
  /** Whether the next paycheck covers the whole shortfall. */
  coversFull: boolean
}

/** How much of the shortfall the next paycheck covers (clamped, cents-rounded). */
export function paycheckShortfallCoverage(
  shortfallUsd: number,
  nextPaycheckUsd: number,
): PaycheckCoverageResult {
  const short = Math.max(0, shortfallUsd)
  const pay = Math.max(0, nextPaycheckUsd)
  const coveredUsd = roundToCents(Math.min(short, pay))
  const remainingUsd = roundToCents(Math.max(0, short - coveredUsd))
  return { coveredUsd, remainingUsd, coversFull: remainingUsd <= 0 && short > 0 }
}

// ---------------------------------------------------------------------------
// Refill options (sell / borrow / rollover)
// ---------------------------------------------------------------------------

export type RefillOptionKind = "sell" | "borrow" | "rollover"

export interface RefillOptionsInput {
  /** Dollars to refill (defaults to the cash-floor shortfall; editable upstream). */
  shortfallUsd: number
  /** Spot bitcoin price, USD per BTC. */
  btcPriceUsd: number
  /** Borrow cap / max LTV as a fraction of bitcoin value (0 = borrowing off). */
  borrowCapFraction: number
  /** Current full stack breakdown for before/after marks (walletSats = spendable). */
  stack: StackInput
  /** Lender-held collateral across open loans, available for a rollover draw. */
  rolloverCollateralSats: number
  /** Amount already due across open loans that a rollover must sit behind. */
  openLoanAmountDueUsd: number
  /**
   * Prefer borrowing over selling (from the user's price bands / borrow stance).
   * When true, borrow is ordered ahead of sell. Both always stay present while
   * borrowing is allowed.
   */
  preferBorrow?: boolean
}

export interface RefillOption {
  kind: RefillOptionKind
  /** Whether this path can actually raise money right now. */
  available: boolean
  /** Plain-language reason when unavailable (empty when available). */
  unavailableReason: string
  /** Cash this path raises toward the shortfall, USD (cents-rounded). */
  cashRaisedUsd: number
  /** Whether it covers the whole shortfall. */
  coversFullShortfall: boolean
  /** Sats sold (sell) or moved to the lender as new collateral (borrow). */
  satsMoved: number
  /** New debt taken on (borrow / rollover), USD. 0 for a sale. */
  newDebtUsd: number
  /** Stack mark before this option, USD. */
  stackBeforeUsd: number
  /** Stack mark after this option, USD (sell/borrow are ~neutral at mark). */
  stackAfterUsd: number
}

/** Spendable bitcoin value in USD at spot. */
function spendableValueUsd(stack: StackInput, priceUsd: number): number {
  return satsToUsd(Math.max(0, stack.walletSats || 0), priceUsd)
}

function buildSellOption(input: RefillOptionsInput): RefillOption {
  const { shortfallUsd, btcPriceUsd, stack } = input
  const spendableSats = Math.max(0, stack.walletSats || 0)
  const stackBeforeUsd = roundToCents(stackUsd(stack))
  const priceOk = btcPriceUsd > 0 && Number.isFinite(btcPriceUsd)

  if (spendableSats <= 0 || shortfallUsd <= 0 || !priceOk) {
    return {
      kind: "sell",
      available: false,
      unavailableReason:
        spendableSats <= 0
          ? "You don't have bitcoin on hand to sell."
          : !priceOk
            ? "We need a live bitcoin price to size a sale."
            : "Nothing to refill right now.",
      cashRaisedUsd: 0,
      coversFullShortfall: false,
      satsMoved: 0,
      newDebtUsd: 0,
      stackBeforeUsd,
      stackAfterUsd: stackBeforeUsd,
    }
  }

  const satsWanted = usdToSatsCeil(shortfallUsd, btcPriceUsd)
  const satsToSell = Math.min(satsWanted, spendableSats)
  const cashRaisedUsd = roundToCents(satsToUsd(satsToSell, btcPriceUsd))
  const afterStack = stackUsd({
    ...stack,
    walletSats: spendableSats - satsToSell,
    cashUsd: (stack.cashUsd || 0) + cashRaisedUsd,
  })
  return {
    kind: "sell",
    available: true,
    unavailableReason: "",
    cashRaisedUsd,
    coversFullShortfall: cashRaisedUsd >= shortfallUsd - 0.5,
    satsMoved: satsToSell,
    newDebtUsd: 0,
    stackBeforeUsd,
    stackAfterUsd: roundToCents(afterStack),
  }
}

function buildBorrowOption(input: RefillOptionsInput): RefillOption {
  const { shortfallUsd, btcPriceUsd, borrowCapFraction, stack } = input
  const spendableSats = Math.max(0, stack.walletSats || 0)
  const stackBeforeUsd = roundToCents(stackUsd(stack))
  const priceOk = btcPriceUsd > 0 && Number.isFinite(btcPriceUsd)
  const maxBorrowUsd = spendableValueUsd(stack, btcPriceUsd) * (borrowCapFraction || 0)

  if (
    borrowCapFraction <= 0 ||
    spendableSats <= 0 ||
    shortfallUsd <= 0 ||
    !priceOk ||
    maxBorrowUsd <= 0
  ) {
    return {
      kind: "borrow",
      available: false,
      unavailableReason:
        borrowCapFraction <= 0
          ? "Your answers say you'd rather not borrow against bitcoin."
          : spendableSats <= 0
            ? "You don't have bitcoin to pledge as collateral."
            : !priceOk
              ? "We need a live bitcoin price to size a loan."
              : "Nothing to refill right now.",
      cashRaisedUsd: 0,
      coversFullShortfall: false,
      satsMoved: 0,
      newDebtUsd: 0,
      stackBeforeUsd,
      stackAfterUsd: stackBeforeUsd,
    }
  }

  // Size so cash received = shortfall, capped by the borrow capacity.
  const principalUsd = roundToCents(Math.min(shortfallUsd, maxBorrowUsd))
  // Collateral that backs exactly this principal at the cap.
  const collateralSats = Math.min(
    usdToSatsCeil(principalUsd / borrowCapFraction, btcPriceUsd),
    spendableSats,
  )
  const afterStack = stackUsd({
    ...stack,
    // Coins move wallet → lender: they stay in the stack, just as collateral.
    walletSats: spendableSats - collateralSats,
    lenderHeldSats: (stack.lenderHeldSats || 0) + collateralSats,
    cashUsd: (stack.cashUsd || 0) + principalUsd,
    amountDueUsd: (stack.amountDueUsd || 0) + principalUsd,
  })
  return {
    kind: "borrow",
    available: true,
    unavailableReason: "",
    cashRaisedUsd: principalUsd,
    coversFullShortfall: principalUsd >= shortfallUsd - 0.5,
    satsMoved: collateralSats,
    newDebtUsd: principalUsd,
    stackBeforeUsd,
    stackAfterUsd: roundToCents(afterStack),
  }
}

function buildRolloverOption(input: RefillOptionsInput): RefillOption {
  const { shortfallUsd, btcPriceUsd, borrowCapFraction, stack } = input
  const stackBeforeUsd = roundToCents(stackUsd(stack))
  const priceOk = btcPriceUsd > 0 && Number.isFinite(btcPriceUsd)
  const collateralSats = Math.max(0, input.rolloverCollateralSats || 0)
  const maxBorrowOnCollateralUsd =
    satsToUsd(collateralSats, btcPriceUsd) * (borrowCapFraction || 0)
  const surplusUsd = maxBorrowOnCollateralUsd - Math.max(0, input.openLoanAmountDueUsd || 0)

  if (
    borrowCapFraction <= 0 ||
    collateralSats <= 0 ||
    shortfallUsd <= 0 ||
    !priceOk ||
    surplusUsd < shortfallUsd - 0.5
  ) {
    return {
      kind: "rollover",
      available: false,
      unavailableReason:
        borrowCapFraction <= 0
          ? "Your answers say you'd rather not borrow against bitcoin."
          : collateralSats <= 0
            ? "You have no bitcoin already with a lender to draw against."
            : !priceOk
              ? "We need a live bitcoin price to check your borrowing room."
              : "There isn't enough borrowing room left on your collateral.",
      cashRaisedUsd: 0,
      coversFullShortfall: false,
      satsMoved: 0,
      newDebtUsd: 0,
      stackBeforeUsd,
      stackAfterUsd: stackBeforeUsd,
    }
  }

  const principalUsd = roundToCents(shortfallUsd)
  const afterStack = stackUsd({
    ...stack,
    // Collateral already sits with the lender — only cash + debt move.
    cashUsd: (stack.cashUsd || 0) + principalUsd,
    amountDueUsd: (stack.amountDueUsd || 0) + principalUsd,
  })
  return {
    kind: "rollover",
    available: true,
    unavailableReason: "",
    cashRaisedUsd: principalUsd,
    coversFullShortfall: true,
    satsMoved: 0,
    newDebtUsd: principalUsd,
    stackBeforeUsd,
    stackAfterUsd: roundToCents(afterStack),
  }
}

/**
 * Build the refill option rows for the current shortfall. Sell is always
 * offered; borrow and rollover appear only while borrowing is allowed
 * (`borrowCapFraction > 0`), and rollover only when there is existing collateral
 * with a lender. Ordering of sell vs borrow follows `preferBorrow`; rollover is
 * listed last. Each row carries the stack mark before/after so the UI can show
 * "nothing really changes — you're just moving money."
 */
export function refillOptions(input: RefillOptionsInput): RefillOption[] {
  const sell = buildSellOption(input)
  const borrowingAllowed = input.borrowCapFraction > 0
  const out: RefillOption[] = []

  if (borrowingAllowed) {
    const borrow = buildBorrowOption(input)
    if (input.preferBorrow) out.push(borrow, sell)
    else out.push(sell, borrow)
    if ((input.rolloverCollateralSats || 0) > 0) {
      out.push(buildRolloverOption(input))
    }
  } else {
    out.push(sell)
  }
  return out
}

// ---------------------------------------------------------------------------
// Pending-sale state machine
// ---------------------------------------------------------------------------
//
// A refill-by-sale is not instant: coins leave a watched wallet, then cash
// arrives, then the deposit is linked to a budget transaction. Until the deposit
// is linked we hold a placeholder so the stack value doesn't disappear:
//   - sent             → sats counted as "bitcoin on the way" (marked at today's price)
//   - cash_on_the_way  → switch to "cash on the way" at the known proceeds
//   - linked           → placeholder cleared (the real transaction now counts)
//   - cancelled        → placeholder cleared; the stack falls (nothing expires alone)

export type PendingSaleStatus = "sent" | "cash_on_the_way" | "linked" | "cancelled"

export interface PendingSaleState {
  status: PendingSaleStatus
  /** Sats that left the wallet for this sale. */
  sats: number
  /** Spot price when the sale was sent (the "today's price" mark), USD/BTC. */
  markPriceUsd: number
  /** Known cash proceeds once the sale clears (null until known). */
  proceedsUsd: number | null
  /** Budget transaction the deposit was linked to, if any. */
  linkedTransactionId: string | null
}

/** Open a pending sale: coins have left the wallet, marked at today's price. */
export function applySaleSent(sats: number, markPriceUsd: number): PendingSaleState {
  return {
    status: "sent",
    sats: Math.max(0, Math.round(sats)),
    markPriceUsd: Math.max(0, markPriceUsd),
    proceedsUsd: null,
    linkedTransactionId: null,
  }
}

/** Record cash proceeds: switch the placeholder from bitcoin to cash on the way. */
export function applySaleProceeds(
  sale: PendingSaleState,
  proceedsUsd: number,
): PendingSaleState {
  return {
    ...sale,
    status: "cash_on_the_way",
    proceedsUsd: roundToCents(Math.max(0, proceedsUsd)),
  }
}

/** Link the deposit to a budget transaction: clears the placeholder. */
export function applySaleLinked(
  sale: PendingSaleState,
  linkedTransactionId?: string | null,
): PendingSaleState {
  return {
    ...sale,
    status: "linked",
    linkedTransactionId: linkedTransactionId ?? sale.linkedTransactionId ?? null,
  }
}

/** Cancel the sale: clears the placeholder so the stack falls back on its own. */
export function cancelSale(sale: PendingSaleState): PendingSaleState {
  return { ...sale, status: "cancelled" }
}

export interface SaleHoldingsContribution {
  bitcoinOnTheWaySats: number
  cashOnTheWayUsd: number
}

/** What one sale contributes to "on the way" holdings, by status. */
export function saleHoldingsContribution(
  sale: Pick<PendingSaleState, "status" | "sats" | "proceedsUsd">,
): SaleHoldingsContribution {
  switch (sale.status) {
    case "sent":
      return { bitcoinOnTheWaySats: Math.max(0, sale.sats), cashOnTheWayUsd: 0 }
    case "cash_on_the_way":
      return {
        bitcoinOnTheWaySats: 0,
        cashOnTheWayUsd: Math.max(0, sale.proceedsUsd ?? 0),
      }
    case "linked":
    case "cancelled":
      return { bitcoinOnTheWaySats: 0, cashOnTheWayUsd: 0 }
    default: {
      const _exhaustive: never = sale.status
      throw new Error(`Unhandled pending sale status: ${String(_exhaustive)}`)
    }
  }
}

/** Sum the "on the way" contribution across many sales (open ones only count). */
export function sumSaleHoldings(
  sales: readonly Pick<PendingSaleState, "status" | "sats" | "proceedsUsd">[],
): SaleHoldingsContribution {
  return sales.reduce<SaleHoldingsContribution>(
    (acc, sale) => {
      const c = saleHoldingsContribution(sale)
      return {
        bitcoinOnTheWaySats: acc.bitcoinOnTheWaySats + c.bitcoinOnTheWaySats,
        cashOnTheWayUsd: roundToCents(acc.cashOnTheWayUsd + c.cashOnTheWayUsd),
      }
    },
    { bitcoinOnTheWaySats: 0, cashOnTheWayUsd: 0 },
  )
}
