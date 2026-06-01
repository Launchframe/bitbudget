// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { nextRunFromFrequency } from "@/lib/recurring-funding-schedule"

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
import {
  processAllRecurringFundingRules,
  processOneRecurringFundingRule,
  processRecurringFundingRules,
  recurringFundingBatchPeriodKey,
} from "@/lib/recurring-funding-processor"

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

  it("runs move_funds with stored mode and entries", async () => {
    const asOf = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    const legs = await processOneRecurringFundingRule(
      {
        id: "rule-mf",
        userId: "u1",
        kind: "move_funds",
        frequency: "weekly",
        distributionConfig: {
          mode: "balanced",
          entries: [
            { envelopeId: "env-a", deltaUsd: 25 },
            { envelopeId: "env-b", deltaUsd: -25 },
          ],
        },
        nextRunAt: asOf,
      },
      asOf,
    )

    expect(legs).toBe(2)
    expect(createMoveFundsBatch).toHaveBeenCalledWith(
      "u1",
      [
        { envelopeId: "env-a", deltaUsd: 25 },
        { envelopeId: "env-b", deltaUsd: -25 },
      ],
      "balanced",
      expect.objectContaining({ periodKey: "recurring-funding-rule-mf-2026-06-10" }),
    )
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("advances schedule without legs when config is invalid", async () => {
    const asOf = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    const legs = await processOneRecurringFundingRule(
      {
        id: "rule-bad",
        userId: "u1",
        kind: "income_distribution",
        frequency: "monthly",
        distributionConfig: { not: "valid" },
        nextRunAt: asOf,
      },
      asOf,
    )

    expect(legs).toBe(0)
    expect(createMoveFundsBatch).not.toHaveBeenCalled()
    expect(prisma.recurringFundingRule.update).toHaveBeenCalled()
  })

  it("returns 0 legs when user has no public key", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      monthlyIncome: 3000,
      publicKey: "",
    } as never)

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

    expect(legs).toBe(0)
    expect(createMoveFundsBatch).not.toHaveBeenCalled()
    expect(prisma.recurringFundingRule.update).toHaveBeenCalled()
  })
})

describe("processRecurringFundingRules", () => {
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

  it("processes only enabled due rules for the user", async () => {
    const asOf = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    vi.mocked(prisma.recurringFundingRule.findMany).mockResolvedValue([
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
    ] as never)

    const total = await processRecurringFundingRules("u1", asOf)
    expect(total).toBe(2)
    expect(prisma.recurringFundingRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          enabled: true,
        }),
      }),
    )
  })

  it("returns 0 when no due rules", async () => {
    vi.mocked(prisma.recurringFundingRule.findMany).mockResolvedValue([])
    const total = await processRecurringFundingRules("u1")
    expect(total).toBe(0)
  })
})

describe("processAllRecurringFundingRules", () => {
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

  it("aggregates legs across all due rules", async () => {
    const asOf = new Date(Date.UTC(2026, 5, 10, 12, 0, 0))
    vi.mocked(prisma.recurringFundingRule.findMany).mockResolvedValue([
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
      {
        id: "rule-2",
        userId: "u2",
        kind: "move_funds",
        frequency: "weekly",
        distributionConfig: {
          mode: "independent",
          entries: [{ envelopeId: "env-x", deltaUsd: 10 }],
        },
        nextRunAt: asOf,
      },
    ] as never)

    const result = await processAllRecurringFundingRules(asOf)
    expect(result.rulesProcessed).toBe(2)
    expect(result.legsCreated).toBe(4)
  })
})
