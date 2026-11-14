import { describe, expect, it } from "vitest"
import {
  activeScenarios,
  computeRunwayNeed,
  computeRunwayNeedVariants,
  historicalCagrs,
  type PlannedLine,
  type RunwayHoldingsInput,
  type RunwayNeedInput,
  type RunwayScenario,
  type ScenarioMode,
} from "../runway-need"

const BTC_PRICE = 100_000
const ONE_BTC_SATS = 100_000_000

const baseHoldings: RunwayHoldingsInput = {
  envelopeCashUsd: 10_000,
  walletSats: ONE_BTC_SATS,
}

function makeInput(overrides: Partial<RunwayNeedInput> = {}): RunwayNeedInput {
  return {
    livingBaselineUsd: 5_000,
    plannedLines: [],
    scenarios: [],
    runwayIncomeUsd: 0,
    horizonMonths: 12,
    inflationRateYear: 0.05,
    stressPercent: 0.5,
    growthRateYear: null,
    riskAnswers: null,
    holdings: baseHoldings,
    btcPriceUsd: BTC_PRICE,
    scenarioMode: "none",
    ...overrides,
  }
}

describe("computeRunwayNeed — living + draw", () => {
  it("combines baseline, add lines, replace lines, and scenarios", () => {
    const plannedLines: PlannedLine[] = [
      { id: "a", group: "agents", label: "Agents", monthlyUsd: 500, mode: "add" },
      {
        id: "b",
        group: "bitbudget",
        label: "BitBudget",
        monthlyUsd: 200,
        mode: "replaces",
        replacesMonthlyUsd: 300,
      },
    ]
    const scenarios: RunwayScenario[] = [
      { id: "s1", label: "Trim bill", monthlyDeltaUsd: -100, oneTimeUsd: 0, enabled: true },
    ]
    const result = computeRunwayNeed(
      makeInput({ plannedLines, scenarios, scenarioMode: "enabled" }),
    )
    // max(0, 5000 - 300) + (500 + 200) + (-100) = 4700 + 700 - 100
    expect(result.livingEffectiveUsd).toBe(5_300)
    expect(result.monthlyDrawUsd).toBe(5_300)
    expect(result.scenarioMonthlyDeltaUsd).toBe(-100)
    expect(result.activeScenarioIds).toEqual(["s1"])
  })

  it("floors the replaced aggregate so living never goes negative", () => {
    const plannedLines: PlannedLine[] = [
      {
        id: "b",
        group: "bitbudget",
        label: "BitBudget",
        monthlyUsd: 0,
        mode: "replaces",
        replacesMonthlyUsd: 9_999,
      },
    ]
    const result = computeRunwayNeed(makeInput({ livingBaselineUsd: 1_000, plannedLines }))
    expect(result.livingEffectiveUsd).toBe(0)
    expect(result.monthlyDrawUsd).toBe(0)
  })

  it("income covering the plan yields zero draw and zero floor", () => {
    const result = computeRunwayNeed(
      makeInput({ livingBaselineUsd: 3_000, runwayIncomeUsd: 5_000 }),
    )
    expect(result.monthlyDrawUsd).toBe(0)
    expect(result.recommendedCashFloorUsd).toBe(0)
    expect(result.cashFloorUsedUsd).toBe(0)
    expect(result.monthsLeft).toBeNull()
    expect(result.monthsLeftAtStress).toBeNull()
    expect(result.monthsLeftAtGrowth).toBeNull()
  })
})

describe("computeRunwayNeed — holdings", () => {
  it("overrides replace one side only", () => {
    const cashOverride = computeRunwayNeed(
      makeInput({ holdings: { ...baseHoldings, cashOverrideUsd: 25_000 } }),
    )
    expect(cashOverride.cashUsd).toBe(25_000)
    expect(cashOverride.spendableSats).toBe(ONE_BTC_SATS)

    const btcOverride = computeRunwayNeed(
      makeInput({ holdings: { ...baseHoldings, bitcoinOverrideSats: 2 * ONE_BTC_SATS } }),
    )
    expect(btcOverride.cashUsd).toBe(10_000)
    expect(btcOverride.spendableSats).toBe(2 * ONE_BTC_SATS)
  })

  it("counts lender-held bitcoin in the stack and exposure but not in spendable", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 10_000,
        editedCashFloorUsd: 0,
        holdings: {
          envelopeCashUsd: 0,
          walletSats: ONE_BTC_SATS,
          lenderHeldSats: ONE_BTC_SATS,
          amountDueUsd: 20_000,
        },
      }),
    )
    // stack = 0 cash + (2 BTC × 100k) − 20k due
    expect(result.stackUsd).toBe(180_000)
    // both BTC positions count toward exposure share
    expect(result.actualBtcShare).toBe(1)
    // months left spends only the 1 spendable BTC ($100k) against a $10k draw
    expect(result.monthsLeft).toBe(10)
  })

  it("includes bitcoin and cash on the way in the stack", () => {
    const result = computeRunwayNeed(
      makeInput({
        holdings: {
          envelopeCashUsd: 1_000,
          walletSats: 0,
          bitcoinOnTheWaySats: ONE_BTC_SATS,
          cashOnTheWayUsd: 2_000,
        },
      }),
    )
    // 1000 cash + 2000 on the way + 1 BTC ($100k)
    expect(result.stackUsd).toBe(103_000)
    expect(result.cashOnTheWayUsd).toBe(2_000)
    expect(result.bitcoinOnTheWaySats).toBe(ONE_BTC_SATS)
  })
})

describe("computeRunwayNeed — required bitcoin", () => {
  it("requires more sats at the stress price than at spot", () => {
    const result = computeRunwayNeed(makeInput({ livingBaselineUsd: 5_000 }))
    // draw 5000 × 12 = 60k ; spot 60M sats, stress (50% drop) 120M sats
    expect(result.requiredBitcoinSatsSpot).toBe(60_000_000)
    expect(result.requiredBitcoinSatsStress).toBe(120_000_000)
    expect(result.requiredBitcoinSatsStress).toBeGreaterThan(result.requiredBitcoinSatsSpot)
  })

  it("growth lowers required sats but leaves the cash floor unchanged", () => {
    const flat = computeRunwayNeed(
      makeInput({ livingBaselineUsd: 5_000, editedCashFloorUsd: 30_000, growthRateYear: null }),
    )
    const growth = computeRunwayNeed(
      makeInput({ livingBaselineUsd: 5_000, editedCashFloorUsd: 30_000, growthRateYear: 0.5 }),
    )
    // growthPrice = 100k × 1.5 → 40M sats < 60M flat
    expect(growth.requiredBitcoinSatsGrowth).toBe(40_000_000)
    expect(growth.requiredBitcoinSatsGrowth).toBeLessThan(growth.requiredBitcoinSatsSpot)
    // floor requirement does not move with growth
    expect(growth.requiredCashAtHorizonUsd).toBe(flat.requiredCashAtHorizonUsd)
    // months-left stretches when spendable bitcoin is marked at the growth price
    expect(growth.monthsLeftAtGrowth).not.toBeNull()
    expect(growth.monthsLeftAtGrowth!).toBeGreaterThan(growth.monthsLeft!)
  })

  it("returns Infinity required sats when the stress price is zero (100% drop)", () => {
    const result = computeRunwayNeed(
      makeInput({ livingBaselineUsd: 5_000, stressPercent: 1 }),
    )
    // stress price = 100k × (1 − 1) = 0 → bitcoin cannot fund the draw
    expect(result.stressPriceUsd).toBe(0)
    expect(result.requiredBitcoinSatsStress).toBe(Infinity)
    // spot is still finite and fundable
    expect(Number.isFinite(result.requiredBitcoinSatsSpot)).toBe(true)
  })

  it("counts an exact dollar need in sats without a float extra sat", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 134,
        horizonMonths: 1,
        btcPriceUsd: 100,
        editedCashFloorUsd: 0,
      }),
    )
    // (134 / 100) * 1e8 is 134000000.00000001 in IEEE; ceil of that is off by one.
    expect(result.requiredSpendableUsd).toBe(134)
    expect(result.requiredBitcoinSatsSpot).toBe(134_000_000)
  })

  it("ceils a fractional sat and keeps an exact sat count", () => {
    const exact = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 0.14,
        horizonMonths: 1,
        btcPriceUsd: 100_000,
        editedCashFloorUsd: 0,
      }),
    )
    expect(exact.requiredBitcoinSatsSpot).toBe(140)

    const fraction = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 0.01,
        horizonMonths: 1,
        btcPriceUsd: 99_999.99,
        editedCashFloorUsd: 0,
      }),
    )
    // 0.01 / 99999.99 * 1e8 ≈ 10.000001 → 11 sats
    expect(fraction.requiredBitcoinSatsSpot).toBe(11)
  })

  it("requires zero sats at a zero price when nothing must be funded", () => {
    // income fully covers the draw → requiredSpendableUsd is 0
    const result = computeRunwayNeed(
      makeInput({ livingBaselineUsd: 3_000, runwayIncomeUsd: 5_000, stressPercent: 1 }),
    )
    expect(result.requiredSpendableUsd).toBe(0)
    expect(result.requiredBitcoinSatsStress).toBe(0)
    expect(result.requiredBitcoinSatsSpot).toBe(0)
  })

  it("one-time proceeds reduce required spendable dollars", () => {
    const scenarios: RunwayScenario[] = [
      { id: "sale", label: "Side sale", monthlyDeltaUsd: 0, oneTimeUsd: 10_000, enabled: true },
    ]
    const withProceeds = computeRunwayNeed(
      makeInput({ livingBaselineUsd: 5_000, scenarios, scenarioMode: "enabled" }),
    )
    const without = computeRunwayNeed(makeInput({ livingBaselineUsd: 5_000 }))
    expect(without.requiredSpendableUsd).toBe(60_000)
    expect(withProceeds.requiredSpendableUsd).toBe(50_000)
    expect(withProceeds.requiredSpendableUsd).toBeLessThan(without.requiredSpendableUsd)
  })
})

describe("computeRunwayNeed — prices, share, and edits", () => {
  it("uses a 9 month floor for an 80/20 stack against a half target", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 5_000,
        holdings: { envelopeCashUsd: 20_000, walletSats: 80_000_000 },
      }),
    )
    expect(result.actualBtcShare).toBeCloseTo(0.8, 10)
    expect(result.cashFloorMonths).toBe(9)
    expect(result.recommendedCashFloorUsd).toBe(45_000)
  })

  it("treats underwater cash plus bitcoin as a full bitcoin share", () => {
    const stillGross = computeRunwayNeed(
      makeInput({
        holdings: { envelopeCashUsd: -1_000, walletSats: 50_000_000 },
      }),
    )
    // gross = -1_000 + 50_000 > 0, so the share is above 1
    expect(stillGross.actualBtcShare).toBeGreaterThan(1)

    const wiped = computeRunwayNeed(
      makeInput({
        holdings: { envelopeCashUsd: -80_000, walletSats: 50_000_000 },
      }),
    )
    expect(wiped.actualBtcShare).toBe(1)
    // share 1 vs target 0.5 → +5 months on the default base of 6
    expect(wiped.cashFloorMonths).toBe(11)
  })

  it("does not count bitcoin when the spot price is not positive", () => {
    const zero = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 5_000,
        btcPriceUsd: 0,
        holdings: { envelopeCashUsd: 12_000, walletSats: ONE_BTC_SATS },
        editedCashFloorUsd: 0,
      }),
    )
    expect(zero.requiredBitcoinSatsSpot).toBe(Infinity)
    expect(zero.stackUsd).toBe(12_000)
    expect(zero.monthsLeft).toBeCloseTo(12_000 / 5_000, 8)

    const negative = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 5_000,
        btcPriceUsd: -1,
        holdings: { envelopeCashUsd: 0, walletSats: ONE_BTC_SATS },
        editedCashFloorUsd: 0,
      }),
    )
    expect(negative.requiredBitcoinSatsSpot).toBe(Infinity)
    expect(negative.monthsLeft).toBe(0)
    expect(negative.stackUsd).toBe(0)
  })

  it("a stress drop past 100% does not make the stack or runway negative", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 5_000,
        stressPercent: 1.5,
        holdings: { envelopeCashUsd: 1_000, walletSats: ONE_BTC_SATS },
        editedCashFloorUsd: 0,
      }),
    )
    expect(result.stressPriceUsd).toBeLessThan(0)
    expect(result.requiredBitcoinSatsStress).toBe(Infinity)
    expect(result.stackAtStressUsd).toBe(1_000)
    expect(result.monthsLeftAtStress).toBeCloseTo(1_000 / 5_000, 8)
  })

  it("a NaN spot price does not poison the result", () => {
    const result = computeRunwayNeed(
      makeInput({
        btcPriceUsd: Number.NaN,
        editedCashFloorUsd: 0,
        holdings: { envelopeCashUsd: 10_000, walletSats: ONE_BTC_SATS },
      }),
    )
    expect(result.requiredBitcoinSatsSpot).toBe(Infinity)
    expect(result.monthsLeft).toBeCloseTo(10_000 / 5_000, 8)
    expect(Number.isNaN(result.stackUsd)).toBe(false)
    expect(Number.isNaN(result.requiredBitcoinSatsGrowth)).toBe(false)
  })

  it("a growth rate below -100% cannot fund the draw", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 5_000,
        horizonMonths: 18,
        growthRateYear: -1.5,
        editedCashFloorUsd: 0,
        holdings: { envelopeCashUsd: 0, walletSats: ONE_BTC_SATS },
      }),
    )
    expect(result.requiredBitcoinSatsGrowth).toBe(Infinity)
    expect(result.monthsLeftAtGrowth).toBe(0)
    expect(Number.isFinite(result.requiredBitcoinSatsSpot)).toBe(true)
  })

  it("a -100% growth rate zeroes the growth price", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 5_000,
        horizonMonths: 12,
        growthRateYear: -1,
        editedCashFloorUsd: 0,
        holdings: { envelopeCashUsd: 0, walletSats: ONE_BTC_SATS },
      }),
    )
    expect(result.requiredBitcoinSatsGrowth).toBe(Infinity)
    expect(result.monthsLeftAtGrowth).toBe(0)
  })

  it("inflates the cash floor and leaves the horizon draw in today's dollars", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 1_000,
        horizonMonths: 12,
        inflationRateYear: 0.05,
        editedCashFloorUsd: 10_000,
      }),
    )
    expect(result.drawOverHorizonUsd).toBe(12_000)
    expect(result.requiredCashAtHorizonUsd).toBeCloseTo(10_500, 6)
  })

  it("keeps the cash floor when inflation cannot be compounded", () => {
    const broken = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 1_000,
        horizonMonths: 18,
        inflationRateYear: -1.5,
        editedCashFloorUsd: 6_000,
      }),
    )
    expect(broken.requiredCashAtHorizonUsd).toBe(6_000)
    expect(Number.isNaN(broken.requiredStackSpotUsd)).toBe(false)

    const totalLoss = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 1_000,
        horizonMonths: 12,
        inflationRateYear: -1,
        editedCashFloorUsd: 6_000,
      }),
    )
    expect(totalLoss.requiredCashAtHorizonUsd).toBe(0)
  })

  it("clamps a negative edited floor and borrow cap to zero", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 2_000,
        editedCashFloorUsd: -500,
        editedBorrowCapFraction: -0.2,
        holdings: { envelopeCashUsd: 10_000, walletSats: ONE_BTC_SATS },
      }),
    )
    expect(result.cashFloorUsedUsd).toBe(0)
    expect(result.borrowCapFraction).toBe(0)
    expect(result.borrowCapacityUsd).toBe(0)
  })

  it("falls back when an edited floor is not a finite number", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 2_000,
        editedCashFloorUsd: Number.NaN,
      }),
    )
    expect(result.cashFloorUsedUsd).toBeGreaterThan(0)
    expect(Number.isFinite(result.cashFloorUsedUsd)).toBe(true)
  })

  it("ignores a non-finite planned amount", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 1_000,
        plannedLines: [
          { id: "x", group: "other", label: "X", monthlyUsd: Number.NaN, mode: "add" },
        ],
      }),
    )
    expect(result.livingEffectiveUsd).toBe(1_000)
    expect(result.monthlyDrawUsd).toBe(1_000)
  })

  it("treats negative sat counts and a negative amount due as zero", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 1_000,
        editedCashFloorUsd: 0,
        holdings: {
          envelopeCashUsd: 5_000,
          walletSats: -ONE_BTC_SATS,
          amountDueUsd: -500,
        },
      }),
    )
    expect(result.spendableSats).toBe(0)
    expect(result.amountDueUsd).toBe(0)
    expect(result.stackUsd).toBe(5_000)
    expect(result.monthsLeft).toBe(5)
  })
})

describe("computeRunwayNeed — months left & borrowing", () => {
  it("spends cash above the floor first, then spendable bitcoin", () => {
    const result = computeRunwayNeed(
      makeInput({
        livingBaselineUsd: 10_000,
        editedCashFloorUsd: 10_000,
        holdings: { envelopeCashUsd: 30_000, walletSats: ONE_BTC_SATS },
      }),
    )
    // cash above floor = 30k − 10k = 20k ; spendable BTC = $100k ; draw $10k
    expect(result.monthsLeft).toBe(12)
  })

  it("borrow cap of zero yields zero borrowing capacity", () => {
    const result = computeRunwayNeed(
      makeInput({
        riskAnswers: { dipResponse: "cut", btcSharePreference: "half", borrowStance: "never" },
      }),
    )
    expect(result.borrowCapFraction).toBe(0)
    expect(result.borrowCapacityUsd).toBe(0)
  })

  it("applies an edited borrow cap against unencumbered bitcoin value", () => {
    const result = computeRunwayNeed(
      makeInput({
        editedBorrowCapFraction: 0.4,
        holdings: { envelopeCashUsd: 0, walletSats: ONE_BTC_SATS, lenderHeldSats: ONE_BTC_SATS },
      }),
    )
    // only the 1 spendable BTC ($100k) is unencumbered → 0.4 × 100k
    expect(result.borrowCapacityUsd).toBe(40_000)
  })
})

describe("computeRunwayNeedVariants", () => {
  it("returns the plan with no scenarios, all enabled, and each enabled alone", () => {
    const scenarios: RunwayScenario[] = [
      { id: "s1", label: "One", monthlyDeltaUsd: -500, oneTimeUsd: 0, enabled: true },
      { id: "s2", label: "Two", monthlyDeltaUsd: -200, oneTimeUsd: 0, enabled: true },
      { id: "s3", label: "Off", monthlyDeltaUsd: -1_000, oneTimeUsd: 0, enabled: false },
    ]
    const variants = computeRunwayNeedVariants(makeInput({ livingBaselineUsd: 5_000, scenarios }))
    expect(variants.none.livingEffectiveUsd).toBe(5_000)
    expect(variants.allEnabled.livingEffectiveUsd).toBe(4_300) // −500 −200
    expect(variants.eachEnabled.map((v) => v.id)).toEqual(["s1", "s2"])
    expect(variants.eachEnabled[0]!.result.livingEffectiveUsd).toBe(4_500)
  })
})

describe("activeScenarios", () => {
  const scenarios: RunwayScenario[] = [
    { id: "s1", label: "One", monthlyDeltaUsd: 0, oneTimeUsd: 0, enabled: true },
    { id: "s2", label: "Two", monthlyDeltaUsd: 0, oneTimeUsd: 0, enabled: false },
  ]

  it("none → empty, enabled → only enabled, ids → matching", () => {
    expect(activeScenarios(scenarios, "none")).toEqual([])
    expect(activeScenarios(scenarios, "enabled").map((s) => s.id)).toEqual(["s1"])
    expect(activeScenarios(scenarios, ["s2"]).map((s) => s.id)).toEqual(["s2"])
  })

  it("does not walk a stray string as character ids", () => {
    expect(activeScenarios(scenarios, "s1" as unknown as ScenarioMode)).toEqual([])
  })
})

describe("historicalCagrs", () => {
  it("annualizes a doubling over four years to ~18.92%", () => {
    const prices = [
      { date: "2020-01-01", priceUsd: 100 },
      { date: "2024-01-01", priceUsd: 200 },
    ]
    const cagr = historicalCagrs(prices)
    expect(cagr.full).toBeCloseTo(0.1892, 3)
    expect(cagr.years4).toBeCloseTo(0.1892, 3)
    // data only spans four years → eight-year window is unavailable
    expect(cagr.years8).toBeNull()
  })

  it("returns all null without at least two points", () => {
    expect(historicalCagrs([])).toEqual({ years4: null, years8: null, full: null })
    expect(historicalCagrs([{ date: "2024-01-01", priceUsd: 100 }])).toEqual({
      years4: null,
      years8: null,
      full: null,
    })
  })

  it("sorts unsorted input before computing the full window", () => {
    const prices = [
      { date: "2024-01-01", priceUsd: 200 },
      { date: "2020-01-01", priceUsd: 100 },
    ]
    expect(historicalCagrs(prices).full).toBeCloseTo(0.1892, 3)
  })

  it("returns null for a negative end, a zero start, and a zero-length span", () => {
    expect(
      historicalCagrs([
        { date: "2020-01-01", priceUsd: 100 },
        { date: "2024-01-01", priceUsd: -5 },
      ]),
    ).toEqual({ years4: null, years8: null, full: null })

    expect(
      historicalCagrs([
        { date: "2020-01-01", priceUsd: 0 },
        { date: "2024-01-01", priceUsd: 100 },
      ]).full,
    ).toBeNull()

    expect(
      historicalCagrs([
        { date: "2024-01-01", priceUsd: 100 },
        { date: "2024-01-01", priceUsd: 200 },
      ]).full,
    ).toBeNull()
  })

  it("drops invalid dates and non-finite prices", () => {
    const cagr = historicalCagrs([
      { date: "not-a-date", priceUsd: 1 },
      { date: "2020-01-01", priceUsd: Number.NaN },
      { date: "2020-01-01", priceUsd: 100 },
      { date: "2024-01-01", priceUsd: 200 },
    ])
    expect(cagr.full).toBeCloseTo(0.1892, 3)
  })

  it("returns -100% when the price falls to zero", () => {
    expect(
      historicalCagrs([
        { date: "2020-01-01", priceUsd: 100 },
        { date: "2024-01-01", priceUsd: 0 },
      ]).full,
    ).toBe(-1)
  })
})
