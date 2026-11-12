// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findMany: vi.fn() },
  },
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { GET } from "@/app/api/envelopes/route"

describe("GET /api/envelopes?usage=1", () => {
  const userId = "user_1"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
  })

  it("returns user-facing transaction counts and totals only", async () => {
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      {
        id: "env_1",
        name: "Groceries",
        monthlyAllotment: 400,
        color: "#10B981",
        icon: null,
        archived: false,
        systemRole: null,
        sweepPolicy: "reset",
        sweepCapMultiplier: null,
        createdAt: new Date("2026-05-31T00:00:00Z"),
        transactions: [
          { amount: 42.5 },
          { amount: 100 },
        ],
        _count: { recurringTransactions: 1 },
      },
    ] as never)

    const response = await GET(
      new NextRequest("http://localhost/api/envelopes?usage=1"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: "env_1",
        transactionCount: 2,
        transactionTotalAmount: 142.5,
        recurringCount: 1,
      }),
    ])

    expect(prisma.envelope.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, deletedAt: null },
        include: expect.objectContaining({
          transactions: {
            where: { excludeFromMainHistory: false },
            select: { amount: true },
          },
        }),
      }),
    )
  })

  it("omits soft-deleted envelopes from usage listing", async () => {
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([] as never)

    await GET(new NextRequest("http://localhost/api/envelopes?usage=1"))

    expect(prisma.envelope.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, deletedAt: null },
      }),
    )
  })
})
