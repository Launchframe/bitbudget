// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@/lib/db", () => ({
  prisma: {
    userAchievement: {
      create: vi.fn(),
    },
    savingsGoal: {
      findMany: vi.fn(),
    },
    envelope: {
      findMany: vi.fn(),
    },
    transaction: {
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/envelope-balance-server", () => ({
  savingsEnvelopeBalanceAllTime: vi.fn().mockResolvedValue(0),
  envelopeBalancesBeforeBatch: vi.fn().mockResolvedValue(new Map()),
  periodBoundsUtc: (periodKey: string) => {
    if (!/^\d{4}-\d{2}$/.test(periodKey)) return null
    const [y, m] = periodKey.split("-").map(Number)
    return {
      start: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
    }
  },
}))

vi.mock("@/lib/envelope-funding", () => ({
  ensureSystemSavingsEnvelope: vi.fn().mockResolvedValue({ id: "sav-1" }),
  TX_SOURCE_IRREGULAR_INCOME: "irregular_income",
}))

import { prisma } from "@/lib/db"
import { savingsEnvelopeBalanceAllTime, envelopeBalancesBeforeBatch } from "@/lib/envelope-balance-server"
import {
  awardIfMissing,
  computeGoalStreakFromClosed,
  detectAchievementsForUser,
} from "../achievements"

describe("achievements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("awardIfMissing returns true on create and false on duplicate", async () => {
    vi.mocked(prisma.userAchievement.create).mockResolvedValueOnce({
      id: "a1",
      userId: "u1",
      code: "first_dollar",
      earnedAt: new Date(),
      metadata: null,
    })
    expect(await awardIfMissing("u1", "first_dollar")).toBe(true)

    const dup = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
    })
    vi.mocked(prisma.userAchievement.create).mockRejectedValueOnce(dup)
    expect(await awardIfMissing("u1", "first_dollar")).toBe(false)
  })

  it("computeGoalStreakFromClosed counts consecutive achieved months", () => {
    expect(
      computeGoalStreakFromClosed([
        { periodKey: "2026-03", achievedGoal: true },
        { periodKey: "2026-02", achievedGoal: true },
        { periodKey: "2026-01", achievedGoal: false },
      ]),
    ).toBe(2)
  })

  it("detectAchievementsForUser awards balance thresholds", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      createdAt: new Date("2020-01-01"),
    } as never)
    vi.mocked(savingsEnvelopeBalanceAllTime).mockResolvedValue(1500)
    vi.mocked(prisma.savingsGoal.findMany).mockResolvedValue([])
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([])
    vi.mocked(prisma.transaction.count).mockResolvedValue(0)
    vi.mocked(prisma.userAchievement.create).mockResolvedValue({
      id: "x",
      userId: "u1",
      code: "x",
      earnedAt: new Date(),
      metadata: null,
    })

    const count = await detectAchievementsForUser("u1", new Date("2026-05-01"))
    expect(count).toBeGreaterThan(0)
    expect(prisma.userAchievement.create).toHaveBeenCalled()
  })

  it("detectAchievementsForUser awards streak achievements from closed goals", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      createdAt: new Date("2026-01-01"),
    } as never)
    vi.mocked(savingsEnvelopeBalanceAllTime).mockResolvedValue(0)
    vi.mocked(prisma.savingsGoal.findMany).mockResolvedValue([
      { periodKey: "2026-03", achievedGoal: true, progressPct: new Prisma.Decimal(1), closedAt: new Date() },
      { periodKey: "2026-02", achievedGoal: true, progressPct: new Prisma.Decimal(1), closedAt: new Date() },
      { periodKey: "2026-01", achievedGoal: true, progressPct: new Prisma.Decimal(1), closedAt: new Date() },
    ] as never)
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([{ id: "e1", systemRole: null }] as never)
    vi.mocked(prisma.transaction.count).mockResolvedValue(0)
    vi.mocked(prisma.userAchievement.create).mockResolvedValue({
      id: "x",
      userId: "u1",
      code: "streak_3",
      earnedAt: new Date(),
      metadata: null,
    })

    await detectAchievementsForUser("u1", new Date("2026-04-01"))
    const codes = vi.mocked(prisma.userAchievement.create).mock.calls.map((c) => c[0]?.data.code)
    expect(codes).toContain("streak_3")
    expect(codes).toContain("goal_hit")
  })

  it("swept_clean_month uses end-of-period balances, not month net activity", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      createdAt: new Date("2026-01-01"),
    } as never)
    vi.mocked(savingsEnvelopeBalanceAllTime).mockResolvedValue(0)
    vi.mocked(prisma.savingsGoal.findMany).mockResolvedValue([
      {
        periodKey: "2026-02",
        achievedGoal: false,
        progressPct: new Prisma.Decimal(0.5),
        closedAt: new Date(),
      },
    ] as never)
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([{ id: "e1", systemRole: null }] as never)
    vi.mocked(prisma.transaction.count).mockResolvedValue(0)
    vi.mocked(envelopeBalancesBeforeBatch).mockResolvedValue(new Map([["e1", 0]]))
    vi.mocked(prisma.userAchievement.create).mockResolvedValue({
      id: "x",
      userId: "u1",
      code: "swept_clean_month",
      earnedAt: new Date(),
      metadata: null,
    })

    await detectAchievementsForUser("u1", new Date("2026-03-01"))
    expect(envelopeBalancesBeforeBatch).toHaveBeenCalledWith(
      "u1",
      ["e1"],
      new Date(Date.UTC(2026, 2, 1, 0, 0, 0, 0)),
    )
    const codes = vi.mocked(prisma.userAchievement.create).mock.calls.map((c) => c[0]?.data.code)
    expect(codes).toContain("swept_clean_month")
  })
})
