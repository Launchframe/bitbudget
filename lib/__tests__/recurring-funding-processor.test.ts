// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { computeDistribution } from "@/lib/move-funds-math"
import {
  parseIncomeDistributionConfig,
  parseMoveFundsRuleConfig,
} from "@/lib/recurring-funding-config"
import { nextRunFromFrequency } from "@/lib/recurring-funding-schedule"
import { recurringFundingBatchPeriodKey } from "@/lib/recurring-funding-processor"

vi.mock("@/lib/move-funds", () => ({
  createMoveFundsBatch: vi.fn(async () => 2),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    envelope: { findMany: vi.fn() },
    recurringFundingRule: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/envelope-funding", () => ({
  ensureSystemSavingsEnvelope: vi.fn(async () => ({ id: "sav-1" })),
}))

vi.mock("@/lib/envelope-balance-server", () => ({
  envelopeBalancesForMonthBatch: vi.fn(async () => new Map([["env-a", 50]])),
  monthKeyFromDate: vi.fn(() => "2026-06"),
  savingsEnvelopeBalanceAllTime: vi.fn(async () => 500),
}))

import { prisma } from "@/lib/db"
import { createMoveFundsBatch } from "@/lib/move-funds"
import { processOneRecurringFundingRule } from "@/lib/recurring-funding-processor"

describe("recurring-funding-config", () => {
  it("parseIncomeDistributionConfig accepts panel-shaped config", () => {
    const config = parseIncomeDistributionConfig({
      distributionBehavior: "set_to_budget",
      fundOverageFromSavings: true,
      grossUsd: 1200,
    })
    expect(config?.distributionBehavior).toBe("set_to_budget")
    expect(config?.grossUsd).toBe(1200)
  })

  it("parseMoveFundsRuleConfig requires non-empty entries", () => {
    expect(parseMoveFundsRuleConfig({ mode: "balanced", entries: [] })).toBeNull()
    const ok = parseMoveFundsRuleConfig({
      mode: "independent",
      entries: [{ envelopeId: "env-a", deltaUsd: 25 }],
    })
    expect(ok?.entries).toHaveLength(1)
  })
})

describe("recurringFundingBatchPeriodKey", () => {
  it("is stable per rule and UTC day", () => {
    const run = new Date(Date.UTC(2026, 5, 15, 18, 0, 0))
    expect(recurringFundingBatchPeriodKey("rule-1", run)).toBe("recurring-funding-rule-1-2026-06-15")
  })
})

describe("processOneRecurringFundingRule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.recurringFundingRule.update).mockResolvedValue({} as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      monthlyIncome: 3000,
      publicKey: "pk",
    } as never)
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      { id: "env-a", monthlyAllotment: 200, systemRole: null },
    ] as never)
  })

  it("runs income_distribution and advances nextRunAt", async () => {
    const asOf = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    const legs = await processOneRecurringFundingRule(
      {
        id: "rule-1",
        userId: "u1",
        kind: "income_distribution",
        frequency: "monthly",
        distributionConfig: {
          distributionBehavior: "set_to_budget",
          fundOverageFromSavings: false,
          grossUsd: 500,
        },
        nextRunAt: asOf,
      },
      asOf,
    )

    expect(legs).toBe(2)
    expect(createMoveFundsBatch).toHaveBeenCalledWith(
      "u1",
      expect.any(Array),
      "independent",
      expect.objectContaining({
        periodKey: "recurring-funding-rule-1-2026-06-10",
      }),
    )
    expect(prisma.recurringFundingRule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextRunAt: nextRunFromFrequency("monthly", asOf),
        }),
      }),
    )
  })

  it("uses monthlyIncome when grossUsd is omitted", async () => {
    const dist = computeDistribution({
      behavior: "add_budget",
      envelopes: [{ id: "env-a", monthlyAllotment: 200, currentMonthBalance: 0 }],
      grossUsd: 3000,
      savingsBalance: 500,
      fundOverageFromSavings: false,
    })
    expect(dist.invalid).toBe(false)
  })
})
