import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn(),
  getCurrentBtcPrice: vi.fn(),
}))

vi.mock("@/lib/xbt-price", () => ({
  getXbtPriceForDate: vi.fn(),
  getCurrentXbtPrice: vi.fn(),
}))

import { getBtcPriceForDate, getCurrentBtcPrice } from "@/lib/btc-price"
import { getCurrentXbtPrice, getXbtPriceForDate } from "@/lib/xbt-price"
import {
  referencePriceForUser,
  referencePriceUsdForAsset,
} from "@/lib/reference-price"

describe("referencePriceUsdForAsset", () => {
  beforeEach(() => {
    vi.mocked(getBtcPriceForDate).mockReset()
    vi.mocked(getCurrentBtcPrice).mockReset()
    vi.mocked(getXbtPriceForDate).mockReset()
    vi.mocked(getCurrentXbtPrice).mockReset()
  })

  it("uses BTC cache for btc asset + date", async () => {
    vi.mocked(getBtcPriceForDate).mockResolvedValue(100_000)
    await expect(referencePriceUsdForAsset("btc", "2026-10-01")).resolves.toBe(100_000)
    expect(getBtcPriceForDate).toHaveBeenCalledWith("2026-10-01")
    expect(getXbtPriceForDate).not.toHaveBeenCalled()
  })

  it("uses XBT cache for xbt asset + date", async () => {
    vi.mocked(getXbtPriceForDate).mockResolvedValue(12.5)
    await expect(referencePriceUsdForAsset("xbt", "2026-10-01")).resolves.toBe(12.5)
    expect(getXbtPriceForDate).toHaveBeenCalledWith("2026-10-01")
    expect(getBtcPriceForDate).not.toHaveBeenCalled()
  })

  it("normalizes storage instants to calendar days before lookup", async () => {
    vi.mocked(getXbtPriceForDate).mockResolvedValue(9)
    await expect(
      referencePriceUsdForAsset("xbt", "2026-10-01T12:00:00.000Z"),
    ).resolves.toBe(9)
    expect(getXbtPriceForDate).toHaveBeenCalledWith("2026-10-01")
  })

  it("spot without date uses current helpers", async () => {
    vi.mocked(getCurrentBtcPrice).mockResolvedValue(99_000)
    vi.mocked(getCurrentXbtPrice).mockResolvedValue(11)
    await expect(referencePriceUsdForAsset("btc")).resolves.toBe(99_000)
    await expect(referencePriceUsdForAsset("xbt")).resolves.toBe(11)
  })

  it("treats non-positive spot as null", async () => {
    vi.mocked(getCurrentBtcPrice).mockResolvedValue(0)
    vi.mocked(getCurrentXbtPrice).mockResolvedValue(0)
    await expect(referencePriceUsdForAsset("btc")).resolves.toBeNull()
    await expect(referencePriceUsdForAsset("xbt")).resolves.toBeNull()
  })
})

describe("referencePriceForUser", () => {
  beforeEach(() => {
    vi.mocked(getBtcPriceForDate).mockReset()
    vi.mocked(getXbtPriceForDate).mockReset()
  })

  it("defaults unknown asset to BTC", async () => {
    vi.mocked(getBtcPriceForDate).mockResolvedValue(50_000)
    await expect(referencePriceForUser({}, "2026-09-15")).resolves.toBe(50_000)
    expect(getBtcPriceForDate).toHaveBeenCalled()
  })

  it("honors xbt on the user row", async () => {
    vi.mocked(getXbtPriceForDate).mockResolvedValue(null)
    await expect(
      referencePriceForUser({ referenceAsset: "xbt" }, "2026-08-01"),
    ).resolves.toBeNull()
    expect(getXbtPriceForDate).toHaveBeenCalledWith("2026-08-01")
    expect(getBtcPriceForDate).not.toHaveBeenCalled()
  })
})
