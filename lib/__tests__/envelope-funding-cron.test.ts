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

  it("runs both sweep+alloc AND paycheck when payday falls on the 1st", async () => {
    // bimonthly user with 1st as a payday
    const firstAndPayday = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    expect(isBudgetAllocationDay(firstAndPayday)).toBe(true)

    const result = await processFundingCronUser(
      {
        id: "u2",
        payCadence: "bimonthly",
        payDays: [1, 15],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
      firstAndPayday,
      true,
    )

    expect(sweepDiscretionaryEnvelopesForUser).toHaveBeenCalledWith("u2", firstAndPayday)
    expect(processMonthlyBudgetAllocations).toHaveBeenCalledWith("u2", firstAndPayday)
    expect(creditPaycheckToSavings).toHaveBeenCalledWith("u2", firstAndPayday)
    expect(result.sweepTransactionsCreated).toBe(2)
    expect(result.allocationLegsCreated).toBe(4)
    expect(result.paycheckCreditsCreated).toBe(1)
    // fundTransactionsCreated is deprecated sum of paycheck + alloc
    expect(result.fundTransactionsCreated).toBe(5)
  })

  it("runs nothing when neither payday nor 1st", async () => {
    const midMonth = new Date(Date.UTC(2026, 4, 16, 12, 0, 0))

    const result = await processFundingCronUser(
      {
        id: "u1",
        payCadence: "monthly",
        payDays: [15],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
      midMonth,
      false,
    )

    expect(sweepDiscretionaryEnvelopesForUser).not.toHaveBeenCalled()
    expect(processMonthlyBudgetAllocations).not.toHaveBeenCalled()
    expect(creditPaycheckToSavings).not.toHaveBeenCalled()
    expect(result.sweepTransactionsCreated).toBe(0)
    expect(result.paycheckCreditsCreated).toBe(0)
    expect(result.allocationLegsCreated).toBe(0)
  })
})
