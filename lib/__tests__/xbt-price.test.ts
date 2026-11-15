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

  it("returns null for post-genesis historical days before the first candle (no spot fill)", async () => {
    xbt.findUnique.mockResolvedValue(null)
    xbt.findFirst.mockResolvedValue(null)
    // After market genesis but before any cached candle — must not use today's spot.
    const afterGenesis = "2026-09-02"
    expect(afterGenesis >= XBT_MARKET_GENESIS).toBe(true)
    const todayUtc = new Date().toISOString().slice(0, 10)
    expect(afterGenesis).not.toBe(todayUtc)
    await expect(getXbtPriceForDate(afterGenesis)).resolves.toBeNull()
  })

  it("allows spot only for today UTC when the cache is empty", async () => {
    const todayUtc = new Date().toISOString().slice(0, 10)
    xbt.findUnique.mockResolvedValue(null)
    xbt.findFirst.mockResolvedValue(null)
    xbt.upsert.mockResolvedValue({ date: todayUtc, priceUsd: 42, fetchedAt: new Date() })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, ticker: { lastPrice: 42 } }),
    } as Response)

    await expect(getXbtPriceForDate(todayUtc)).resolves.toBe(42)
    fetchSpy.mockRestore()
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
