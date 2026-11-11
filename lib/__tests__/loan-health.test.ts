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

  it("returns null percent when price is not positive", () => {
    expect(liquidationDistance({ btcPriceUsd: 0, lenderSellPriceUsd: 10 }).percent).toBeNull()
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
