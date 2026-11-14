import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    xbtPriceCache: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import {
  calculateXbtOpportunityCost,
  getXbtPriceForDate,
  usdToXbtSats,
  xbtSatsPerDollar,
} from "@/lib/xbt-price"
import { XBT_MARKET_GENESIS } from "@/lib/xbt-price-neoxa"

const xbt = prisma.xbtPriceCache as unknown as {
  findMany: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
  findFirst: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
}

describe("getXbtPriceForDate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the exact cached day when present", async () => {
    xbt.findUnique.mockResolvedValue({ date: "2026-10-10", priceUsd: 855 })
    await expect(getXbtPriceForDate("2026-10-10")).resolves.toBe(855)
    expect(xbt.findFirst).not.toHaveBeenCalled()
  })

  it("falls back to the nearest earlier day", async () => {
    xbt.findUnique.mockResolvedValue(null)
    xbt.findFirst.mockResolvedValue({ date: "2026-10-09", priceUsd: 800 })
    await expect(getXbtPriceForDate("2026-10-10")).resolves.toBe(800)
  })

  it("returns null for pre-market dates with no earlier candle (no BTC substitute)", async () => {
    xbt.findUnique.mockResolvedValue(null)
    xbt.findFirst.mockResolvedValue(null)
    const before = "2020-01-01"
    expect(before < XBT_MARKET_GENESIS).toBe(true)
    await expect(getXbtPriceForDate(before)).resolves.toBeNull()
  })
})

describe("XBT opportunity-cost helpers", () => {
  it("mirrors BTC sats math at the XBT mark", () => {
    expect(calculateXbtOpportunityCost(100, 200, 400)).toBe(200)
    expect(calculateXbtOpportunityCost(100, 0, 400)).toBe(0)
    expect(xbtSatsPerDollar(200)).toBe(500_000)
    expect(usdToXbtSats(1, 200)).toBe(500_000)
  })
})
