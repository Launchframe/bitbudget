// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/db", () => ({
  prisma: {
    savingsGoal: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    envelope: {
      findFirst: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/envelope-funding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/envelope-funding")>()
  return {
    ...actual,
    ensureSystemSavingsEnvelope: vi.fn().mockResolvedValue({ id: "sav-1" }),
  }
})

vi.mock("@/lib/savings-goal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../savings-goal")>()
  return {
    ...actual,
    resolveSavingsGoalTarget: vi.fn(),
  }
})

import { prisma } from "@/lib/db"
import { resolveSavingsGoalTarget } from "@/lib/savings-goal"
import {
  closePreviousPeriodGoal,
  computeCloseSnapshots,
  openCurrentPeriodGoal,
  previousMonthKey,
} from "../savings-goal-cron"

describe("savings-goal-cron helpers", () => {
  it("previousMonthKey rolls calendar months", () => {
    expect(previousMonthKey("2026-05")).toBe("2026-04")
    expect(previousMonthKey("2026-01")).toBe("2025-12")
  })

  it("computeCloseSnapshots separates balance growth from inflow", () => {
    const out = computeCloseSnapshots({
      startBalance: 1000,
      endBalance: 1200,
      netSavingsInflow: 500,
      targetAmount: 150,
    })
    expect(out.actualSavedAmount).toBe(200)
    expect(out.netSavingsInflow).toBe(500)
    expect(out.achievedGoal).toBe(true)
    expect(out.progressPct).toBeCloseTo(200 / 150, 4)
  })

  it("computeCloseSnapshots handles manual withdrawal lowering actualSaved vs inflow", () => {
    const out = computeCloseSnapshots({
      startBalance: 1000,
      endBalance: 900,
      netSavingsInflow: 400,
      targetAmount: 200,
    })
    expect(out.actualSavedAmount).toBe(-100)
    expect(out.netSavingsInflow).toBe(400)
    expect(out.achievedGoal).toBe(false)
  })
})

describe("closePreviousPeriodGoal", () => {
  beforeEach(() => {
    vi.mocked(prisma.savingsGoal.findUnique).mockReset()
    vi.mocked(prisma.savingsGoal.update).mockReset()
    vi.mocked(prisma.transaction.findMany).mockReset()
  })

  it("closes prior month with snapshot fields", async () => {
    vi.mocked(prisma.savingsGoal.findUnique).mockResolvedValue({
      id: "g1",
      userId: "u1",
      periodKey: "2026-04",
      targetAmount: new Prisma.Decimal(200),
      startBalance: new Prisma.Decimal(1000),
      closedAt: null,
    } as never)

    vi.mocked(prisma.transaction.findMany).mockImplementation(async (args) => {
      const where = args?.where as {
        type?: string
        date?: { lt?: Date; gte?: Date }
      }
      if (where.date && "lt" in where.date && !("gte" in where.date)) {
        return [{ amount: 1200, type: "credit" }] as never
      }
      if (where.date && "gte" in where.date) {
        if (where.type === "credit") return [{ amount: 500 }] as never
        return [{ amount: 100 }] as never
      }
      return [
        { amount: 1200, type: "credit" },
        { amount: 0, type: "expense" },
      ] as never
    })

    const closed = await closePreviousPeriodGoal("u1", new Date(Date.UTC(2026, 4, 1)))
    expect(closed).toBe(true)
    expect(prisma.savingsGoal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1" },
        data: expect.objectContaining({
          achievedGoal: true,
          actualSavedAmount: expect.any(Prisma.Decimal),
          netSavingsInflow: expect.any(Prisma.Decimal),
        }),
      }),
    )
  })

  it("no-ops when prior row already closed", async () => {
    vi.mocked(prisma.savingsGoal.findUnique).mockResolvedValue({
      id: "g1",
      closedAt: new Date(),
      startBalance: new Prisma.Decimal(1),
    } as never)
    expect(await closePreviousPeriodGoal("u1", new Date(Date.UTC(2026, 4, 1)))).toBe(false)
    expect(prisma.savingsGoal.update).not.toHaveBeenCalled()
  })
})

describe("openCurrentPeriodGoal", () => {
  beforeEach(() => {
    vi.mocked(prisma.savingsGoal.findUnique).mockReset()
    vi.mocked(prisma.savingsGoal.create).mockReset()
    vi.mocked(prisma.savingsGoal.update).mockReset()
    vi.mocked(prisma.user.findUnique).mockReset()
    vi.mocked(prisma.envelope.findFirst).mockReset()
    vi.mocked(prisma.transaction.findMany).mockReset()
    vi.mocked(resolveSavingsGoalTarget).mockReset()
  })

  it("is idempotent when startBalance already set", async () => {
    vi.mocked(prisma.savingsGoal.findUnique).mockResolvedValue({
      periodKey: "2026-05",
      startBalance: new Prisma.Decimal(500),
    } as never)
    expect(await openCurrentPeriodGoal("u1", new Date(Date.UTC(2026, 4, 10)))).toBe(false)
    expect(prisma.savingsGoal.create).not.toHaveBeenCalled()
  })

  it("creates row using default cascade target", async () => {
    vi.mocked(prisma.savingsGoal.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ createdAt: new Date(Date.UTC(2026, 4, 1)) } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({ id: "sav-1" } as never)
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ amount: 800, type: "credit" }] as never)
    vi.mocked(resolveSavingsGoalTarget).mockResolvedValue(250)

    const opened = await openCurrentPeriodGoal("u1", new Date(Date.UTC(2026, 4, 3)))
    expect(opened).toBe(true)
    expect(prisma.savingsGoal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          periodKey: "2026-05",
          targetAmount: expect.any(Prisma.Decimal),
          startBalance: expect.any(Prisma.Decimal),
          graceEndsAt: expect.any(Date),
        }),
      }),
    )
  })

  it("preserves explicit override target when finalizing pre-created row", async () => {
    vi.mocked(prisma.savingsGoal.findUnique).mockResolvedValue({
      id: "g-new",
      targetAmount: new Prisma.Decimal(400),
      startBalance: null,
    } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ createdAt: new Date(Date.UTC(2026, 4, 1)) } as never)
    vi.mocked(prisma.envelope.findFirst).mockResolvedValue({ id: "sav-1" } as never)
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never)

    expect(await openCurrentPeriodGoal("u1", new Date(Date.UTC(2026, 4, 3)))).toBe(true)
    expect(resolveSavingsGoalTarget).not.toHaveBeenCalled()
    expect(prisma.savingsGoal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetAmount: expect.any(Prisma.Decimal),
        }),
      }),
    )
  })
})
