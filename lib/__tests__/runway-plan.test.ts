// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  MAX_BITCOIN_OVERRIDE_SATS,
  MAX_ENVELOPE_PRIORITIES,
  MAX_HORIZON_MONTHS,
  MAX_PLANNED_LINES,
  MAX_RUNWAY_TEXT_LENGTH,
  MAX_SCENARIOS,
  RUNWAY_PLAN_DEFAULTS,
  parseRunwayPlanBody,
  validateEnvelopePriorities,
  validatePlannedLines,
  validateRiskFields,
  validateScenarios,
  type RunwayPlanValues,
} from "../runway-plan"

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${result.error}`)
  }
  return result.value
}

describe("validatePlannedLines", () => {
  it("accepts a valid list and normalizes amounts", () => {
    const value = expectOk(
      validatePlannedLines([
        {
          id: "a",
          group: "home",
          label: "Rent",
          monthlyUsd: 1200.009,
          mode: "add",
        },
        {
          id: "b",
          group: "car",
          label: "New payment",
          monthlyUsd: 300,
          mode: "replaces",
          replacesMonthlyUsd: 450.555,
        },
      ]),
    )
    expect(value).toEqual([
      { id: "a", group: "home", label: "Rent", monthlyUsd: 1200.01, mode: "add" },
      {
        id: "b",
        group: "car",
        label: "New payment",
        monthlyUsd: 300,
        mode: "replaces",
        replacesMonthlyUsd: 450.56,
      },
    ])
  })

  it("rejects a non-array", () => {
    expect(validatePlannedLines({}).ok).toBe(false)
    expect(validatePlannedLines("nope").ok).toBe(false)
  })

  it("rejects unknown mode", () => {
    const res = validatePlannedLines([
      { id: "a", group: "g", label: "l", monthlyUsd: 1, mode: "nope" },
    ])
    expect(res.ok).toBe(false)
  })

  it("rejects missing id", () => {
    expect(
      validatePlannedLines([
        { id: "   ", group: "g", label: "l", monthlyUsd: 1, mode: "add" },
      ]).ok,
    ).toBe(false)
  })

  it("rejects negative amount", () => {
    expect(
      validatePlannedLines([
        { id: "a", group: "g", label: "l", monthlyUsd: -1, mode: "add" },
      ]).ok,
    ).toBe(false)
  })

  it("trims ids, drops replaced amount on add lines, and rejects duplicates", () => {
    const value = expectOk(
      validatePlannedLines([
        {
          id: "  a  ",
          group: " home ",
          label: " Rent ",
          monthlyUsd: 1,
          mode: "add",
          replacesMonthlyUsd: 9,
        },
      ]),
    )
    expect(value[0]).toEqual({
      id: "a",
      group: "home",
      label: "Rent",
      monthlyUsd: 1,
      mode: "add",
    })
    expect(
      validatePlannedLines([
        { id: "a", group: "g", label: "l", monthlyUsd: 1, mode: "add" },
        { id: " a ", group: "g", label: "l", monthlyUsd: 2, mode: "add" },
      ]).ok,
    ).toBe(false)
    // A bad replaced amount is still rejected on an add line.
    expect(
      validatePlannedLines([
        {
          id: "a",
          group: "g",
          label: "l",
          monthlyUsd: 1,
          mode: "add",
          replacesMonthlyUsd: -5,
        },
      ]).ok,
    ).toBe(false)
  })

  it("rejects text and lists over the storage cap", () => {
    expect(
      validatePlannedLines([
        {
          id: "a",
          group: "g",
          label: "l".repeat(MAX_RUNWAY_TEXT_LENGTH + 1),
          monthlyUsd: 1,
          mode: "add",
        },
      ]).ok,
    ).toBe(false)
    const lines = Array.from({ length: MAX_PLANNED_LINES + 1 }, (_, i) => ({
      id: `id-${i}`,
      group: "g",
      label: "l",
      monthlyUsd: 1,
      mode: "add" as const,
    }))
    expect(validatePlannedLines(lines).ok).toBe(false)
  })

  it("rejects bad replacesMonthlyUsd but allows null", () => {
    expect(
      validatePlannedLines([
        {
          id: "a",
          group: "g",
          label: "l",
          monthlyUsd: 1,
          mode: "replaces",
          replacesMonthlyUsd: -5,
        },
      ]).ok,
    ).toBe(false)
    const ok = expectOk(
      validatePlannedLines([
        {
          id: "a",
          group: "g",
          label: "l",
          monthlyUsd: 1,
          mode: "replaces",
          replacesMonthlyUsd: null,
        },
      ]),
    )
    expect(ok[0].replacesMonthlyUsd).toBeUndefined()
  })
})

describe("validateScenarios", () => {
  it("accepts valid scenarios including negative deltas", () => {
    const value = expectOk(
      validateScenarios([
        {
          id: "s1",
          label: "Baby",
          monthlyDeltaUsd: 500,
          oneTimeUsd: 2000,
          enabled: true,
        },
        {
          id: "s2",
          label: "Downsize",
          monthlyDeltaUsd: -400.999,
          oneTimeUsd: -100,
          enabled: false,
        },
      ]),
    )
    expect(value[1]).toEqual({
      id: "s2",
      label: "Downsize",
      monthlyDeltaUsd: -401,
      oneTimeUsd: -100,
      enabled: false,
    })
  })

  it("rejects non-array and non-boolean enabled", () => {
    expect(validateScenarios("x").ok).toBe(false)
    expect(
      validateScenarios([
        {
          id: "s",
          label: "l",
          monthlyDeltaUsd: 0,
          oneTimeUsd: 0,
          enabled: "yes",
        },
      ]).ok,
    ).toBe(false)
  })

  it("trims ids and rejects duplicates and oversized lists", () => {
    const value = expectOk(
      validateScenarios([
        {
          id: "  s  ",
          label: " Downsize ",
          monthlyDeltaUsd: 1,
          oneTimeUsd: 0,
          enabled: true,
        },
      ]),
    )
    expect(value[0].id).toBe("s")
    expect(value[0].label).toBe("Downsize")
    expect(
      validateScenarios([
        { id: "s", label: "l", monthlyDeltaUsd: 0, oneTimeUsd: 0, enabled: true },
        { id: " s ", label: "l", monthlyDeltaUsd: 0, oneTimeUsd: 0, enabled: false },
      ]).ok,
    ).toBe(false)
    const scenarios = Array.from({ length: MAX_SCENARIOS + 1 }, (_, i) => ({
      id: `s-${i}`,
      label: "l",
      monthlyDeltaUsd: 0,
      oneTimeUsd: 0,
      enabled: true,
    }))
    expect(validateScenarios(scenarios).ok).toBe(false)
  })

  it("rejects missing id and non-finite amounts", () => {
    expect(
      validateScenarios([
        { id: "", label: "l", monthlyDeltaUsd: 0, oneTimeUsd: 0, enabled: true },
      ]).ok,
    ).toBe(false)
    expect(
      validateScenarios([
        {
          id: "s",
          label: "l",
          monthlyDeltaUsd: Number.POSITIVE_INFINITY,
          oneTimeUsd: 0,
          enabled: true,
        },
      ]).ok,
    ).toBe(false)
  })
})

describe("validateEnvelopePriorities", () => {
  it("accepts essential/flexible map", () => {
    const value = expectOk(
      validateEnvelopePriorities({ env1: "essential", env2: "flexible" }),
    )
    expect(value).toEqual({ env1: "essential", env2: "flexible" })
  })

  it("rejects arrays and unknown values", () => {
    expect(validateEnvelopePriorities([]).ok).toBe(false)
    expect(validateEnvelopePriorities({ e: "critical" }).ok).toBe(false)
  })

  it("trims ids and rejects blank, duplicate, and prototype keys", () => {
    const value = expectOk(
      validateEnvelopePriorities({ " env1 ": "essential" }),
    )
    expect(value).toEqual({ env1: "essential" })
    expect(validateEnvelopePriorities({ "  ": "essential" }).ok).toBe(false)
    expect(
      validateEnvelopePriorities({ env1: "essential", " env1 ": "flexible" }).ok,
    ).toBe(false)
    expect(
      validateEnvelopePriorities(JSON.parse('{"__proto__":"essential"}')).ok,
    ).toBe(false)
    expect(validateEnvelopePriorities({ constructor: "essential" }).ok).toBe(
      false,
    )
    const tooMany: Record<string, "essential"> = {}
    for (let i = 0; i < MAX_ENVELOPE_PRIORITIES + 1; i++) {
      tooMany[`e${i}`] = "essential"
    }
    expect(validateEnvelopePriorities(tooMany).ok).toBe(false)
  })
})

describe("validateRiskFields", () => {
  it("fills defaults when fields omitted", () => {
    const value = expectOk(validateRiskFields({}))
    expect(value).toEqual({
      dipResponse: RUNWAY_PLAN_DEFAULTS.dipResponse,
      btcSharePreference: RUNWAY_PLAN_DEFAULTS.btcSharePreference,
      borrowStance: RUNWAY_PLAN_DEFAULTS.borrowStance,
    })
  })

  it("accepts valid answers", () => {
    const value = expectOk(
      validateRiskFields({
        dipResponse: "sell",
        btcSharePreference: "most",
        borrowStance: "ok",
      }),
    )
    expect(value).toEqual({
      dipResponse: "sell",
      btcSharePreference: "most",
      borrowStance: "ok",
    })
  })

  it("rejects unknown answers", () => {
    expect(validateRiskFields({ dipResponse: "panic" }).ok).toBe(false)
    expect(validateRiskFields({ btcSharePreference: "all" }).ok).toBe(false)
    expect(validateRiskFields({ borrowStance: "always" }).ok).toBe(false)
    expect(validateRiskFields("nope").ok).toBe(false)
  })
})

describe("parseRunwayPlanBody", () => {
  it("returns defaults for an empty object", () => {
    const value = expectOk(parseRunwayPlanBody({}))
    expect(value).toEqual(RUNWAY_PLAN_DEFAULTS)
    // Ensure we return a fresh object, not the shared default reference.
    expect(value).not.toBe(RUNWAY_PLAN_DEFAULTS)
    expect(value.plannedLines).not.toBe(RUNWAY_PLAN_DEFAULTS.plannedLines)
    expect(value.scenarios).not.toBe(RUNWAY_PLAN_DEFAULTS.scenarios)
    expect(value.envelopePriorities).not.toBe(
      RUNWAY_PLAN_DEFAULTS.envelopePriorities,
    )
  })

  it("does not let one parse mutate the next default plan", () => {
    const first = expectOk(parseRunwayPlanBody({}))
    first.plannedLines.push({
      id: "x",
      group: "g",
      label: "l",
      monthlyUsd: 1,
      mode: "add",
    })
    first.scenarios.push({
      id: "s",
      label: "l",
      monthlyDeltaUsd: 1,
      oneTimeUsd: 0,
      enabled: true,
    })
    first.envelopePriorities.env = "essential"
    const second = expectOk(parseRunwayPlanBody({}))
    expect(second.plannedLines).toEqual([])
    expect(second.scenarios).toEqual([])
    expect(second.envelopePriorities).toEqual({})
    expect(RUNWAY_PLAN_DEFAULTS.plannedLines).toEqual([])
    expect(RUNWAY_PLAN_DEFAULTS.scenarios).toEqual([])
    expect(RUNWAY_PLAN_DEFAULTS.envelopePriorities).toEqual({})
  })

  it("rejects non-object bodies", () => {
    expect(parseRunwayPlanBody(null).ok).toBe(false)
    expect(parseRunwayPlanBody([]).ok).toBe(false)
    expect(parseRunwayPlanBody("x").ok).toBe(false)
  })

  it("parses a full valid body", () => {
    const body = {
      phase: "runway",
      quitDate: "2027-01-15",
      horizonMonths: 36,
      runwayIncomeUsd: "1500.005",
      livingBaselineOverrideUsd: 4000,
      inflationRateYear: 0.03,
      stressPercent: 0.25,
      growthRateYear: 0.1,
      dipResponse: "wait",
      btcSharePreference: "little",
      borrowStance: "never",
      editedCashFloorUsd: 10000,
      editedBorrowCapFraction: 0.3,
      cashOverrideUsd: 25000,
      bitcoinOverrideSats: 50_000_000,
      plannedLines: [
        { id: "p1", group: "home", label: "Rent", monthlyUsd: 2000, mode: "add" },
      ],
      scenarios: [
        {
          id: "sc1",
          label: "Travel",
          monthlyDeltaUsd: 300,
          oneTimeUsd: 1500,
          enabled: true,
        },
      ],
      envelopePriorities: { e1: "essential" },
      checkupOpenedMonthKey: "2026-11",
    }
    const value = expectOk(parseRunwayPlanBody(body))
    const expected: RunwayPlanValues = {
      phase: "runway",
      quitDate: "2027-01-15",
      horizonMonths: 36,
      runwayIncomeUsd: 1500.01,
      livingBaselineOverrideUsd: 4000,
      inflationRateYear: 0.03,
      stressPercent: 0.25,
      growthRateYear: 0.1,
      dipResponse: "wait",
      btcSharePreference: "little",
      borrowStance: "never",
      editedCashFloorUsd: 10000,
      editedBorrowCapFraction: 0.3,
      cashOverrideUsd: 25000,
      bitcoinOverrideSats: 50_000_000,
      plannedLines: [
        { id: "p1", group: "home", label: "Rent", monthlyUsd: 2000, mode: "add" },
      ],
      scenarios: [
        {
          id: "sc1",
          label: "Travel",
          monthlyDeltaUsd: 300,
          oneTimeUsd: 1500,
          enabled: true,
        },
      ],
      envelopePriorities: { e1: "essential" },
      checkupOpenedMonthKey: "2026-11",
    }
    expect(value).toEqual(expected)
  })

  it("treats empty-string optionals as null", () => {
    const value = expectOk(
      parseRunwayPlanBody({
        quitDate: "",
        livingBaselineOverrideUsd: "",
        growthRateYear: "",
        editedCashFloorUsd: "",
        editedBorrowCapFraction: "",
        cashOverrideUsd: "",
        bitcoinOverrideSats: "",
        checkupOpenedMonthKey: "",
      }),
    )
    expect(value.quitDate).toBeNull()
    expect(value.livingBaselineOverrideUsd).toBeNull()
    expect(value.growthRateYear).toBeNull()
    expect(value.editedCashFloorUsd).toBeNull()
    expect(value.editedBorrowCapFraction).toBeNull()
    expect(value.cashOverrideUsd).toBeNull()
    expect(value.bitcoinOverrideSats).toBeNull()
    expect(value.checkupOpenedMonthKey).toBeNull()
  })

  it("rejects an invalid phase", () => {
    expect(parseRunwayPlanBody({ phase: "coasting" }).ok).toBe(false)
  })

  it("rejects a malformed quit date", () => {
    expect(parseRunwayPlanBody({ quitDate: "2027/01/15" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ quitDate: "2027-13-40" }).ok).toBe(false)
  })

  it("rejects calendar-impossible quit dates that Date() would normalize", () => {
    // Day overflow: Feb never has 31 days (Date would roll to March 3).
    expect(parseRunwayPlanBody({ quitDate: "2027-02-31" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ quitDate: "2027-02-29" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ quitDate: "1900-02-29" }).ok).toBe(false)
    // Month overflow and day-zero.
    expect(parseRunwayPlanBody({ quitDate: "2027-00-10" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ quitDate: "2027-04-31" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ quitDate: "2027-01-00" }).ok).toBe(false)
    // Real dates still pass, including a valid leap day.
    expect(expectOk(parseRunwayPlanBody({ quitDate: "2027-02-28" })).quitDate).toBe(
      "2027-02-28",
    )
    expect(expectOk(parseRunwayPlanBody({ quitDate: "2028-02-29" })).quitDate).toBe(
      "2028-02-29",
    )
  })

  it("rejects out-of-range horizon", () => {
    expect(parseRunwayPlanBody({ horizonMonths: 0 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ horizonMonths: 2.5 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ horizonMonths: MAX_HORIZON_MONTHS + 1 }).ok).toBe(
      false,
    )
  })

  it("rejects negative income", () => {
    expect(parseRunwayPlanBody({ runwayIncomeUsd: -1 }).ok).toBe(false)
  })

  it("enforces stress between 0 and 1", () => {
    expect(parseRunwayPlanBody({ stressPercent: -0.1 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ stressPercent: 1.1 }).ok).toBe(false)
    expect(expectOk(parseRunwayPlanBody({ stressPercent: 0 })).stressPercent).toBe(
      0,
    )
    expect(expectOk(parseRunwayPlanBody({ stressPercent: 1 })).stressPercent).toBe(
      1,
    )
  })

  it("enforces reasonable rate ranges", () => {
    expect(parseRunwayPlanBody({ inflationRateYear: 99 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ inflationRateYear: -1 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ growthRateYear: 99 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ growthRateYear: -2 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ editedBorrowCapFraction: 1.5 }).ok).toBe(false)
  })

  it("validates bitcoin override sats", () => {
    expect(parseRunwayPlanBody({ bitcoinOverrideSats: -1 }).ok).toBe(false)
    expect(parseRunwayPlanBody({ bitcoinOverrideSats: 1.5 }).ok).toBe(false)
    expect(
      parseRunwayPlanBody({ bitcoinOverrideSats: MAX_BITCOIN_OVERRIDE_SATS + 1 })
        .ok,
    ).toBe(false)
    expect(
      expectOk(parseRunwayPlanBody({ bitcoinOverrideSats: 0 }))
        .bitcoinOverrideSats,
    ).toBe(0)
  })

  it("propagates nested validation errors", () => {
    expect(
      parseRunwayPlanBody({
        plannedLines: [{ id: "a", group: "g", label: "l", monthlyUsd: -1, mode: "add" }],
      }).ok,
    ).toBe(false)
    expect(parseRunwayPlanBody({ scenarios: "nope" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ envelopePriorities: { e: "bad" } }).ok).toBe(
      false,
    )
  })

  it("rejects a bad checkup month key", () => {
    expect(parseRunwayPlanBody({ checkupOpenedMonthKey: "2026-13-01" }).ok).toBe(
      false,
    )
    expect(parseRunwayPlanBody({ checkupOpenedMonthKey: "nope" }).ok).toBe(false)
  })

  it("rejects month keys whose month is outside 01–12", () => {
    // Regex-shaped but out of range (the bug: 2026-99 used to pass).
    expect(parseRunwayPlanBody({ checkupOpenedMonthKey: "2026-99" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ checkupOpenedMonthKey: "2026-00" }).ok).toBe(false)
    expect(parseRunwayPlanBody({ checkupOpenedMonthKey: "2026-13" }).ok).toBe(false)
    // Valid bounds still pass.
    expect(
      expectOk(parseRunwayPlanBody({ checkupOpenedMonthKey: "2026-01" }))
        .checkupOpenedMonthKey,
    ).toBe("2026-01")
    expect(
      expectOk(parseRunwayPlanBody({ checkupOpenedMonthKey: "2026-12" }))
        .checkupOpenedMonthKey,
    ).toBe("2026-12")
  })
})
