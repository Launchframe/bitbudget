// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { isBudgetAllocationDay } from "../budget-period"

vi.mock("@/lib/achievements", () => ({
  detectAchievementsForUser: vi.fn(async () => 0),
}))

vi.mock("@/lib/savings-goal-cron", () => ({
  closePreviousPeriodGoal: vi.fn(async () => false),
  openCurrentPeriodGoal: vi.fn(async () => false),
}))

vi.mock("@/lib/envelope-sweep", () => ({
  sweepDiscretionaryEnvelopesForUser: vi.fn(async () => 2),
}))

vi.mock("@/lib/envelope-funding", () => ({
  creditPaycheckToSavings: vi.fn(async () => 1),
  processMonthlyBudgetAllocations: vi.fn(async () => 4),
}))

import { sweepDiscretionaryEnvelopesForUser } from "@/lib/envelope-sweep"
import { creditPaycheckToSavings, processMonthlyBudgetAllocations } from "@/lib/envelope-funding"
import { processFundingCronUser } from "@/lib/envelope-funding-cron"

describe("envelope-funding-cron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("runs sweep and alloc on UTC 1st without requiring payday", async () => {
    const first = new Date(Date.UTC(2026, 4, 1, 12, 0, 0))
    expect(isBudgetAllocationDay(first)).toBe(true)

    const result = await processFundingCronUser(
      {
        id: "u1",
        payCadence: "monthly",
        payDays: [15],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
      first,
      true,
    )

    expect(sweepDiscretionaryEnvelopesForUser).toHaveBeenCalledWith("u1", first)
    expect(processMonthlyBudgetAllocations).toHaveBeenCalledWith("u1", first)
    expect(creditPaycheckToSavings).not.toHaveBeenCalled()
    expect(result.sweepTransactionsCreated).toBe(2)
    expect(result.allocationLegsCreated).toBe(4)
  })

  it("runs paycheck credit on payday but not sweep when not the 1st", async () => {
    const payday = new Date(Date.UTC(2026, 4, 15, 12, 0, 0))

    const result = await processFundingCronUser(
      {
        id: "u1",
        payCadence: "monthly",
        payDays: [15],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
      payday,
      false,
    )

    expect(creditPaycheckToSavings).toHaveBeenCalledWith("u1", payday)
    expect(sweepDiscretionaryEnvelopesForUser).not.toHaveBeenCalled()
    expect(processMonthlyBudgetAllocations).not.toHaveBeenCalled()
    expect(result.paycheckCreditsCreated).toBe(1)
  })
})
