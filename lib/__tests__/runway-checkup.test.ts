// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  buildRunwayCheckup,
  plannedLineNetMonthlyUsd,
  scenarioEffectUsd,
  type BuildupCheckupInput,
  type CheckupFact,
  type CheckupSection,
  type RunwayPhaseCheckupInput,
} from "../runway-checkup"

function section(checkup: { sections: CheckupSection[] }, id: string): CheckupSection {
  const found = checkup.sections.find((s) => s.id === id)
  if (!found) throw new Error(`missing section ${id}`)
  return found
}

function fact(sec: CheckupSection, id: string): CheckupFact {
  const found = sec.facts.find((f) => f.id === id)
  if (!found) throw new Error(`missing fact ${id} in ${sec.id}`)
  return found
}

function baseBuildup(
  overrides: Partial<BuildupCheckupInput> = {},
): BuildupCheckupInput {
  return {
    monthKey: "2026-03",
    phase: "buildup",
    required: { cashUsd: 10000, bitcoinSats: 5_000_000 },
    projected: {
      cashUsd: { spot: 12000, stress: 8000, growth: 15000 },
      bitcoinSats: { spot: 6_000_000, stress: 4_000_000, growth: 7_000_000 },
    },
    bitcoinShare: 0.4,
    targetBitcoinShare: 0.5,
    livingCostsMonthlyUsd: 3000,
    plannedLines: [],
    hotEnvelopes: [],
    scenarios: [],
    horizonMonths: 24,
    savingsGoal: null,
    ...overrides,
  }
}

function baseRunway(
  overrides: Partial<RunwayPhaseCheckupInput> = {},
): RunwayPhaseCheckupInput {
  return {
    monthKey: "2026-03",
    phase: "runway",
    plannedActuals: [],
    monthsLeft: { spot: 30, stress: 20, growth: 40 },
    loans: [],
    maturity: { insideHorizon: false, monthsUntilMaturity: null },
    incomeArrived: { amountUsd: 2000, monthsOfStackKept: 0.7 },
    ...overrides,
  }
}

describe("plannedLineNetMonthlyUsd", () => {
  it("adds the full amount for add-mode lines", () => {
    expect(
      plannedLineNetMonthlyUsd({ id: "a", label: "x", monthlyUsd: 500, mode: "add" }),
    ).toBe(500)
  })

  it("nets out the replaced amount for replaces-mode lines", () => {
    expect(
      plannedLineNetMonthlyUsd({
        id: "a",
        label: "x",
        monthlyUsd: 500,
        mode: "replaces",
        replacesMonthlyUsd: 300,
      }),
    ).toBe(200)
  })

  it("treats a missing replacesMonthlyUsd as zero", () => {
    expect(
      plannedLineNetMonthlyUsd({
        id: "a",
        label: "x",
        monthlyUsd: 500,
        mode: "replaces",
      }),
    ).toBe(500)
  })

  it("can be negative when the replacement is cheaper", () => {
    expect(
      plannedLineNetMonthlyUsd({
        id: "a",
        label: "x",
        monthlyUsd: 200,
        mode: "replaces",
        replacesMonthlyUsd: 500,
      }),
    ).toBe(-300)
  })
})

describe("scenarioEffectUsd", () => {
  it("totals monthly across the horizon plus one-time", () => {
    expect(
      scenarioEffectUsd(
        { id: "s", label: "x", monthlyDeltaUsd: 100, oneTimeUsd: 500, enabled: true },
        24,
      ),
    ).toBe(2900)
  })

  it("treats a non-positive horizon as zero months", () => {
    expect(
      scenarioEffectUsd(
        { id: "s", label: "x", monthlyDeltaUsd: 100, oneTimeUsd: 500, enabled: true },
        0,
      ),
    ).toBe(500)
  })
})

describe("buildRunwayCheckup — buildup", () => {
  it("echoes monthKey and phase", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    expect(checkup.monthKey).toBe("2026-03")
    expect(checkup.phase).toBe("buildup")
  })

  it("marks projected totals good when they meet the requirement and bad when short", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    const targets = section(checkup, "targets")
    expect(fact(targets, "projected-cash-spot").tone).toBe("good")
    expect(fact(targets, "projected-cash-stress").tone).toBe("bad") // 8000 < 10000
    expect(fact(targets, "projected-cash-growth").tone).toBe("good")
    expect(fact(targets, "projected-bitcoin-spot").tone).toBe("good")
    expect(fact(targets, "projected-bitcoin-stress").tone).toBe("bad")
    expect(fact(targets, "required-cash").value).toBe(10000)
    expect(fact(targets, "required-bitcoin").unit).toBe("sats")
  })

  it("rounds projected cash to cents and bitcoin sats to whole numbers", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({
        projected: {
          cashUsd: { spot: 12000.129, stress: 8000, growth: 15000 },
          bitcoinSats: { spot: 6_000_000.7, stress: 4_000_000, growth: 7_000_000 },
        },
      }),
    )
    const targets = section(checkup, "targets")
    expect(fact(targets, "projected-cash-spot").value).toBe(12000.13)
    expect(fact(targets, "projected-bitcoin-spot").value).toBe(6_000_001)
  })

  it("compares held vs target bitcoin share and clamps to 0–1", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({ bitcoinShare: 1.4, targetBitcoinShare: -0.2 }),
    )
    const share = section(checkup, "bitcoin-share")
    expect(fact(share, "bitcoin-share-held").value).toBe(1)
    expect(fact(share, "bitcoin-share-target").value).toBe(0)
    expect(fact(share, "bitcoin-share-held").tone).toBe("good") // 1 >= 0
  })

  it("flags held-below-target share as warn", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    const share = section(checkup, "bitcoin-share")
    expect(fact(share, "bitcoin-share-held").tone).toBe("warn") // 0.4 < 0.5
  })

  it("lists only planned lines that increase the draw", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({
        plannedLines: [
          { id: "rent", label: "Rent", monthlyUsd: 1200, mode: "add" },
          {
            id: "car",
            label: "Cheaper car",
            monthlyUsd: 200,
            mode: "replaces",
            replacesMonthlyUsd: 500,
          },
          {
            id: "phone",
            label: "Nicer phone plan",
            monthlyUsd: 80,
            mode: "replaces",
            replacesMonthlyUsd: 50,
          },
        ],
      }),
    )
    const draw = section(checkup, "draw")
    const ids = draw.facts.map((f) => f.id)
    expect(ids).toContain("draw-line-rent")
    expect(ids).toContain("draw-line-phone")
    expect(ids).not.toContain("draw-line-car") // net -300, does not raise draw
    expect(fact(draw, "draw-line-phone").value).toBe(30)
  })

  it("shows a reassuring fact when nothing raises the draw", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    const draw = section(checkup, "draw")
    expect(draw.facts).toHaveLength(1)
    expect(draw.facts[0].id).toBe("draw-none")
    expect(draw.facts[0].tone).toBe("good")
  })

  it("lists hot envelopes with overspend and adds a journal prompt", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({
        hotEnvelopes: [
          { envelopeId: "e1", name: "Dining", allottedUsd: 300, spentUsd: 420 },
        ],
      }),
    )
    const hot = section(checkup, "hot-envelopes")
    expect(fact(hot, "hot-e1").value).toBe(120)
    expect(fact(hot, "hot-e1").tone).toBe("bad")
    expect(hot.facts.some((f) => f.id === "hot-prompt")).toBe(true)
  })

  it("shows an all-clear fact and no prompt when no envelopes ran hot", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    const hot = section(checkup, "hot-envelopes")
    expect(hot.facts.some((f) => f.id === "hot-prompt")).toBe(false)
    expect(hot.facts.some((f) => f.id === "hot-none")).toBe(true)
  })

  it("totals each scenario's effect and marks enabled vs disabled tone", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({
        horizonMonths: 12,
        scenarios: [
          { id: "baby", label: "Baby", monthlyDeltaUsd: 500, oneTimeUsd: 2000, enabled: true },
          { id: "move", label: "Move", monthlyDeltaUsd: -200, oneTimeUsd: 0, enabled: false },
        ],
      }),
    )
    const scenarios = section(checkup, "scenarios")
    expect(fact(scenarios, "scenario-baby").value).toBe(8000) // 500*12 + 2000
    expect(fact(scenarios, "scenario-baby").tone).toBe("warn")
    expect(fact(scenarios, "scenario-move").value).toBe(-2400)
    expect(fact(scenarios, "scenario-move").tone).toBe("neutral")
  })

  it("reports a met savings goal", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({ savingsGoal: { targetUsd: 1000, actualUsd: 1200 } }),
    )
    const goal = section(checkup, "savings-goal")
    expect(fact(goal, "savings-goal-outcome").tone).toBe("good")
    expect(fact(goal, "savings-goal-outcome").label).toBe("Goal met")
  })

  it("reports a missed savings goal", () => {
    const checkup = buildRunwayCheckup(
      baseBuildup({ savingsGoal: { targetUsd: 1000, actualUsd: 800 } }),
    )
    const goal = section(checkup, "savings-goal")
    expect(fact(goal, "savings-goal-outcome").tone).toBe("bad")
    expect(fact(goal, "savings-goal-outcome").label).toBe("Goal missed")
  })

  it("omits the savings-goal section when no goal was set", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    expect(checkup.sections.some((s) => s.id === "savings-goal")).toBe(false)
  })

  it("does not emit any runway-only sections", () => {
    const checkup = buildRunwayCheckup(baseBuildup())
    const ids = checkup.sections.map((s) => s.id)
    expect(ids).not.toContain("planned-vs-actual")
    expect(ids).not.toContain("months-left")
    expect(ids).not.toContain("loans")
  })
})

describe("buildRunwayCheckup — runway", () => {
  it("echoes monthKey and phase", () => {
    const checkup = buildRunwayCheckup(baseRunway())
    expect(checkup.monthKey).toBe("2026-03")
    expect(checkup.phase).toBe("runway")
  })

  it("compares each planned line with actual and tones over/under", () => {
    const checkup = buildRunwayCheckup(
      baseRunway({
        plannedActuals: [
          { id: "food", label: "Food", plannedMonthlyUsd: 400, actualMonthlyUsd: 470 },
          { id: "fun", label: "Fun", plannedMonthlyUsd: 200, actualMonthlyUsd: 150 },
          { id: "rent", label: "Rent", plannedMonthlyUsd: 1500, actualMonthlyUsd: 1500 },
        ],
      }),
    )
    const pva = section(checkup, "planned-vs-actual")
    expect(fact(pva, "planned-actual-food").value).toBe(70)
    expect(fact(pva, "planned-actual-food").tone).toBe("bad")
    expect(fact(pva, "planned-actual-fun").value).toBe(-50)
    expect(fact(pva, "planned-actual-fun").tone).toBe("good")
    expect(fact(pva, "planned-actual-rent").value).toBe(0)
    expect(fact(pva, "planned-actual-rent").tone).toBe("good")
  })

  it("reports months left under spot / stress / growth", () => {
    const checkup = buildRunwayCheckup(baseRunway())
    const ml = section(checkup, "months-left")
    expect(fact(ml, "months-left-spot").value).toBe(30)
    expect(fact(ml, "months-left-stress").value).toBe(20)
    expect(fact(ml, "months-left-growth").value).toBe(40)
    expect(fact(ml, "months-left-spot").unit).toBe("months")
  })

  it("summarizes open loans with bill, sell price, and rollover coverage", () => {
    const checkup = buildRunwayCheckup(
      baseRunway({
        loans: [
          {
            id: "l1",
            label: "BTC-backed line",
            monthlyBillUsd: 300,
            roomToSellPriceUsd: 90000,
            rolloverCovers: true,
          },
          {
            id: "l2",
            label: "Second loan",
            monthlyBillUsd: 150,
            roomToSellPriceUsd: 60000,
            rolloverCovers: false,
          },
        ],
      }),
    )
    const loans = section(checkup, "loans")
    expect(fact(loans, "loan-bill-l1").value).toBe(300)
    expect(fact(loans, "loan-sell-l1").value).toBe(90000)
    expect(fact(loans, "loan-rollover-l1").tone).toBe("good")
    expect(fact(loans, "loan-rollover-l2").tone).toBe("warn")
  })

  it("shows a no-loans fact when there are none", () => {
    const checkup = buildRunwayCheckup(baseRunway())
    const loans = section(checkup, "loans")
    expect(loans.facts).toHaveLength(1)
    expect(loans.facts[0].id).toBe("loan-none")
  })

  it("adds a maturity callout only when a holding matures inside the horizon", () => {
    const without = buildRunwayCheckup(baseRunway())
    expect(without.sections.some((s) => s.id === "maturity")).toBe(false)

    const withMaturity = buildRunwayCheckup(
      baseRunway({ maturity: { insideHorizon: true, monthsUntilMaturity: 8 } }),
    )
    const maturity = section(withMaturity, "maturity")
    expect(fact(maturity, "maturity-callout").value).toBe(8)
    expect(fact(maturity, "maturity-callout").unit).toBe("months")
  })

  it("expresses arrived income as dollars and months of stack kept", () => {
    const checkup = buildRunwayCheckup(
      baseRunway({ incomeArrived: { amountUsd: 2500.5, monthsOfStackKept: 1.2 } }),
    )
    const income = section(checkup, "income-arrived")
    expect(fact(income, "income-arrived-amount").value).toBe(2500.5)
    expect(fact(income, "income-arrived-months").value).toBe(1.2)
  })

  it("does not emit any buildup-only sections", () => {
    const checkup = buildRunwayCheckup(baseRunway())
    const ids = checkup.sections.map((s) => s.id)
    expect(ids).not.toContain("targets")
    expect(ids).not.toContain("bitcoin-share")
    expect(ids).not.toContain("scenarios")
  })
})
