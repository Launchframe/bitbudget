// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  incomeDistributionConfigFromPanel,
  parseIncomeDistributionConfig,
  parseMoveFundsRuleConfig,
  parseRecurringFundingConfig,
} from "@/lib/recurring-funding-config"

describe("parseIncomeDistributionConfig", () => {
  it("accepts a valid panel-shaped config", () => {
    const config = parseIncomeDistributionConfig({
      distributionBehavior: "add_budget",
      fundOverageFromSavings: true,
      grossUsd: 1200.456,
    })
    expect(config).toEqual({
      distributionBehavior: "add_budget",
      fundOverageFromSavings: true,
      grossUsd: 1200.456,
    })
  })

  it("rejects non-objects and invalid behavior", () => {
    expect(parseIncomeDistributionConfig(null)).toBeNull()
    expect(parseIncomeDistributionConfig([])).toBeNull()
    expect(
      parseIncomeDistributionConfig({
        distributionBehavior: "invalid",
        fundOverageFromSavings: true,
      }),
    ).toBeNull()
  })

  it("requires fundOverageFromSavings to be boolean", () => {
    expect(
      parseIncomeDistributionConfig({
        distributionBehavior: "set_to_budget",
        fundOverageFromSavings: "yes",
      }),
    ).toBeNull()
  })

  it("rejects non-finite grossUsd when present", () => {
    expect(
      parseIncomeDistributionConfig({
        distributionBehavior: "custom",
        fundOverageFromSavings: false,
        grossUsd: NaN,
      }),
    ).toBeNull()
  })

  it("parses customByEnvelopeId map", () => {
    const config = parseIncomeDistributionConfig({
      distributionBehavior: "custom",
      fundOverageFromSavings: false,
      customByEnvelopeId: { "env-a": 50, "env-b": 25.5 },
    })
    expect(config?.customByEnvelopeId).toEqual({ "env-a": 50, "env-b": 25.5 })
  })

  it("rejects custom map with non-numeric values", () => {
    expect(
      parseIncomeDistributionConfig({
        distributionBehavior: "custom",
        fundOverageFromSavings: false,
        customByEnvelopeId: { "env-a": "50" },
      }),
    ).toBeNull()
  })
})

describe("parseMoveFundsRuleConfig", () => {
  it("accepts balanced mode with rounded entries", () => {
    const config = parseMoveFundsRuleConfig({
      mode: "balanced",
      entries: [
        { envelopeId: " env-a ", deltaUsd: 10.004 },
        { envelopeId: "env-b", deltaUsd: -10.004 },
      ],
    })
    expect(config?.mode).toBe("balanced")
    expect(config?.entries).toHaveLength(2)
    expect(config?.entries[0]?.deltaUsd).toBe(10)
  })

  it("skips near-zero deltas and rejects empty result", () => {
    expect(
      parseMoveFundsRuleConfig({
        mode: "independent",
        entries: [{ envelopeId: "env-a", deltaUsd: 0.001 }],
      }),
    ).toBeNull()
  })

  it("rejects invalid mode or envelope ids", () => {
    expect(parseMoveFundsRuleConfig({ mode: "solo", entries: [] })).toBeNull()
    expect(
      parseMoveFundsRuleConfig({
        mode: "independent",
        entries: [{ envelopeId: "", deltaUsd: 5 }],
      }),
    ).toBeNull()
  })
})

describe("parseRecurringFundingConfig", () => {
  it("dispatches by kind", () => {
    expect(
      parseRecurringFundingConfig("income_distribution", {
        distributionBehavior: "set_to_budget",
        fundOverageFromSavings: false,
      })?.kind,
    ).toBe("income_distribution")
    expect(
      parseRecurringFundingConfig("move_funds", {
        mode: "independent",
        entries: [{ envelopeId: "e1", deltaUsd: 12 }],
      })?.kind,
    ).toBe("rebalance")
    expect(parseRecurringFundingConfig("unknown", {})).toBeNull()
  })
})

describe("incomeDistributionConfigFromPanel", () => {
  it("rounds grossUsd to cents", () => {
    expect(
      incomeDistributionConfigFromPanel({
        distributionBehavior: "add_budget",
        fundOverageFromSavings: true,
        grossUsd: 99.999,
      }),
    ).toEqual({
      distributionBehavior: "add_budget",
      fundOverageFromSavings: true,
      grossUsd: 100,
    })
  })
})
