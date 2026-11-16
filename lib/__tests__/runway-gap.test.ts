import { describe, expect, it } from "vitest"
import {
  computeRunwayGap,
  type RunwayGapInput,
  type RunwayGapScenarioInput,
} from "../runway-gap"

const BTC_PRICE = 100_000
// At $100k/BTC, $1 == 1000 sats, so $1000 == 1_000_000 sats.

function makeInput(overrides: Partial<RunwayGapInput> = {}): RunwayGapInput {
  return {
    monthsUntilQuit: 4,
    monthlySavingsUsd: 500,
    flexibleCutMonthlyUsd: 0,
    btcPriceUsd: BTC_PRICE,
    cashUsd: 0,
    spendableSats: 0,
    cashRequiredUsd: 1_000,
    requiredBitcoinSats: 5_000_000,
    scenarios: [],
    ...overrides,
  }
}

describe("computeRunwayGap — floor-first allocation", () => {
  it("fills the cash floor first, then buys bitcoin with the remainder", () => {
    const r = computeRunwayGap(makeInput())
    // 500 * 4 = 2000 new; 1000 fills the floor, 1000 buys bitcoin.
    expect(r.flat.newSavingsUsd).toBe(2_000)
    expect(r.flat.toCashUsd).toBe(1_000)
    expect(r.flat.toBitcoinUsd).toBe(1_000)
    expect(r.flat.projectedCashUsd).toBe(1_000)
    expect(r.flat.projectedSats).toBe(1_000_000)
    // Cash floor is exactly met.
    expect(r.flat.cashGapUsd).toBe(0)
    expect(r.flat.cashSurplusUsd).toBe(0)
    // Bitcoin still short of 5,000,000 sats.
    expect(r.flat.bitcoinGapSats).toBe(4_000_000)
    expect(r.flat.bitcoinGapUsd).toBe(4_000)
    expect(r.flat.bitcoinSurplusSats).toBe(-4_000_000)
  })

  it("directs all new savings to cash when the floor is not yet met", () => {
    const r = computeRunwayGap(makeInput({ cashRequiredUsd: 5_000, requiredBitcoinSats: 0 }))
    expect(r.flat.toCashUsd).toBe(2_000)
    expect(r.flat.toBitcoinUsd).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(2_000)
    expect(r.flat.projectedSats).toBe(0)
    expect(r.flat.cashGapUsd).toBe(3_000)
    expect(r.flat.cashSurplusUsd).toBe(-3_000)
  })
})

describe("computeRunwayGap — flexible cuts improve the projection", () => {
  it("adds flexibleCutMonthlyUsd on top of monthly savings", () => {
    const r = computeRunwayGap(makeInput({ flexibleCutMonthlyUsd: 500 }))
    // flat: 2000 new; withCuts: (500+500)*4 = 4000 new.
    expect(r.flat.newSavingsUsd).toBe(2_000)
    expect(r.withCuts.newSavingsUsd).toBe(4_000)
    // Floor met in both; cuts put more into bitcoin.
    expect(r.withCuts.toBitcoinUsd).toBe(3_000)
    expect(r.withCuts.projectedSats).toBe(3_000_000)
    expect(r.withCuts.projectedSats).toBeGreaterThan(r.flat.projectedSats)
    expect(r.withCuts.bitcoinGapSats).toBeLessThan(r.flat.bitcoinGapSats)
    expect(r.withCuts.bitcoinGapSats).toBe(2_000_000)
  })
})

describe("computeRunwayGap — scenarios (monthly + one-time)", () => {
  const scenarioBase = makeInput({
    monthlySavingsUsd: 0,
    cashRequiredUsd: 1_000,
    requiredBitcoinSats: 2_000_000,
    spendableSats: 0,
    cashUsd: 0,
  })

  it("closes the cash gap first, then the bitcoin gap, from monthly + one-time", () => {
    const s: RunwayGapScenarioInput = {
      id: "trim",
      label: "Trim bill",
      monthlyDeltaUsd: -250, // frees 250/mo
      oneTimeUsd: 500, // proceeds
    }
    const r = computeRunwayGap({ ...scenarioBase, scenarios: [s] })
    // Flat baseline: cash gap 1000, bitcoin gap 2,000,000 sats ($2000).
    expect(r.flat.cashGapUsd).toBe(1_000)
    expect(r.flat.bitcoinGapUsd).toBe(2_000)

    const sc = r.scenarios[0]!
    expect(sc.fromMonthlyUsd).toBe(1_000) // -(-250) * 4
    expect(sc.fromOneTimeUsd).toBe(500)
    expect(sc.extraUsd).toBe(1_500)
    // 1000 closes the cash gap; 500 left closes part of the bitcoin gap.
    expect(sc.cashGapClosedUsd).toBe(1_000)
    expect(sc.bitcoinGapClosedUsd).toBe(500)
    expect(sc.bitcoinGapClosedSats).toBe(500_000)
  })

  it("never closes more than the gap", () => {
    const s: RunwayGapScenarioInput = {
      id: "big",
      label: "Huge sale",
      monthlyDeltaUsd: 0,
      oneTimeUsd: 100_000,
    }
    const r = computeRunwayGap({ ...scenarioBase, scenarios: [s] })
    const sc = r.scenarios[0]!
    expect(sc.cashGapClosedUsd).toBe(1_000) // capped at the gap
    expect(sc.bitcoinGapClosedUsd).toBe(2_000) // capped at the gap
    expect(sc.bitcoinGapClosedSats).toBe(2_000_000)
  })

  it("treats a one-time cost as negative closure that widens the bitcoin gap", () => {
    const s: RunwayGapScenarioInput = {
      id: "cost",
      label: "New laptop",
      monthlyDeltaUsd: 0,
      oneTimeUsd: -500,
    }
    const r = computeRunwayGap({ ...scenarioBase, monthsUntilQuit: 0, scenarios: [s] })
    const sc = r.scenarios[0]!
    expect(sc.extraUsd).toBe(-500)
    expect(sc.cashGapClosedUsd).toBe(0)
    expect(sc.bitcoinGapClosedUsd).toBe(-500)
    expect(sc.bitcoinGapClosedSats).toBe(-500_000)
  })

  it("aggregates all scenarios together in allEnabled", () => {
    const scenarios: RunwayGapScenarioInput[] = [
      { id: "a", label: "A", monthlyDeltaUsd: -100, oneTimeUsd: 0 },
      { id: "b", label: "B", monthlyDeltaUsd: 0, oneTimeUsd: 600 },
    ]
    const r = computeRunwayGap({ ...scenarioBase, scenarios })
    // Aggregate: fromMonthly = 100*4 = 400; fromOneTime = 600; extra = 1000.
    expect(r.allEnabled.fromMonthlyUsd).toBe(400)
    expect(r.allEnabled.fromOneTimeUsd).toBe(600)
    expect(r.allEnabled.extraUsd).toBe(1_000)
    expect(r.allEnabled.cashGapClosedUsd).toBe(1_000)
    expect(r.allEnabled.bitcoinGapClosedUsd).toBe(0)
    // Individual scenarios still each present.
    expect(r.scenarios).toHaveLength(2)
  })
})

describe("computeRunwayGap — cash and bitcoin gaps stay separate", () => {
  it("surfaces a short cash floor even when bitcoin is well over target", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 0,
        cashUsd: 0,
        cashRequiredUsd: 2_000,
        spendableSats: 10_000_000, // 0.1 BTC = $10k
        requiredBitcoinSats: 1_000_000,
      }),
    )
    // Bitcoin is far ahead...
    expect(r.flat.bitcoinGapSats).toBe(0)
    expect(r.flat.bitcoinSurplusSats).toBe(9_000_000)
    // ...but the cash floor is still short, and that is not hidden.
    expect(r.flat.cashGapUsd).toBe(2_000)
    expect(r.flat.cashSurplusUsd).toBe(-2_000)
  })
})

describe("computeRunwayGap — months to close the dollar gap", () => {
  it("divides the combined dollar shortfall by the current savings rate", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 1_000,
        cashUsd: 0,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 1_000_000, // $1000 at spot
      }),
    )
    // combined = cash 1000 + bitcoin 1000 = 2000; / 1000 = 2 months.
    expect(r.combinedDollarGapUsd).toBe(2_000)
    expect(r.monthsToCloseDollarGap).toBe(2)
  })

  it("returns 0 months when there is no combined gap", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 1_000,
        cashUsd: 5_000,
        cashRequiredUsd: 1_000,
        spendableSats: 10_000_000,
        requiredBitcoinSats: 1_000_000,
      }),
    )
    expect(r.combinedDollarGapUsd).toBe(0)
    expect(r.monthsToCloseDollarGap).toBe(0)
  })

  it("returns null when savings are zero and a finite gap remains", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 0,
        cashUsd: 0,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 0,
      }),
    )
    expect(r.combinedDollarGapUsd).toBe(1_000)
    expect(r.monthsToCloseDollarGap).toBeNull()
  })
})

describe("computeRunwayGap — quit today (monthsUntilQuit = 0)", () => {
  it("projects exactly the current holdings, plus scenario one-time effects", () => {
    const s: RunwayGapScenarioInput = {
      id: "sale",
      label: "Sale",
      monthlyDeltaUsd: -1_000, // ignored at 0 months
      oneTimeUsd: 500,
    }
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 999,
        flexibleCutMonthlyUsd: 999,
        cashUsd: 3_000,
        spendableSats: 2_000_000,
        cashRequiredUsd: 1_000,
        requiredBitcoinSats: 5_000_000,
        scenarios: [s],
      }),
    )
    expect(r.flat.newSavingsUsd).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(3_000)
    expect(r.flat.projectedSats).toBe(2_000_000)
    expect(r.withCuts.newSavingsUsd).toBe(0)
    expect(r.withCuts.projectedSats).toBe(2_000_000)
    // Monthly delta contributes nothing at 0 months; only the one-time counts.
    expect(r.scenarios[0]!.fromMonthlyUsd).toBe(0)
    expect(r.scenarios[0]!.extraUsd).toBe(500)
  })

  it("clamps a negative monthsUntilQuit to 0", () => {
    const r = computeRunwayGap(makeInput({ monthsUntilQuit: -3 }))
    expect(r.monthsUntilQuit).toBe(0)
    expect(r.flat.newSavingsUsd).toBe(0)
  })
})

describe("computeRunwayGap — net burn drains bitcoin first", () => {
  it("protects the cash floor when monthly savings are negative", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: -1_000, // burning
        cashUsd: 5_000,
        cashRequiredUsd: 2_000,
        spendableSats: 10_000_000, // 0.1 BTC = $10k
        requiredBitcoinSats: 0,
      }),
    )
    expect(r.flat.newSavingsUsd).toBe(-1_000)
    // Burn comes out of bitcoin ($1000 -> 1,000,000 sats), cash untouched.
    expect(r.flat.projectedSats).toBe(9_000_000)
    expect(r.flat.projectedCashUsd).toBe(5_000)
    expect(r.flat.toBitcoinUsd).toBe(-1_000)
    expect(r.flat.toCashUsd).toBe(0)
    expect(r.flat.cashGapUsd).toBe(0)
  })
})

describe("computeRunwayGap — non-positive BTC price keeps dollars as cash", () => {
  it("does not lose bitcoin-destined savings when btcPriceUsd <= 0", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 4,
        monthlySavingsUsd: 500, // 2000 new
        btcPriceUsd: 0,
        cashUsd: 0,
        cashRequiredUsd: 0, // floor already met, so all 2000 would target bitcoin
        spendableSats: 0,
        requiredBitcoinSats: 5_000_000,
      }),
    )
    // At a zero price the 2000 can't buy sats — it must stay in projected cash.
    expect(r.flat.projectedSats).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(2_000)
    expect(r.flat.toCashUsd).toBe(2_000)
    expect(r.flat.toBitcoinUsd).toBe(0)
    // Dollars are preserved: no money vanishes from the projection.
    expect(r.flat.projectedCashUsd + r.flat.toBitcoinUsd).toBe(2_000)
  })
})

describe("computeRunwayGap — scenario cost consumes bitcoin surplus first", () => {
  const surplusBase = makeInput({
    monthsUntilQuit: 0,
    monthlySavingsUsd: 0,
    cashUsd: 2_000,
    cashRequiredUsd: 1_000, // floor met
    spendableSats: 10_000_000, // $10k at $100k/BTC
    requiredBitcoinSats: 5_000_000, // $5k required => $5k surplus
  })

  it("does not widen the gap when surplus fully absorbs the cost", () => {
    const r = computeRunwayGap({
      ...surplusBase,
      scenarios: [{ id: "cost", label: "Cost", monthlyDeltaUsd: 0, oneTimeUsd: -3_000 }],
    })
    // Baseline: no gap, $5k bitcoin surplus.
    expect(r.flat.bitcoinGapUsd).toBe(0)
    expect(r.flat.bitcoinSurplusSats).toBe(5_000_000)
    const sc = r.scenarios[0]!
    expect(sc.extraUsd).toBe(-3_000)
    // $3k cost < $5k surplus: the gap is untouched.
    expect(sc.cashGapClosedUsd).toBe(0)
    expect(sc.bitcoinGapClosedUsd).toBe(0)
    expect(sc.bitcoinGapClosedSats).toBe(0)
  })

  it("widens the gap only by the cost beyond the surplus", () => {
    const r = computeRunwayGap({
      ...surplusBase,
      scenarios: [{ id: "cost", label: "Cost", monthlyDeltaUsd: 0, oneTimeUsd: -7_000 }],
    })
    const sc = r.scenarios[0]!
    expect(sc.extraUsd).toBe(-7_000)
    // $7k cost - $5k surplus = $2k widens the bitcoin gap.
    expect(sc.cashGapClosedUsd).toBe(0)
    expect(sc.bitcoinGapClosedUsd).toBe(-2_000)
    expect(sc.bitcoinGapClosedSats).toBe(-2_000_000)
  })
})

describe("computeRunwayGap — Infinity required bitcoin", () => {
  it("keeps the bitcoin gap Infinity without NaN and never hides the cash side", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 4,
        monthlySavingsUsd: 500,
        cashUsd: 0,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: Infinity,
      }),
    )
    expect(r.flat.bitcoinGapSats).toBe(Infinity)
    expect(r.flat.bitcoinGapUsd).toBe(Infinity)
    expect(r.flat.bitcoinSurplusSats).toBe(-Infinity)
    expect(Number.isNaN(r.flat.bitcoinGapUsd)).toBe(false)
    // Cash side still computed normally (floor met here).
    expect(r.flat.cashGapUsd).toBe(0)
    // Combined dollar gap and months-to-close both surface as Infinity.
    expect(r.combinedDollarGapUsd).toBe(Infinity)
    expect(r.monthsToCloseDollarGap).toBe(Infinity)
  })

  it("returns Infinity months-to-close even when savings are zero", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 0,
        requiredBitcoinSats: Infinity,
      }),
    )
    expect(r.monthsToCloseDollarGap).toBe(Infinity)
  })

  it("does not treat NaN or a negative requirement as an infinite gap", () => {
    const nanReq = computeRunwayGap(makeInput({ monthsUntilQuit: 0, requiredBitcoinSats: NaN }))
    expect(nanReq.requiredBitcoinSats).toBe(0)
    expect(nanReq.flat.bitcoinGapSats).toBe(0)
    expect(nanReq.combinedDollarGapUsd).toBe(1_000)
    expect(Number.isNaN(nanReq.flat.bitcoinGapUsd)).toBe(false)

    // A negative target must not invent surplus that swallows a cost.
    const negativeReq = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: 0,
        cashUsd: 0,
        cashRequiredUsd: 0,
        spendableSats: 0,
        requiredBitcoinSats: -1_000_000,
        scenarios: [{ id: "cost", label: "Cost", monthlyDeltaUsd: 0, oneTimeUsd: -100 }],
      }),
    )
    expect(negativeReq.flat.bitcoinSurplusSats).toBe(0)
    expect(negativeReq.scenarios[0]!.bitcoinGapClosedUsd).toBe(-100)
    expect(negativeReq.scenarios[0]!.bitcoinGapClosedSats).toBe(-100_000)
  })
})

describe("computeRunwayGap — sat conversion matches the dollars", () => {
  it("buys 490 sats for $0.49 at $100k once the floor is already met", () => {
    // (0.49 / 100_000) * 1e8 is 489.99999999999994; a float floor drops a sat
    // and leaves a phantom gap after the cash floor is already met.
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: 0.49,
        cashUsd: 1_000,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 490,
      }),
    )
    expect(r.flat.toCashUsd).toBe(0)
    expect(r.flat.toBitcoinUsd).toBe(0.49)
    expect(r.flat.projectedCashUsd).toBe(1_000)
    expect(r.flat.projectedSats).toBe(490)
    expect(r.flat.bitcoinGapSats).toBe(0)
    expect(r.flat.cashGapUsd).toBe(0)
    expect(r.combinedDollarGapUsd).toBe(0)
    expect(r.monthsToCloseDollarGap).toBe(0)
  })

  it("floors only the remainder that spills past a filled floor", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: 1_000.49,
        cashUsd: 0,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 490,
      }),
    )
    expect(r.flat.toCashUsd).toBe(1_000)
    // 1000.49 - 1000 is not exact in binary; the sat count still rounds to 490.
    expect(r.flat.toBitcoinUsd).toBeCloseTo(0.49, 10)
    expect(r.flat.projectedSats).toBe(490)
    expect(r.flat.bitcoinGapSats).toBe(0)
  })
})

describe("computeRunwayGap — cash floor already met", () => {
  it("sends every new dollar to bitcoin and leaves surplus cash alone", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 4,
        monthlySavingsUsd: 500,
        cashUsd: 5_000,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 3_000_000,
      }),
    )
    expect(r.flat.toCashUsd).toBe(0)
    expect(r.flat.toBitcoinUsd).toBe(2_000)
    expect(r.flat.projectedCashUsd).toBe(5_000)
    expect(r.flat.projectedSats).toBe(2_000_000)
    expect(r.flat.cashGapUsd).toBe(0)
    expect(r.flat.cashSurplusUsd).toBe(4_000)
    expect(r.flat.bitcoinGapSats).toBe(1_000_000)
  })

  it("does not nick the floor when a burn sells a fraction of a sat", () => {
    // $1 at $60k is 1666.666 sats. Ceil sells 1667 ($1.0002) so cash stays put.
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: -1,
        btcPriceUsd: 60_000,
        cashUsd: 2_000,
        cashRequiredUsd: 2_000,
        spendableSats: 10_000_000,
        requiredBitcoinSats: 0,
      }),
    )
    expect(r.flat.projectedSats).toBe(10_000_000 - 1_667)
    expect(r.flat.projectedCashUsd).toBe(2_000)
    expect(r.flat.cashGapUsd).toBe(0)
    expect(r.flat.toCashUsd).toBe(0)
    expect(r.flat.toBitcoinUsd).toBeCloseTo(-1.0002, 10)
  })
})

describe("computeRunwayGap — zero savings", () => {
  it("does not fill a short floor or buy bitcoin, and never closes", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 12,
        monthlySavingsUsd: 0,
        cashUsd: 100,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 1_000_000,
      }),
    )
    expect(r.flat.newSavingsUsd).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(100)
    expect(r.flat.projectedSats).toBe(0)
    expect(r.flat.cashGapUsd).toBe(900)
    expect(r.flat.bitcoinGapSats).toBe(1_000_000)
    expect(r.monthsToCloseDollarGap).toBeNull()
  })

  it("leaves a met floor and a bitcoin shortfall untouched", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 6,
        monthlySavingsUsd: 0,
        cashUsd: 5_000,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 1_000_000,
      }),
    )
    expect(r.flat.projectedCashUsd).toBe(5_000)
    expect(r.flat.cashGapUsd).toBe(0)
    expect(r.flat.cashSurplusUsd).toBe(4_000)
    expect(r.flat.bitcoinGapUsd).toBe(1_000)
    expect(r.monthsToCloseDollarGap).toBeNull()
  })

  it("returns null rather than a negative month count when savings are a burn", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 0,
        monthlySavingsUsd: -400,
        cashUsd: 0,
        cashRequiredUsd: 1_000,
        spendableSats: 0,
        requiredBitcoinSats: 0,
      }),
    )
    expect(r.combinedDollarGapUsd).toBe(1_000)
    expect(r.monthsToCloseDollarGap).toBeNull()
  })
})

describe("computeRunwayGap — quit date in the past", () => {
  it("does not burn and ignores a monthly scenario delta", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: -4,
        monthlySavingsUsd: -500,
        flexibleCutMonthlyUsd: 800,
        cashUsd: 3_000,
        spendableSats: 2_000_000,
        cashRequiredUsd: 1_000,
        requiredBitcoinSats: 1_000_000,
        scenarios: [{ id: "trim", label: "Trim", monthlyDeltaUsd: -250, oneTimeUsd: 100 }],
      }),
    )
    expect(r.monthsUntilQuit).toBe(0)
    expect(r.flat.newSavingsUsd).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(3_000)
    expect(r.flat.projectedSats).toBe(2_000_000)
    expect(r.withCuts.newSavingsUsd).toBe(0)
    expect(r.withCuts.projectedSats).toBe(2_000_000)
    expect(r.flat.cashGapUsd).toBe(0)
    expect(r.scenarios[0]!.fromMonthlyUsd).toBe(0)
    expect(r.scenarios[0]!.extraUsd).toBe(100)
    expect(r.scenarios[0]!.cashGapClosedUsd).toBe(0)
    expect(r.scenarios[0]!.bitcoinGapClosedUsd).toBe(0)
  })

  it("treats a non-finite horizon as no time left, not as infinite savings", () => {
    const infinite = computeRunwayGap(
      makeInput({
        monthsUntilQuit: Infinity,
        monthlySavingsUsd: 1,
        cashUsd: 0,
        cashRequiredUsd: 0,
        spendableSats: 0,
        requiredBitcoinSats: 5_000_000,
      }),
    )
    expect(infinite.monthsUntilQuit).toBe(0)
    expect(infinite.flat.projectedSats).toBe(0)
    expect(infinite.flat.bitcoinGapSats).toBe(5_000_000)
    expect(infinite.monthsToCloseDollarGap).toBe(5_000)

    const missing = computeRunwayGap(makeInput({ monthsUntilQuit: Number.NaN, cashUsd: 40 }))
    expect(missing.monthsUntilQuit).toBe(0)
    expect(missing.flat.projectedCashUsd).toBe(40)
    expect(Number.isNaN(missing.flat.projectedSats)).toBe(false)
    expect(Number.isNaN(missing.combinedDollarGapUsd)).toBe(false)
  })
})

describe("computeRunwayGap — unpriced bitcoin and bad holdings", () => {
  it("keeps dollars as cash when the price is not a positive finite number", () => {
    const floorMet = {
      monthsUntilQuit: 1,
      monthlySavingsUsd: 100,
      cashUsd: 1_000,
      cashRequiredUsd: 1_000,
      spendableSats: 50_000,
      requiredBitcoinSats: 5_000_000,
    }
    for (const btcPriceUsd of [Infinity, Number.NaN, -1]) {
      const r = computeRunwayGap(makeInput({ ...floorMet, btcPriceUsd }))
      expect(r.flat.projectedCashUsd).toBe(1_100)
      expect(r.flat.projectedSats).toBe(50_000)
      expect(r.flat.toBitcoinUsd).toBe(0)
      expect(r.flat.bitcoinGapSats).toBe(4_950_000)
      expect(Number.isNaN(r.flat.bitcoinGapUsd)).toBe(false)
      expect(Number.isNaN(r.monthsToCloseDollarGap as number)).toBe(false)
    }
  })

  it("does not turn an unrepresentable purchase into a closed gap", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: 1e12,
        btcPriceUsd: 1e-7,
        cashUsd: 0,
        cashRequiredUsd: 0,
        spendableSats: 0,
        requiredBitcoinSats: 1,
      }),
    )
    expect(r.flat.projectedSats).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(1e12)
    expect(r.flat.bitcoinGapSats).toBe(1)
    expect(Number.isFinite(r.flat.projectedSats)).toBe(true)
  })

  it("burns cash, not a phantom bitcoin credit, when a NaN price meets a drain", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: -100,
        btcPriceUsd: Number.NaN,
        cashUsd: 5_000,
        cashRequiredUsd: 1_000,
        spendableSats: 1_000_000,
        requiredBitcoinSats: 0,
      }),
    )
    expect(r.flat.projectedSats).toBe(1_000_000)
    expect(r.flat.projectedCashUsd).toBe(4_900)
    expect(r.flat.toBitcoinUsd).toBe(0)
    expect(r.flat.toCashUsd).toBe(-100)
    expect(Number.isNaN(r.flat.bitcoinGapUsd)).toBe(false)
  })

  it("treats negative sats as none so a drain cannot over-debit cash", () => {
    const r = computeRunwayGap(
      makeInput({
        monthsUntilQuit: 1,
        monthlySavingsUsd: -10,
        cashUsd: 100,
        cashRequiredUsd: 0,
        spendableSats: -50_000,
        requiredBitcoinSats: 0,
      }),
    )
    expect(r.flat.projectedSats).toBe(0)
    expect(r.flat.projectedCashUsd).toBe(90)
    expect(r.flat.toBitcoinUsd).toBe(0)
    expect(r.flat.toCashUsd).toBe(-10)
  })
})
