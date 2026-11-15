import { describe, expect, it } from "vitest"
import { priceOnDateFromHistory } from "@/lib/reference-price-lookup"

const history = [
  { date: "2026-09-01", price: 10 },
  { date: "2026-09-02", price: 12 },
  { date: "2026-09-05", price: 15 },
]
const map = Object.fromEntries(history.map((p) => [p.date, p.price]))

describe("priceOnDateFromHistory", () => {
  it("returns exact day when present", () => {
    expect(
      priceOnDateFromHistory("2026-09-02", map, history, 20, { allowBeforeFirst: false }),
    ).toBe(12)
  })

  it("uses nearest earlier close for gaps mid-series", () => {
    expect(
      priceOnDateFromHistory("2026-09-04", map, history, 20, { allowBeforeFirst: false }),
    ).toBe(12)
  })

  it("XBT: blank before first candle", () => {
    expect(
      priceOnDateFromHistory("2026-08-15", map, history, 20, { allowBeforeFirst: false }),
    ).toBe(0)
  })

  it("BTC: earliest close for dates before history", () => {
    expect(
      priceOnDateFromHistory("2026-08-15", map, history, 20, { allowBeforeFirst: true }),
    ).toBe(10)
  })

  it("empty history falls back to currentPrice", () => {
    expect(priceOnDateFromHistory("2026-09-01", {}, [], 42, { allowBeforeFirst: false })).toBe(42)
    expect(priceOnDateFromHistory("2026-09-01", {}, [], null, { allowBeforeFirst: false })).toBe(0)
  })
})
