import { describe, expect, it } from "vitest"
import {
  RUNWAY_PLAN_DEFAULTS,
} from "../runway-plan"
import {
  borrowingAllowed,
  buildPlanPutBody,
  buildRunwayComputation,
  holdingsAfterSaleLinked,
  mergeSavedPlan,
  parseHoldingsOverrides,
  rollbackPlanPatch,
  checkupMonthName,
  effectiveBorrowCapFraction,
  formatLiquidationRoomPct,
  formatSharePct,
  gapSummaryLine,
  holdingsLookEmpty,
  isCheckupReady,
  isRunwayConfigured,
  knownBitcoinSats,
  runwayMoneyLabel,
  knownCashUsd,
  monthsUntilQuit,
  resolveLivingBaselineUsd,
  runwayHeroDetail,
  runwayMonthsHeadline,
  runwayPrimaryAction,
  shouldPromptHoldings,
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
  const buildup = { alreadySteppedBack: false }

  it("does not call the cushion covered while cash is short today", () => {
    const line = runwayHeroDetail({
      holdingsEmpty: false,
      underFloor: true,
      shortfallUsd: 25200,
      projectedCashGapUsd: 0,
      projectedBitcoinGapUsd: 53800,
      ...buildup,
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
      ...buildup,
    })
    expect(line).toMatch(/by the time you step back/i)
    expect(line).toMatch(/bitcoin/i)
    expect(line).not.toMatch(/covered/i)
  })

  it("does not talk about a future step-back after the user already left work", () => {
    const short = runwayHeroDetail({
      holdingsEmpty: false,
      underFloor: false,
      shortfallUsd: 0,
      projectedCashGapUsd: 1200,
      projectedBitcoinGapUsd: 500,
      alreadySteppedBack: true,
    })
    expect(short).toMatch(/for the months you planned/i)
    expect(short).toMatch(/more cash/)
    expect(short).toMatch(/more bitcoin/)
    expect(short).not.toMatch(/step back/i)
    expect(short).not.toMatch(/date you picked/i)

    const onTrack = runwayHeroDetail({
      holdingsEmpty: false,
      underFloor: false,
      shortfallUsd: 0,
      projectedCashGapUsd: 0,
      projectedBitcoinGapUsd: 0,
      alreadySteppedBack: true,
    })
    expect(onTrack).toBe("You have enough set aside for the months you planned.")
    expect(onTrack).not.toMatch(/date you picked/i)
  })

  it("asks for holdings before sizing a gap, and ignores a missing bitcoin price", () => {
    expect(
      runwayHeroDetail({
        holdingsEmpty: true,
        underFloor: true,
        shortfallUsd: 1000,
        projectedCashGapUsd: 0,
        projectedBitcoinGapUsd: 0,
        ...buildup,
      }),
    ).toMatch(/add the cash and bitcoin/i)
    expect(
      runwayHeroDetail({
        holdingsEmpty: false,
        underFloor: false,
        shortfallUsd: 0,
        projectedCashGapUsd: 0,
        projectedBitcoinGapUsd: 0,
        ...buildup,
      }),
    ).toBe("You're on track for the date you picked.")
    expect(
      runwayHeroDetail({
        holdingsEmpty: false,
        underFloor: false,
        shortfallUsd: 0,
        projectedCashGapUsd: 400,
        projectedBitcoinGapUsd: Number.POSITIVE_INFINITY,
        ...buildup,
      }),
    ).toBe("By the time you step back, you're still short $400 more cash and more bitcoin.")

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
        bitcoinSats: 0,
        cashOverrideUsd: null,
        bitcoinOverrideSats: null,
      }),
    ).toBe(true)
    // Sats on hand with no dollar price must not look empty.
    expect(
      holdingsLookEmpty({
        cashUsd: 0,
        bitcoinSats: 50_000_000,
        cashOverrideUsd: null,
        bitcoinOverrideSats: null,
      }),
    ).toBe(false)
    expect(
      holdingsLookEmpty({
        cashUsd: 0,
        bitcoinSats: 0,
        cashOverrideUsd: 0,
        bitcoinOverrideSats: 0,
      }),
    ).toBe(false)
    expect(
      shouldPromptHoldings({
        envelopeCashUsd: 0,
        walletSats: 0,
        cashOverrideUsd: null,
        bitcoinOverrideSats: null,
      }),
    ).toBe(true)
    expect(
      shouldPromptHoldings({
        envelopeCashUsd: 0,
        walletSats: 100_000,
        cashOverrideUsd: null,
        bitcoinOverrideSats: null,
      }),
    ).toBe(false)
    expect(
      shouldPromptHoldings({
        envelopeCashUsd: 2_000,
        walletSats: 0,
        cashOverrideUsd: null,
        bitcoinOverrideSats: null,
      }),
    ).toBe(false)
    expect(
      shouldPromptHoldings({
        envelopeCashUsd: 0,
        walletSats: 0,
        cashOverrideUsd: null,
        bitcoinOverrideSats: 0,
      }),
    ).toBe(false)
  })

  it("headlines months left, or a prompt when the plan has no draw", () => {
    expect(runwayMonthsHeadline(19.2)).toBe("About 19 months")
    expect(runwayMonthsHeadline(0.2)).toBe("Under a month")
    expect(runwayMonthsHeadline(null)).toBe("Add your numbers")
    expect(runwayMonthsHeadline(Number.POSITIVE_INFINITY)).toBe("Add your numbers")
  })
})

describe("buildPlanPutBody", () => {
  it("echoes the plan, applies the patch, and drops timestamps and the checkup month", () => {
    const plan = makePlan({
      runwayIncomeUsd: 500,
      scenarios: [],
      checkupOpenedMonthKey: "2026-03",
    })
    const body = buildPlanPutBody(plan, { cashOverrideUsd: 1234 })
    expect(body.cashOverrideUsd).toBe(1234)
    expect(body.runwayIncomeUsd).toBe(500)
    expect(body.phase).toBe("buildup")
    expect("createdAt" in body).toBe(false)
    expect("updatedAt" in body).toBe(false)
    expect("checkupOpenedMonthKey" in body).toBe(false)
  })
})

describe("rollbackPlanPatch", () => {
  it("restores only the fields this save wrote", () => {
    const baseline = makePlan({ cashOverrideUsd: null, runwayIncomeUsd: 100 })
    const patch = { cashOverrideUsd: 50 }
    const optimistic = { ...baseline, ...patch }
    const rolled = rollbackPlanPatch(optimistic, baseline, patch)
    expect(rolled.cashOverrideUsd).toBeNull()
    expect(rolled.runwayIncomeUsd).toBe(100)
  })

  it("leaves a newer edit of the same field alone", () => {
    const baseline = makePlan({ cashOverrideUsd: null })
    const patch = { cashOverrideUsd: 50 }
    const newer = makePlan({ cashOverrideUsd: 80 })
    expect(rollbackPlanPatch(newer, baseline, patch).cashOverrideUsd).toBe(80)
  })
})

describe("mergeSavedPlan", () => {
  it("keeps a newer field and still takes the server checkup month", () => {
    const baseline = makePlan({ cashOverrideUsd: null, scenarios: [] })
    const patch = { cashOverrideUsd: 50 }
    const optimistic = { ...baseline, ...patch }
    const saved = makePlan({
      cashOverrideUsd: 50,
      checkupOpenedMonthKey: "2026-04",
    })
    const newer = { ...optimistic, runwayIncomeUsd: 900 }
    const merged = mergeSavedPlan(newer, optimistic, saved, patch)
    expect(merged.runwayIncomeUsd).toBe(900)
    expect(merged.cashOverrideUsd).toBe(50)
    expect(merged.checkupOpenedMonthKey).toBe("2026-04")
  })

  it("returns the server row when nothing newer landed", () => {
    const baseline = makePlan()
    const patch = { cashOverrideUsd: 10 }
    const optimistic = { ...baseline, ...patch }
    const saved = makePlan({ cashOverrideUsd: 10, updatedAt: "2026-05-01T00:00:00.000Z" })
    expect(mergeSavedPlan(optimistic, optimistic, saved, patch)).toBe(saved)
  })
})

describe("holdingsAfterSaleLinked", () => {
  it("adds proceeds onto envelope cash when no cash total was typed", () => {
    expect(
      holdingsAfterSaleLinked(
        { bitcoinOverrideSats: null, cashOverrideUsd: null },
        { sats: 1000, proceedsUsd: 250 },
        1000,
      ),
    ).toEqual({ bitcoinOverrideSats: null, cashOverrideUsd: 1250 })
  })

  it("subtracts sold sats from a typed bitcoin total and stacks proceeds on a typed cash total", () => {
    expect(
      holdingsAfterSaleLinked(
        { bitcoinOverrideSats: 50_000, cashOverrideUsd: 40 },
        { sats: 10_000, proceedsUsd: 20 },
        999,
      ),
    ).toEqual({ bitcoinOverrideSats: 40_000, cashOverrideUsd: 60 })
  })

  it("does not invent a cash total when proceeds are missing", () => {
    expect(
      holdingsAfterSaleLinked(
        { bitcoinOverrideSats: 5, cashOverrideUsd: null },
        { sats: 5, proceedsUsd: null },
        100,
      ),
    ).toEqual({ bitcoinOverrideSats: 0, cashOverrideUsd: null })
  })
})

describe("parseHoldingsOverrides", () => {
  it("treats blanks as follow-the-budget", () => {
    expect(parseHoldingsOverrides("  ", "")).toEqual({
      ok: true,
      cashOverrideUsd: null,
      bitcoinOverrideSats: null,
    })
  })

  it("rejects a negative cash or bitcoin total", () => {
    expect(parseHoldingsOverrides("-1", "").ok).toBe(false)
    expect(parseHoldingsOverrides("", "-0.1").ok).toBe(false)
  })

  it("converts bitcoin to sats", () => {
    expect(parseHoldingsOverrides("10.5", "0.5")).toEqual({
      ok: true,
      cashOverrideUsd: 10.5,
      bitcoinOverrideSats: 50_000_000,
    })
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

describe("runwayMoneyLabel", () => {
  it("formats a finite bill and hides a non-finite one", () => {
    expect(runwayMoneyLabel(1200)).toBe("$1,200")
    expect(runwayMoneyLabel(0)).toBe("$0")
    expect(runwayMoneyLabel(Number.NaN)).toBe("—")
    expect(runwayMoneyLabel(Number.POSITIVE_INFINITY)).toBe("—")
    expect(runwayMoneyLabel(null)).toBe("—")
    expect(runwayMoneyLabel(undefined)).toBe("—")
  })
})
