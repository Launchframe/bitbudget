import { describe, expect, it } from "vitest"
import {
  applySaleLinked,
  applySaleProceeds,
  applySaleSent,
  cancelSale,
  cashFloorShortfall,
  monthsUntilFloorBreach,
  paycheckShortfallCoverage,
  refillOptions,
  saleHoldingsContribution,
  sumSaleHoldings,
  type RefillOptionsInput,
} from "../runway-refill"
import { stackUsd, type StackInput } from "../loan-health"

const BTC_PRICE = 100_000
// At $100k/BTC, $1 == 1000 sats, so $1,000 == 1,000,000 sats.

describe("cashFloorShortfall", () => {
  it("is zero when cash is at or above the floor", () => {
    expect(cashFloorShortfall({ cashUsd: 5_000, cashFloorUsd: 5_000 })).toEqual({
      shortfallUsd: 0,
      underFloor: false,
      reason: null,
    })
    expect(cashFloorShortfall({ cashUsd: 6_000, cashFloorUsd: 5_000 }).underFloor).toBe(
      false,
    )
  })

  it("reports the dollar shortfall when under the floor", () => {
    const r = cashFloorShortfall({ cashUsd: 3_200, cashFloorUsd: 5_000 })
    expect(r.shortfallUsd).toBe(1_800)
    expect(r.underFloor).toBe(true)
    expect(r.reason).toBeNull()
  })

  it("classifies cash falling vs the floor rising", () => {
    expect(
      cashFloorShortfall({
        cashUsd: 3_000,
        cashFloorUsd: 5_000,
        previousCashUsd: 6_000,
        previousCashFloorUsd: 5_000,
      }).reason,
    ).toBe("cash_fell")
    expect(
      cashFloorShortfall({
        cashUsd: 4_800,
        cashFloorUsd: 5_000,
        previousCashUsd: 4_800,
        previousCashFloorUsd: 4_000,
      }).reason,
    ).toBe("floor_rose")
    expect(
      cashFloorShortfall({
        cashUsd: 3_000,
        cashFloorUsd: 5_000,
        previousCashUsd: 6_000,
        previousCashFloorUsd: 4_000,
      }).reason,
    ).toBe("both")
  })

  it("rounds the shortfall to cents", () => {
    expect(cashFloorShortfall({ cashUsd: 100.004, cashFloorUsd: 200.016 }).shortfallUsd).toBe(
      100.01,
    )
  })
})

describe("monthsUntilFloorBreach", () => {
  it("returns 0 when already at/under the floor", () => {
    expect(
      monthsUntilFloorBreach({ cashUsd: 5_000, cashFloorUsd: 5_000, netMonthlyCashFlowUsd: -500 }),
    ).toBe(0)
    expect(
      monthsUntilFloorBreach({ cashUsd: 4_000, cashFloorUsd: 5_000, netMonthlyCashFlowUsd: -500 }),
    ).toBe(0)
  })

  it("returns null when cash is above the floor and net flow is non-negative", () => {
    expect(
      monthsUntilFloorBreach({ cashUsd: 8_000, cashFloorUsd: 5_000, netMonthlyCashFlowUsd: 0 }),
    ).toBeNull()
    expect(
      monthsUntilFloorBreach({ cashUsd: 8_000, cashFloorUsd: 5_000, netMonthlyCashFlowUsd: 200 }),
    ).toBeNull()
  })

  it("projects months to breach from a draining net flow", () => {
    // $3,000 of headroom draining at $750/mo → 4 months.
    expect(
      monthsUntilFloorBreach({ cashUsd: 8_000, cashFloorUsd: 5_000, netMonthlyCashFlowUsd: -750 }),
    ).toBe(4)
  })
})

describe("paycheckShortfallCoverage", () => {
  it("covers the whole shortfall when the paycheck is big enough", () => {
    expect(paycheckShortfallCoverage(1_000, 1_500)).toEqual({
      coveredUsd: 1_000,
      remainingUsd: 0,
      coversFull: true,
    })
  })

  it("covers part of the shortfall", () => {
    expect(paycheckShortfallCoverage(1_000, 400)).toEqual({
      coveredUsd: 400,
      remainingUsd: 600,
      coversFull: false,
    })
  })

  it("is not 'full' when there is no shortfall", () => {
    expect(paycheckShortfallCoverage(0, 400).coversFull).toBe(false)
  })
})

function makeStack(overrides: Partial<StackInput> = {}): StackInput {
  return {
    cashUsd: 3_000,
    walletSats: 100_000_000, // 1 BTC spendable
    lenderHeldSats: 0,
    amountDueUsd: 0,
    btcPriceUsd: BTC_PRICE,
    ...overrides,
  }
}

function makeRefillInput(overrides: Partial<RefillOptionsInput> = {}): RefillOptionsInput {
  return {
    shortfallUsd: 2_000,
    btcPriceUsd: BTC_PRICE,
    borrowCapFraction: 0.4,
    stack: makeStack(),
    rolloverCollateralSats: 0,
    openLoanAmountDueUsd: 0,
    ...overrides,
  }
}

describe("refillOptions — sell", () => {
  it("sells enough bitcoin to cover the shortfall and is stack-neutral", () => {
    const opts = refillOptions(makeRefillInput())
    const sell = opts.find((o) => o.kind === "sell")!
    expect(sell.available).toBe(true)
    // $2,000 at $100k == 2,000,000 sats.
    expect(sell.satsMoved).toBe(2_000_000)
    expect(sell.cashRaisedUsd).toBe(2_000)
    expect(sell.coversFullShortfall).toBe(true)
    expect(sell.newDebtUsd).toBe(0)
    // Converting bitcoin to cash doesn't change the stack mark.
    expect(sell.stackAfterUsd).toBeCloseTo(sell.stackBeforeUsd, 2)
  })

  it("is unavailable with no spendable bitcoin", () => {
    const opts = refillOptions(makeRefillInput({ stack: makeStack({ walletSats: 0 }) }))
    const sell = opts.find((o) => o.kind === "sell")!
    expect(sell.available).toBe(false)
    expect(sell.unavailableReason).toMatch(/don't have bitcoin/i)
  })

  it("caps the sale at available bitcoin (partial cover)", () => {
    // Only 0.01 BTC spendable == $1,000, less than the $2,000 shortfall.
    const opts = refillOptions(
      makeRefillInput({ stack: makeStack({ walletSats: 1_000_000 }) }),
    )
    const sell = opts.find((o) => o.kind === "sell")!
    expect(sell.satsMoved).toBe(1_000_000)
    expect(sell.cashRaisedUsd).toBe(1_000)
    expect(sell.coversFullShortfall).toBe(false)
  })
})

describe("refillOptions — borrow", () => {
  it("borrows exactly the shortfall and keeps coins in the stack as collateral", () => {
    const opts = refillOptions(makeRefillInput())
    const borrow = opts.find((o) => o.kind === "borrow")!
    expect(borrow.available).toBe(true)
    expect(borrow.cashRaisedUsd).toBe(2_000)
    expect(borrow.newDebtUsd).toBe(2_000)
    expect(borrow.coversFullShortfall).toBe(true)
    // Collateral for $2,000 at a 0.4 cap == $5,000 of bitcoin == 5,000,000 sats.
    expect(borrow.satsMoved).toBe(5_000_000)
    // Stack-neutral at open (cash up, matching debt up, coins stay).
    expect(borrow.stackAfterUsd).toBeCloseTo(borrow.stackBeforeUsd, 2)
  })

  it("is dropped entirely when borrowing is not allowed", () => {
    const opts = refillOptions(makeRefillInput({ borrowCapFraction: 0 }))
    expect(opts.map((o) => o.kind)).toEqual(["sell"])
  })

  it("caps the loan at the borrow capacity (partial cover)", () => {
    // 0.01 BTC spendable == $1,000 value; at a 0.4 cap max borrow == $400.
    const opts = refillOptions(
      makeRefillInput({ stack: makeStack({ walletSats: 1_000_000 }) }),
    )
    const borrow = opts.find((o) => o.kind === "borrow")!
    expect(borrow.cashRaisedUsd).toBe(400)
    expect(borrow.coversFullShortfall).toBe(false)
  })
})

describe("refillOptions — rollover", () => {
  it("offers a rollover draw when collateral has surplus borrowing room", () => {
    // 1 BTC with the lender == $100k; at a 0.4 cap max borrow == $40k; $5k due
    // leaves $35k of surplus, well over the $2k shortfall.
    const opts = refillOptions(
      makeRefillInput({
        rolloverCollateralSats: 100_000_000,
        openLoanAmountDueUsd: 5_000,
        stack: makeStack({ lenderHeldSats: 100_000_000, amountDueUsd: 5_000 }),
      }),
    )
    const rollover = opts.find((o) => o.kind === "rollover")!
    expect(rollover.available).toBe(true)
    expect(rollover.cashRaisedUsd).toBe(2_000)
    expect(rollover.newDebtUsd).toBe(2_000)
    expect(rollover.satsMoved).toBe(0)
    expect(rollover.coversFullShortfall).toBe(true)
  })

  it("is unavailable when surplus is less than the shortfall", () => {
    // Max borrow $40k, already $39k due → only $1k surplus < $2k shortfall.
    const opts = refillOptions(
      makeRefillInput({
        rolloverCollateralSats: 100_000_000,
        openLoanAmountDueUsd: 39_000,
        stack: makeStack({ lenderHeldSats: 100_000_000, amountDueUsd: 39_000 }),
      }),
    )
    const rollover = opts.find((o) => o.kind === "rollover")!
    expect(rollover.available).toBe(false)
    expect(rollover.unavailableReason).toMatch(/borrowing room/i)
  })

  it("is not listed when there is no lender-held collateral", () => {
    const opts = refillOptions(makeRefillInput({ rolloverCollateralSats: 0 }))
    expect(opts.some((o) => o.kind === "rollover")).toBe(false)
  })
})

describe("refillOptions — ordering", () => {
  it("lists sell before borrow by default", () => {
    const opts = refillOptions(makeRefillInput())
    expect(opts.map((o) => o.kind)).toEqual(["sell", "borrow"])
  })

  it("lists borrow before sell when preferBorrow is set", () => {
    const opts = refillOptions(makeRefillInput({ preferBorrow: true }))
    expect(opts.slice(0, 2).map((o) => o.kind)).toEqual(["borrow", "sell"])
  })

  it("keeps both sell and borrow present when borrowing is allowed", () => {
    const opts = refillOptions(makeRefillInput())
    expect(opts.some((o) => o.kind === "sell")).toBe(true)
    expect(opts.some((o) => o.kind === "borrow")).toBe(true)
  })
})

describe("pending-sale state machine", () => {
  it("opens a sale marked at today's price", () => {
    const sale = applySaleSent(2_000_000, BTC_PRICE)
    expect(sale.status).toBe("sent")
    expect(sale.sats).toBe(2_000_000)
    expect(sale.markPriceUsd).toBe(BTC_PRICE)
    expect(sale.proceedsUsd).toBeNull()
  })

  it("counts a sent sale as bitcoin on the way", () => {
    const sale = applySaleSent(2_000_000, BTC_PRICE)
    expect(saleHoldingsContribution(sale)).toEqual({
      bitcoinOnTheWaySats: 2_000_000,
      cashOnTheWayUsd: 0,
    })
  })

  it("switches to cash on the way once proceeds are known", () => {
    const sale = applySaleProceeds(applySaleSent(2_000_000, BTC_PRICE), 1_950)
    expect(sale.status).toBe("cash_on_the_way")
    expect(sale.proceedsUsd).toBe(1_950)
    expect(saleHoldingsContribution(sale)).toEqual({
      bitcoinOnTheWaySats: 0,
      cashOnTheWayUsd: 1_950,
    })
  })

  it("clears the placeholder once the deposit is linked", () => {
    const sale = applySaleLinked(
      applySaleProceeds(applySaleSent(2_000_000, BTC_PRICE), 1_950),
      "txn_123",
    )
    expect(sale.status).toBe("linked")
    expect(sale.linkedTransactionId).toBe("txn_123")
    expect(saleHoldingsContribution(sale)).toEqual({
      bitcoinOnTheWaySats: 0,
      cashOnTheWayUsd: 0,
    })
  })

  it("lets the stack fall when a sale is cancelled", () => {
    const sale = cancelSale(applySaleSent(2_000_000, BTC_PRICE))
    expect(sale.status).toBe("cancelled")
    expect(saleHoldingsContribution(sale)).toEqual({
      bitcoinOnTheWaySats: 0,
      cashOnTheWayUsd: 0,
    })
  })

  it("sums only open sales' on-the-way holdings", () => {
    const sales = [
      applySaleSent(1_000_000, BTC_PRICE), // bitcoin on the way
      applySaleProceeds(applySaleSent(2_000_000, BTC_PRICE), 1_900), // cash on the way
      applySaleLinked(applySaleSent(3_000_000, BTC_PRICE)), // cleared
      cancelSale(applySaleSent(4_000_000, BTC_PRICE)), // cleared
    ]
    expect(sumSaleHoldings(sales)).toEqual({
      bitcoinOnTheWaySats: 1_000_000,
      cashOnTheWayUsd: 1_900,
    })
  })

  it("keeps the stack mark whole while a sale is on the way (no value disappears)", () => {
    // Before: 1 BTC in wallet. Sending 0.02 BTC out drops walletSats but the
    // 'bitcoin on the way' placeholder keeps the stack mark identical.
    const before = stackUsd({
      cashUsd: 3_000,
      walletSats: 100_000_000,
      lenderHeldSats: 0,
      amountDueUsd: 0,
      btcPriceUsd: BTC_PRICE,
    })
    const sale = applySaleSent(2_000_000, BTC_PRICE)
    const c = saleHoldingsContribution(sale)
    const afterSent = stackUsd({
      cashUsd: 3_000,
      walletSats: 100_000_000 - 2_000_000,
      lenderHeldSats: 0,
      bitcoinOnTheWaySats: c.bitcoinOnTheWaySats,
      amountDueUsd: 0,
      btcPriceUsd: BTC_PRICE,
    })
    expect(afterSent).toBeCloseTo(before, 2)
  })
})
