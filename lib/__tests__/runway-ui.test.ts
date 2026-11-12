import { describe, expect, it } from "vitest"
import {
  RUNWAY_PLAN_DEFAULTS,
} from "../runway-plan"
import {
  borrowingAllowed,
  buildPlanPutBody,
  buildRunwayComputation,
  checkupMonthName,
  effectiveBorrowCapFraction,
  formatLiquidationRoomPct,
  formatSharePct,
  gapSummaryLine,
  holdingsLookEmpty,
  isCheckupReady,
  isRunwayConfigured,
  knownBitcoinSats,
  knownCashUsd,
  monthsUntilQuit,
  resolveLivingBaselineUsd,
  runwayHeroDetail,
  runwayMonthsHeadline,
  runwayPrimaryAction,
  satsToUsd,
  type RunwayPlanResponse,
} from "../runway-ui"

function makePlan(overrides: Partial<RunwayPlanResponse> = {}): RunwayPlanResponse {
  return {
    phase: "buildup",
    quitDate: null,
    horizonMonths: 24,
    runwayIncomeUsd: 0,
    livingBaselineOverrideUsd: null,
    inflationRateYear: RUNWAY_PLAN_DEFAULTS.inflationRateYear,
    stressPercent: RUNWAY_PLAN_DEFAULTS.stressPercent,
    growthRateYear: null,
    dipResponse: "cut",
    btcSharePreference: "half",
    borrowStance: "deep_drop",
    editedCashFloorUsd: null,
    editedBorrowCapFraction: null,
    cashOverrideUsd: null,
    bitcoinOverrideSats: null,
    plannedLines: [],
    scenarios: [],
    envelopePriorities: {},
    checkupOpenedMonthKey: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("isRunwayConfigured", () => {
  it("is false for null and a fresh default plan", () => {
    expect(isRunwayConfigured(null)).toBe(false)
    expect(isRunwayConfigured(makePlan())).toBe(false)
  })

  it("is true once the runway phase, quit date, living costs, income, or lines are set", () => {
    expect(isRunwayConfigured(makePlan({ phase: "runway" }))).toBe(true)
    expect(isRunwayConfigured(makePlan({ quitDate: "2027-01-01" }))).toBe(true)
    expect(isRunwayConfigured(makePlan({ livingBaselineOverrideUsd: 0 }))).toBe(true)
    expect(isRunwayConfigured(makePlan({ runwayIncomeUsd: 100 }))).toBe(true)
    expect(
      isRunwayConfigured(
        makePlan({
          plannedLines: [
            { id: "a", group: "bitbudget", label: "Ads", monthlyUsd: 10, mode: "add" },
          ],
        }),
      ),
    ).toBe(true)
  })
})

describe("monthsUntilQuit", () => {
  it("returns 0 for past or missing dates", () => {
    expect(monthsUntilQuit(null, "2026-06-01")).toBe(0)
    expect(monthsUntilQuit("2026-01-01", "2026-06-01")).toBe(0)
  })

  it("rounds to whole months into the future", () => {
    expect(monthsUntilQuit("2026-07-01", "2026-01-01")).toBe(6)
    expect(monthsUntilQuit("2027-01-01", "2026-01-01")).toBe(12)
  })
})

describe("resolveLivingBaselineUsd", () => {
  it("prefers an explicit override (including 0)", () => {
    expect(resolveLivingBaselineUsd(makePlan({ livingBaselineOverrideUsd: 0 }), 3000)).toBe(0)
    expect(resolveLivingBaselineUsd(makePlan({ livingBaselineOverrideUsd: 2500 }), 3000)).toBe(2500)
  })

  it("falls back to the insight, then to 0", () => {
    expect(resolveLivingBaselineUsd(makePlan(), 3000.126)).toBe(3000.13)
    expect(resolveLivingBaselineUsd(makePlan(), null)).toBe(0)
    expect(resolveLivingBaselineUsd(makePlan(), 0)).toBe(0)
  })
})

describe("knownCashUsd / knownBitcoinSats", () => {
  it("sums components but lets an override replace the total", () => {
    expect(knownCashUsd(1000, 500, null)).toBe(1500)
    expect(knownCashUsd(1000, 500, 250)).toBe(250)
    expect(knownCashUsd(-10, -5, null)).toBe(0)
  })

  it("rounds sats and respects an override", () => {
    expect(knownBitcoinSats(1234.6, null)).toBe(1235)
    expect(knownBitcoinSats(1234, 5000)).toBe(5000)
  })
})

describe("effectiveBorrowCapFraction / borrowingAllowed", () => {
  it("uses the risk recommendation unless edited", () => {
    expect(effectiveBorrowCapFraction(makePlan({ borrowStance: "never" }))).toBe(0)
    expect(effectiveBorrowCapFraction(makePlan({ borrowStance: "ok" }))).toBe(0.4)
    expect(effectiveBorrowCapFraction(makePlan({ borrowStance: "never", editedBorrowCapFraction: 0.3 }))).toBe(0.3)
  })

  it("gates the borrow block on a positive cap", () => {
    expect(borrowingAllowed(makePlan({ borrowStance: "never" }))).toBe(false)
    expect(borrowingAllowed(makePlan({ borrowStance: "deep_drop" }))).toBe(true)
  })
})

describe("checkupMonthName / isCheckupReady", () => {
  it("names the month", () => {
    expect(checkupMonthName("2026-03")).toBe("March")
    expect(checkupMonthName("2026-12")).toBe("December")
    expect(checkupMonthName("garbage")).toBe("garbage")
  })

  it("is ready only when configured and this month is unopened", () => {
    expect(isCheckupReady(null, "2026-03")).toBe(false)
    expect(isCheckupReady(makePlan(), "2026-03")).toBe(false) // not configured
    const configured = makePlan({ phase: "runway" })
    expect(isCheckupReady(configured, "2026-03")).toBe(true)
    expect(isCheckupReady(makePlan({ phase: "runway", checkupOpenedMonthKey: "2026-03" }), "2026-03")).toBe(false)
  })
})

describe("formatSharePct / satsToUsd", () => {
  it("formats shares and clamps", () => {
    expect(formatSharePct(0.5)).toBe("50%")
    expect(formatSharePct(1.4)).toBe("100%")
    expect(formatSharePct(Number.NaN)).toBe("—")
  })

  it("shows liquidation-room breaches as negative instead of clamping to 0%", () => {
    expect(formatLiquidationRoomPct(0.375)).toBe("38%")
    expect(formatLiquidationRoomPct(1.4)).toBe("100%") // upside still capped
    // A price below the lender's sell price must surface as a breach, not 0%.
    expect(formatLiquidationRoomPct(-0.25)).toBe("-25%")
    expect(formatLiquidationRoomPct(null)).toBe("—")
    expect(formatLiquidationRoomPct(Number.NaN)).toBe("—")
  })

  it("values sats at spot, zero when price unknown", () => {
    expect(satsToUsd(100_000_000, 100_000)).toBe(100_000)
    expect(satsToUsd(100_000_000, 0)).toBe(0)
  })
})

describe("gapSummaryLine", () => {
  it("celebrates when both gaps are closed", () => {
    expect(gapSummaryLine(0, 0)).toMatch(/on track/i)
  })

  it("names cash and bitcoin shortfalls", () => {
    expect(gapSummaryLine(1500, 0)).toMatch(/\$1,500 more in cash/)
    expect(gapSummaryLine(0, 2000)).toMatch(/\$2,000 more in bitcoin/)
    const both = gapSummaryLine(1000, 2000)
    expect(both).toMatch(/cash/)
    expect(both).toMatch(/bitcoin/)
  })

  it("handles an infinite bitcoin requirement", () => {
    expect(gapSummaryLine(0, Infinity)).toMatch(/more bitcoin/)
  })
})

describe("runway glance copy", () => {
  it("does not call the cushion covered while cash is short today", () => {
    const line = runwayHeroDetail({
      holdingsEmpty: false,
      underFloor: true,
      shortfallUsd: 25200,
      projectedCashGapUsd: 0,
      projectedBitcoinGapUsd: 53800,
    })
    expect(line).toMatch(/short today/i)
    expect(line).not.toMatch(/covered/i)
    expect(line).not.toMatch(/on track/i)
  })

  it("talks about the step-back date only once today's cushion is funded", () => {
    const line = runwayHeroDetail({
      holdingsEmpty: false,
      underFloor: false,
      shortfallUsd: 0,
      projectedCashGapUsd: 0,
      projectedBitcoinGapUsd: 53800,
    })
    expect(line).toMatch(/by the time you step back/i)
    expect(line).toMatch(/bitcoin/i)
    expect(line).not.toMatch(/covered/i)
  })

  it("asks for holdings before sizing a gap", () => {
    expect(
      runwayPrimaryAction({ holdingsEmpty: true, underFloor: true }),
    ).toBe("add_holdings")
    expect(
      runwayPrimaryAction({ holdingsEmpty: false, underFloor: true }),
    ).toBe("refill_cushion")
    expect(
      runwayPrimaryAction({ holdingsEmpty: false, underFloor: false }),
    ).toBe("none")
    expect(
      holdingsLookEmpty({
        cashUsd: 0,
        bitcoinUsd: 0,
        cashOverrideUsd: null,
        bitcoinOverrideSats: null,
      }),
    ).toBe(true)
    expect(
      holdingsLookEmpty({
        cashUsd: 0,
        bitcoinUsd: 0,
        cashOverrideUsd: 0,
        bitcoinOverrideSats: 0,
      }),
    ).toBe(false)
  })

  it("headlines months left, or a prompt when the plan has no draw", () => {
    expect(runwayMonthsHeadline(19.2)).toBe("About 19 months")
    expect(runwayMonthsHeadline(null)).toBe("Add your numbers")
  })
})

describe("buildPlanPutBody", () => {
  it("echoes the plan, applies the patch, and drops timestamps", () => {
    const plan = makePlan({ runwayIncomeUsd: 500, scenarios: [] })
    const body = buildPlanPutBody(plan, { cashOverrideUsd: 1234 })
    expect(body.cashOverrideUsd).toBe(1234)
    expect(body.runwayIncomeUsd).toBe(500)
    expect(body.phase).toBe("buildup")
    expect("createdAt" in body).toBe(false)
    expect("updatedAt" in body).toBe(false)
  })
})

describe("buildRunwayComputation", () => {
  it("composes need + gap and exposes months until quit", () => {
    const plan = makePlan({
      phase: "buildup",
      quitDate: "2027-01-01",
      horizonMonths: 12,
      livingBaselineOverrideUsd: 3000,
      runwayIncomeUsd: 0,
    })
    const result = buildRunwayComputation({
      plan,
      livingBaselineUsd: 3000,
      envelopeCashUsd: 10_000,
      walletSats: 50_000_000,
      lenderHeldSats: 0,
      amountDueUsd: 0,
      btcPriceUsd: 100_000,
      todayIso: "2026-01-01",
      scenarioMode: "none",
      monthlySavingsUsd: 1000,
      flexibleCutMonthlyUsd: 0,
    })
    expect(result.monthsUntilQuit).toBe(12)
    expect(result.need.monthlyDrawUsd).toBeGreaterThan(0)
    expect(result.need.cashUsd).toBe(10_000)
    expect(result.gap.cashRequiredUsd).toBe(result.need.cashFloorUsedUsd)
    expect(result.gap.requiredBitcoinSats).toBe(result.need.requiredBitcoinSatsSpot)
  })
})
