import { describe, expect, it } from "vitest"
import {
  STRESS_DEFAULT,
  STRESS_MAX,
  STRESS_MIN,
  STRESS_MIN_POINTS,
  suggestStressFromPrices,
  suggestedStressPercent,
  type StressPricePoint,
} from "../runway-stress"

const DAY_MS = 24 * 60 * 60 * 1000

function isoDay(offsetDays: number, start = "2020-01-01"): string {
  const base = Date.parse(`${start}T00:00:00.000Z`)
  return new Date(base + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

/** Build `count` consecutive daily points; price(i) in USD. */
function dailySeries(count: number, price: (i: number) => number): StressPricePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    date: isoDay(i),
    priceUsd: price(i),
  }))
}

describe("suggestStressFromPrices — insufficient data", () => {
  it("returns the banded default for an empty series", () => {
    const s = suggestStressFromPrices([])
    expect(s.stressPercent).toBe(STRESS_DEFAULT)
    expect(s.maxDrawdown).toBeNull()
    expect(s.sufficient).toBe(false)
  })

  it("returns the default for a single point", () => {
    const s = suggestStressFromPrices([{ date: "2024-01-01", priceUsd: 50000 }])
    expect(s.sufficient).toBe(false)
    expect(s.stressPercent).toBe(STRESS_DEFAULT)
  })

  it("returns the default when there are too few in-window points", () => {
    // Long span but only 10 points.
    const sparse = Array.from({ length: 10 }, (_, i) => ({
      date: isoDay(i * 40),
      priceUsd: 100 - i,
    }))
    const s = suggestStressFromPrices(sparse)
    expect(s.pointsUsed).toBeLessThan(STRESS_MIN_POINTS)
    expect(s.sufficient).toBe(false)
    expect(s.stressPercent).toBe(STRESS_DEFAULT)
  })

  it("returns the default when the span is too short", () => {
    // 90 daily points (enough points) but only ~3 months of span.
    const s = suggestStressFromPrices(dailySeries(90, (i) => 100 - (i % 10)))
    expect(s.sufficient).toBe(false)
    expect(s.stressPercent).toBe(STRESS_DEFAULT)
  })
})

describe("suggestStressFromPrices — drawdown math", () => {
  it("uses the observed max peak-to-trough drawdown when in the sane band", () => {
    // Rises to a peak of 100 at day 100, craters to 40 at day 200 (60% drop),
    // then recovers. 400 daily points over >1 year.
    const prices = dailySeries(400, (i) => {
      if (i <= 100) return 50 + i * 0.5 // 50 → 100
      if (i <= 200) return 100 - (i - 100) * 0.6 // 100 → 40
      return 40 + (i - 200) * 0.2 // recover
    })
    const s = suggestStressFromPrices(prices)
    expect(s.sufficient).toBe(true)
    expect(s.maxDrawdown).toBeCloseTo(0.6, 5)
    expect(s.stressPercent).toBeCloseTo(0.6, 5)
  })

  it("clamps a tiny drawdown up to STRESS_MIN", () => {
    // Gentle wiggle: never more than ~3% off the peak.
    const prices = dailySeries(400, (i) => 100 - (i % 5))
    const s = suggestStressFromPrices(prices)
    expect(s.sufficient).toBe(true)
    expect(s.maxDrawdown! < STRESS_MIN).toBe(true)
    expect(s.stressPercent).toBe(STRESS_MIN)
  })

  it("clamps a catastrophic drawdown down to STRESS_MAX", () => {
    // Peak 100 at day 100, collapses to 5 (95% drop).
    const prices = dailySeries(400, (i) => {
      if (i <= 100) return 50 + i * 0.5
      if (i <= 200) return Math.max(5, 100 - (i - 100) * 0.95)
      return 5 + (i - 200) * 0.1
    })
    const s = suggestStressFromPrices(prices)
    expect(s.sufficient).toBe(true)
    expect(s.maxDrawdown! > STRESS_MAX).toBe(true)
    expect(s.stressPercent).toBe(STRESS_MAX)
  })
})

describe("suggestStressFromPrices — trailing window", () => {
  it("ignores an old deep crash outside the trailing window", () => {
    // Day 0..200: crash from 100 to 20 (80% drawdown).
    // Day 600..1000: mild ~10% wiggle around 100.
    const prices: StressPricePoint[] = [
      ...dailySeries(201, (i) => (i <= 100 ? 100 - i * 0.8 : 20 + (i - 100))),
      ...Array.from({ length: 400 }, (_, i) => ({
        date: isoDay(600 + i),
        priceUsd: 100 - (i % 11),
      })),
    ]
    // Window of 1 year ending at the last point excludes the old crash, so the
    // observed drawdown is small and clamps up to STRESS_MIN (not 0.80).
    const asOfMs = Date.parse(`${isoDay(999)}T00:00:00.000Z`)
    const s = suggestStressFromPrices(prices, { windowYears: 1, asOfMs })
    expect(s.sufficient).toBe(true)
    expect(s.stressPercent).toBe(STRESS_MIN)
    expect(s.stressPercent).not.toBe(STRESS_MAX)
  })
})

describe("suggestStressFromPrices — defensive input", () => {
  it("sorts unsorted input and filters non-finite / non-positive prices", () => {
    const base = dailySeries(400, (i) => {
      if (i <= 100) return 50 + i * 0.5
      if (i <= 200) return 100 - (i - 100) * 0.6
      return 40 + (i - 200) * 0.2
    })
    const shuffled = [...base].reverse()
    const polluted: StressPricePoint[] = [
      { date: "not-a-date", priceUsd: 999 },
      { date: isoDay(150), priceUsd: Number.NaN },
      { date: isoDay(150), priceUsd: 0 },
      { date: isoDay(150), priceUsd: -50 },
      ...shuffled,
    ]
    const clean = suggestStressFromPrices(base)
    const dirty = suggestStressFromPrices(polluted)
    expect(dirty.stressPercent).toBe(clean.stressPercent)
    expect(dirty.sufficient).toBe(true)
  })
})

describe("suggestedStressPercent convenience", () => {
  it("returns the default for null/empty history", () => {
    expect(suggestedStressPercent(null)).toBe(STRESS_DEFAULT)
    expect(suggestedStressPercent(undefined)).toBe(STRESS_DEFAULT)
    expect(suggestedStressPercent([])).toBe(STRESS_DEFAULT)
  })

  it("matches suggestStressFromPrices for real data", () => {
    const prices = dailySeries(400, (i) => {
      if (i <= 100) return 50 + i * 0.5
      if (i <= 200) return 100 - (i - 100) * 0.6
      return 40 + (i - 200) * 0.2
    })
    expect(suggestedStressPercent(prices)).toBe(
      suggestStressFromPrices(prices).stressPercent,
    )
  })
})
