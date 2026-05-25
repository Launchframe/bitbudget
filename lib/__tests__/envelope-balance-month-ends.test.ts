// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import { envelopeBalancesBeforeMonthEndsBatch } from "../envelope-balance-server"

describe("envelopeBalancesBeforeMonthEndsBatch", () => {
  beforeEach(() => {
    vi.mocked(prisma.transaction.findMany).mockReset()
  })

  it("snapshots end-of-month balances from a single transaction scan", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      {
        envelopeId: "e1",
        date: new Date(Date.UTC(2026, 0, 15)),
        type: "credit",
        amount: 400,
      },
      {
        envelopeId: "e1",
        date: new Date(Date.UTC(2026, 0, 20)),
        type: "expense",
        amount: 150,
      },
      {
        envelopeId: "e1",
        date: new Date(Date.UTC(2026, 1, 5)),
        type: "credit",
        amount: 400,
      },
    ] as never)

    const result = await envelopeBalancesBeforeMonthEndsBatch(
      "u1",
      ["e1"],
      ["2026-01", "2026-02"],
    )

    expect(prisma.transaction.findMany).toHaveBeenCalledTimes(1)
    expect(result.get("2026-01")?.get("e1")).toBe(250)
    expect(result.get("2026-02")?.get("e1")).toBe(650)
  })
})
