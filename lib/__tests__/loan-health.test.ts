import { describe, expect, it } from "vitest"
import {
  amountDueUsd,
  btcToSats,
  daysBetween,
  evaluateLoan,
  evaluateLoans,
  liquidationDistance,
  maturityBillUsd,
  maturityInterestUsd,
  rolloverPriceUsd,
  satsToUsd,
  stackUsd,
  type BtcLoanInput,
} from "@/lib/loan-health"

const ONE_BTC = 100_000_000

// Worked example: BTC $100k, send 1 BTC, receive $50k, 10% APR, 365-day term,
// so the maturity bill is $55k.
const workedLoan: BtcLoanInput = {
  id: "worked",
  principalUsd: 50_000,
  aprFraction: 0.1,
  openDate: "2025-01-01",
  maturityDate: "2026-01-01",
  payoffStyle: "accrued",
  collateralSats: ONE_BTC,
  liquidationPriceUsd: 62_500,
}

describe("daysBetween / conversions", () => {
  it("counts whole UTC days between dates", () => {
    expect(daysBetween("2025-01-01", "2026-01-01")).toBe(365)
    expect(daysBetween("2025-01-01", "2025-01-01")).toBe(0)
    expect(daysBetween("2026-01-01", "2025-01-01")).toBe(-365)
  })

  it("values sats in USD and converts BTC to sats", () => {
    expect(satsToUsd(ONE_BTC, 100_000)).toBeCloseTo(100_000, 6)
    expect(satsToUsd(ONE_BTC / 2, 100_000)).toBeCloseTo(50_000, 6)
    expect(btcToSats(1)).toBe(ONE_BTC)
    expect(btcToSats(0.25)).toBe(25_000_000)
  })

  it("rejects impossible calendar days instead of rolling them forward", () => {
    expect(daysBetween("2024-02-29", "2024-03-01")).toBe(1)
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366)
    expect(daysBetween("2025-02-29", "2025-03-01")).toBeNaN()
    expect(daysBetween("2025-02-31", "2025-03-03")).toBeNaN()
    expect(daysBetween("not-a-date", "2025-01-01")).toBeNaN()
  })
})

describe("interest / amount due (actual/365, balloon)", () => {
  it("matches the worked example maturity bill exactly", () => {
    expect(maturityInterestUsd(workedLoan)).toBeCloseTo(5_000, 6)
    expect(maturityBillUsd(workedLoan)).toBeCloseTo(55_000, 6)
  })

  it("accrued style: due starts at principal and grows to the full bill", () => {
    expect(amountDueUsd(workedLoan, "2025-01-01")).toBeCloseTo(50_000, 6)
    // ~half the year elapsed
    const half = amountDueUsd(workedLoan, "2025-07-02")
    expect(half).toBeGreaterThan(52_000)
    expect(half).toBeLessThan(53_000)
    expect(amountDueUsd(workedLoan, "2026-01-01")).toBeCloseTo(55_000, 6)
  })

  it("accrued style clamps before open and after maturity", () => {
    expect(amountDueUsd(workedLoan, "2024-06-01")).toBeCloseTo(50_000, 6)
    expect(amountDueUsd(workedLoan, "2030-01-01")).toBeCloseTo(55_000, 6)
  })

  it("full_bill style locks the full maturity interest from day one", () => {
    const fullBill: BtcLoanInput = { ...workedLoan, payoffStyle: "full_bill" }
    expect(amountDueUsd(fullBill, "2025-01-01")).toBeCloseTo(55_000, 6)
    expect(amountDueUsd(fullBill, "2025-07-02")).toBeCloseTo(55_000, 6)
    expect(amountDueUsd(fullBill, "2026-01-01")).toBeCloseTo(55_000, 6)
  })
})

describe("maturity bill override honored at the source of truth", () => {
  // Same worked loan, but the user typed a $60k final bill (vs computed $55k).
  const overrideLoan: BtcLoanInput = { ...workedLoan, maturityBillOverrideUsd: 60_000 }

  it("maturityBillUsd returns the override instead of computed principal+interest", () => {
    expect(maturityBillUsd(overrideLoan)).toBeCloseTo(60_000, 6)
    // Interest portion stays consistent: bill − principal = 10_000.
    expect(maturityInterestUsd(overrideLoan)).toBeCloseTo(10_000, 6)
  })

  it("full_bill due uses the override for the whole term", () => {
    const fullBill: BtcLoanInput = { ...overrideLoan, payoffStyle: "full_bill" }
    expect(amountDueUsd(fullBill, "2025-01-01")).toBeCloseTo(60_000, 6)
    expect(amountDueUsd(fullBill, "2026-01-01")).toBeCloseTo(60_000, 6)
  })

  it("accrued due interpolates toward the override bill and hits it at maturity", () => {
    expect(amountDueUsd(overrideLoan, "2025-01-01")).toBeCloseTo(50_000, 6)
    expect(amountDueUsd(overrideLoan, "2026-01-01")).toBeCloseTo(60_000, 6)
  })

  it("evaluateLoan reports the override bill and derived interest", () => {
    const row = evaluateLoan(overrideLoan, {
      btcPriceUsd: 100_000,
      asOfDate: "2026-01-01",
      borrowCapFraction: 0.5,
    })
    expect(row.billAtMaturityUsd).toBeCloseTo(60_000, 6)
    expect(row.maturityInterestUsd).toBeCloseTo(10_000, 6)
    expect(row.amountDueTodayUsd).toBeCloseTo(60_000, 6)
  })

  it("ignores a non-finite override and falls back to the computed bill", () => {
    const bad: BtcLoanInput = { ...workedLoan, maturityBillOverrideUsd: Number.NaN }
    expect(maturityBillUsd(bad)).toBeCloseTo(55_000, 6)
    const cleared: BtcLoanInput = { ...workedLoan, maturityBillOverrideUsd: null }
    expect(maturityBillUsd(cleared)).toBeCloseTo(55_000, 6)
  })

  it("accrued same-day term owes principal before open and the bill on open", () => {
    const sameDay: BtcLoanInput = {
      ...workedLoan,
      openDate: "2026-06-01",
      maturityDate: "2026-06-01",
      maturityBillOverrideUsd: 60_000,
    }
    expect(amountDueUsd(sameDay, "2026-05-31")).toBeCloseTo(50_000, 6)
    expect(amountDueUsd(sameDay, "2026-06-01")).toBeCloseTo(60_000, 6)
    expect(amountDueUsd(sameDay, "2026-06-02")).toBeCloseTo(60_000, 6)
  })

  it("accrued same-day term without an override stays at principal", () => {
    const sameDay: BtcLoanInput = {
      ...workedLoan,
      openDate: "2026-06-01",
      maturityDate: "2026-06-01",
    }
    expect(amountDueUsd(sameDay, "2026-05-31")).toBeCloseTo(50_000, 6)
    expect(amountDueUsd(sameDay, "2026-06-01")).toBeCloseTo(50_000, 6)
  })

  it("full_bill same-day term keeps the full bill before open", () => {
    const sameDay: BtcLoanInput = {
      ...workedLoan,
      openDate: "2026-06-01",
      maturityDate: "2026-06-01",
      payoffStyle: "full_bill",
      maturityBillOverrideUsd: 60_000,
    }
    expect(amountDueUsd(sameDay, "2026-05-31")).toBeCloseTo(60_000, 6)
    expect(amountDueUsd(sameDay, "2026-06-01")).toBeCloseTo(60_000, 6)
  })
})

describe("stack identity", () => {
  it("is unchanged at open under accrued style (loan is stack-neutral)", () => {
    const beforeLoan = stackUsd({
      cashUsd: 0,
      walletSats: ONE_BTC,
      lenderHeldSats: 0,
      amountDueUsd: 0,
      btcPriceUsd: 100_000,
    })
    const atOpen = stackUsd({
      cashUsd: 50_000, // cash received
      walletSats: 0, // sent the whole coin
      lenderHeldSats: ONE_BTC, // lender holds collateral
      amountDueUsd: amountDueUsd(workedLoan, "2025-01-01"),
      btcPriceUsd: 100_000,
    })
    expect(beforeLoan).toBeCloseTo(100_000, 6)
    expect(atOpen).toBeCloseTo(100_000, 6)
  })

  it("accrued interest erodes the stack over the term", () => {
    const atMaturity = stackUsd({
      cashUsd: 50_000,
      walletSats: 0,
      lenderHeldSats: ONE_BTC,
      amountDueUsd: amountDueUsd(workedLoan, "2026-01-01"),
      btcPriceUsd: 100_000,
    })
    expect(atMaturity).toBeCloseTo(95_000, 6) // down by the $5k interest
  })

  it("full_bill steps the stack down by the full interest at open", () => {
    const fullBill: BtcLoanInput = { ...workedLoan, payoffStyle: "full_bill" }
    const atOpen = stackUsd({
      cashUsd: 50_000,
      walletSats: 0,
      lenderHeldSats: ONE_BTC,
      amountDueUsd: amountDueUsd(fullBill, "2025-01-01"),
      btcPriceUsd: 100_000,
    })
    expect(atOpen).toBeCloseTo(95_000, 6)
  })

  it("payoff moves pieces together and leaves the stack unchanged", () => {
    const cashUsd = 60_000
    const due = amountDueUsd(workedLoan, "2026-01-01") // 55_000
    const before = stackUsd({
      cashUsd,
      walletSats: 0,
      lenderHeldSats: ONE_BTC,
      amountDueUsd: due,
      btcPriceUsd: 100_000,
    })
    const afterPayoff = stackUsd({
      cashUsd: cashUsd - due, // paid the bill
      walletSats: ONE_BTC, // coin returned to wallet
      lenderHeldSats: 0,
      amountDueUsd: 0,
      btcPriceUsd: 100_000,
    })
    expect(afterPayoff).toBeCloseTo(before, 6)
  })

  it("liquidation removes the coin and clears the due", () => {
    const afterLiquidation = stackUsd({
      cashUsd: 50_000, // cash from the original draw stays
      walletSats: 0,
      lenderHeldSats: 0, // lender sold the collateral
      amountDueUsd: 0, // ...to clear the debt
      btcPriceUsd: 100_000,
    })
    expect(afterLiquidation).toBeCloseTo(50_000, 6)
  })

  it("counts cash and bitcoin on the way", () => {
    const s = stackUsd({
      cashUsd: 1_000,
      cashOnTheWayUsd: 500,
      walletSats: ONE_BTC,
      lenderHeldSats: 0,
      bitcoinOnTheWaySats: ONE_BTC / 2,
      amountDueUsd: 0,
      btcPriceUsd: 100_000,
    })
    expect(s).toBeCloseTo(1_000 + 500 + 100_000 + 50_000, 6)
  })
})

describe("liquidation distance", () => {
  it("reports absolute and percent room", () => {
    const d = liquidationDistance({ btcPriceUsd: 100_000, lenderSellPriceUsd: 62_500 })
    expect(d.absoluteUsd).toBeCloseTo(37_500, 6)
    expect(d.percent).toBeCloseTo(0.375, 6)
  })

  it("goes negative once price is below the sell price", () => {
    const d = liquidationDistance({ btcPriceUsd: 50_000, lenderSellPriceUsd: 62_500 })
    expect(d.absoluteUsd).toBeCloseTo(-12_500, 6)
    expect(d.percent).toBeCloseTo(-0.25, 6)
  })

  it("returns null distance when price is not a positive finite quote", () => {
    const zero = liquidationDistance({ btcPriceUsd: 0, lenderSellPriceUsd: 10 })
    expect(zero.percent).toBeNull()
    expect(zero.absoluteUsd).toBeNull()
    const infinite = liquidationDistance({
      btcPriceUsd: Number.POSITIVE_INFINITY,
      lenderSellPriceUsd: 10,
    })
    expect(infinite.absoluteUsd).toBeNull()
    expect(infinite.percent).toBeNull()
    const badSell = liquidationDistance({
      btcPriceUsd: 100_000,
      lenderSellPriceUsd: Number.NaN,
    })
    expect(badSell.absoluteUsd).toBeNull()
    expect(badSell.percent).toBeNull()
  })

  it("is exactly zero when spot equals the sell price", () => {
    const d = liquidationDistance({ btcPriceUsd: 62_500, lenderSellPriceUsd: 62_500 })
    expect(d.absoluteUsd).toBe(0)
    expect(d.percent).toBe(0)
  })
})

describe("rollover price", () => {
  it("is the price where a capped loan on the collateral covers the bill", () => {
    expect(
      rolloverPriceUsd({ amountDueUsd: 55_000, collateralSats: ONE_BTC, borrowCapFraction: 0.5 }),
    ).toBeCloseTo(110_000, 6)
  })

  it("returns Infinity with no collateral or no borrow capacity", () => {
    expect(
      rolloverPriceUsd({ amountDueUsd: 55_000, collateralSats: 0, borrowCapFraction: 0.5 }),
    ).toBe(Number.POSITIVE_INFINITY)
    expect(
      rolloverPriceUsd({ amountDueUsd: 55_000, collateralSats: ONE_BTC, borrowCapFraction: 0 }),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it("returns 0 for a zero bill even when there is no collateral", () => {
    expect(
      rolloverPriceUsd({ amountDueUsd: 0, collateralSats: 0, borrowCapFraction: 0.5 }),
    ).toBe(0)
    expect(
      rolloverPriceUsd({ amountDueUsd: 0, collateralSats: ONE_BTC, borrowCapFraction: 0 }),
    ).toBe(0)
  })
})

describe("evaluateLoan / evaluateLoans", () => {
  it("summarizes a single loan row", () => {
    const row = evaluateLoan(workedLoan, {
      btcPriceUsd: 100_000,
      asOfDate: "2025-01-01",
      borrowCapFraction: 0.5,
    })
    expect(row.id).toBe("worked")
    expect(row.billAtMaturityUsd).toBeCloseTo(55_000, 6)
    expect(row.maturityInterestUsd).toBeCloseTo(5_000, 6)
    expect(row.amountDueTodayUsd).toBeCloseTo(50_000, 6)
    expect(row.liquidationRoom.absoluteUsd).toBeCloseTo(37_500, 6)
    expect(row.rolloverPriceUsd).toBeCloseTo(100_000, 6) // due today 50k / 0.5 = 100k
    // At $100k, max borrow (0.5 LTV on 1 BTC) = $50k, exactly covers today's $50k due.
    expect(row.rolloverCoversBillAtToday).toBe(true)
  })

  it("flags when a rollover at today's price no longer covers the grown bill", () => {
    const row = evaluateLoan(workedLoan, {
      btcPriceUsd: 100_000,
      asOfDate: "2026-01-01", // due grew to $55k; max borrow still $50k
      borrowCapFraction: 0.5,
    })
    expect(row.amountDueTodayUsd).toBeCloseTo(55_000, 6)
    expect(row.rolloverCoversBillAtToday).toBe(false)
    expect(row.rolloverPriceUsd).toBeCloseTo(110_000, 6)
  })

  it("aggregates a list of loans", () => {
    const second: BtcLoanInput = {
      ...workedLoan,
      id: "second",
      principalUsd: 20_000,
      collateralSats: ONE_BTC / 2,
    }
    const result = evaluateLoans([workedLoan, second], {
      btcPriceUsd: 100_000,
      asOfDate: "2026-01-01",
      borrowCapFraction: 0.5,
    })
    expect(result.loans).toHaveLength(2)
    expect(result.totalLenderHeldSats).toBe(ONE_BTC + ONE_BTC / 2)
    // worked bill 55k + second bill (20k + 10% = 22k) = 77k
    expect(result.totalBillAtMaturityUsd).toBeCloseTo(77_000, 6)
    expect(result.totalAmountDueTodayUsd).toBeCloseTo(77_000, 6)
  })
})

describe("infinity, zero price, maturity, rounding", () => {
  it("uses actual/365 across a leap-year span and refuses a rolled maturity", () => {
    const leap: BtcLoanInput = {
      ...workedLoan,
      openDate: "2024-01-01",
      maturityDate: "2025-01-01",
    }
    expect(maturityInterestUsd(leap)).toBeCloseTo(50_000 * 0.1 * (366 / 365), 8)
    const impossible: BtcLoanInput = { ...workedLoan, maturityDate: "2025-02-31" }
    expect(maturityBillUsd(impossible)).toBeNaN()
    expect(amountDueUsd(impossible, "2025-06-01")).toBeNaN()
    expect(amountDueUsd({ ...impossible, payoffStyle: "full_bill" }, "2025-01-01")).toBeNaN()
  })

  it("does not turn a non-finite APR into zero interest on one path and NaN on the other", () => {
    const badApr: BtcLoanInput = { ...workedLoan, aprFraction: Number.POSITIVE_INFINITY }
    expect(maturityInterestUsd(badApr)).toBeNaN()
    expect(maturityBillUsd(badApr)).toBeNaN()
    expect(amountDueUsd(badApr, "2025-07-02")).toBeNaN()
    expect(amountDueUsd({ ...badApr, payoffStyle: "full_bill" }, "2025-01-01")).toBeNaN()
  })

  it("does not value held bitcoin at $0 when the quote is non-finite, or drop a NaN bill", () => {
    expect(satsToUsd(0, Number.POSITIVE_INFINITY)).toBe(0)
    expect(satsToUsd(ONE_BTC, 0)).toBe(0)
    expect(satsToUsd(ONE_BTC, Number.POSITIVE_INFINITY)).toBeNaN()
    expect(satsToUsd(ONE_BTC, -1)).toBeNaN()

    expect(
      stackUsd({
        cashUsd: 1_000,
        walletSats: ONE_BTC,
        lenderHeldSats: 0,
        amountDueUsd: 0,
        btcPriceUsd: Number.POSITIVE_INFINITY,
      }),
    ).toBeNaN()
    expect(
      stackUsd({
        cashUsd: 1_000,
        walletSats: 0,
        lenderHeldSats: 0,
        amountDueUsd: 0,
        btcPriceUsd: Number.POSITIVE_INFINITY,
      }),
    ).toBe(1_000)
    expect(
      stackUsd({
        cashUsd: 1_000,
        walletSats: ONE_BTC,
        lenderHeldSats: 0,
        amountDueUsd: 400,
        btcPriceUsd: 0,
      }),
    ).toBe(600)
    expect(
      stackUsd({
        cashUsd: 50_000,
        walletSats: 0,
        lenderHeldSats: 0,
        amountDueUsd: Number.NaN,
        btcPriceUsd: 100_000,
      }),
    ).toBeNaN()
  })

  it("rounds half-sats away from zero", () => {
    expect(btcToSats(1.5e-8)).toBe(2)
    expect(btcToSats(-1.5e-8)).toBe(-2)
    expect(btcToSats(-5e-9)).toBe(-1)
    expect(btcToSats(1.49e-8)).toBe(1)
    expect(btcToSats(1.6e-8)).toBe(2)
    expect(btcToSats(Number.POSITIVE_INFINITY)).toBeNaN()
    expect(btcToSats(1e12)).toBeNaN()
  })

  it("keeps rollover infinity for a positive bill only", () => {
    expect(
      rolloverPriceUsd({ amountDueUsd: 0, collateralSats: 0, borrowCapFraction: 0 }),
    ).toBe(0)
    expect(
      rolloverPriceUsd({
        amountDueUsd: 55_000,
        collateralSats: -ONE_BTC,
        borrowCapFraction: -0.5,
      }),
    ).toBe(Number.POSITIVE_INFINITY)
    expect(
      rolloverPriceUsd({
        amountDueUsd: 55_000,
        collateralSats: ONE_BTC,
        borrowCapFraction: Number.NaN,
      }),
    ).toBeNaN()
    expect(
      rolloverPriceUsd({
        amountDueUsd: Number.POSITIVE_INFINITY,
        collateralSats: ONE_BTC,
        borrowCapFraction: 0.5,
      }),
    ).toBeNaN()
  })

  it("does not report a liquidation or a covered rollover at a $0 spot", () => {
    const row = evaluateLoan(workedLoan, {
      btcPriceUsd: 0,
      asOfDate: "2025-01-01",
      borrowCapFraction: 0.5,
    })
    expect(row.liquidationRoom.absoluteUsd).toBeNull()
    expect(row.liquidationRoom.percent).toBeNull()
    expect(row.rolloverCoversBillAtToday).toBe(false)
    expect(row.rolloverPriceUsd).toBeCloseTo(100_000, 6)
  })

  it("treats a one-ulp rollover breakeven as covered", () => {
    const row = evaluateLoan(
      { ...workedLoan, principalUsd: 9.9e-7, collateralSats: 1 },
      { btcPriceUsd: 100, asOfDate: "2025-01-01", borrowCapFraction: 0.99 },
    )
    expect(row.amountDueTodayUsd).toBeCloseTo(9.9e-7, 12)
    expect(row.rolloverPriceUsd).toBeGreaterThan(100)
    expect(row.rolloverPriceUsd - 100).toBeLessThan(1e-9)
    expect(row.rolloverCoversBillAtToday).toBe(true)
  })

  it("does not publish a finite portfolio total when one maturity is impossible", () => {
    const result = evaluateLoans(
      [workedLoan, { ...workedLoan, id: "bad", maturityDate: "2025-02-31" }],
      { btcPriceUsd: 100_000, asOfDate: "2026-01-01", borrowCapFraction: 0.5 },
    )
    expect(result.totalBillAtMaturityUsd).toBeNaN()
    expect(result.totalAmountDueTodayUsd).toBeNaN()
  })
})
