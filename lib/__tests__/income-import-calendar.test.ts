import { describe, expect, it } from "vitest"
import {
  buildCalendarYears,
  cellState,
  gradientIntensity,
  heatmapIntensity,
  maxStagedAmount,
  monthsInRangeChronological,
  p95MaxAmount,
  summarizeImportEntries,
} from "../income-import-calendar"

describe("income-import-calendar", () => {
  it("buildCalendarYears descends from current to floor", () => {
    expect(buildCalendarYears(2026, 2024)).toEqual([2026, 2025, 2024])
  })

  it("monthsInRangeChronological handles both directions", () => {
    expect(monthsInRangeChronological("2026-03", "2026-05")).toEqual(["2026-03", "2026-04", "2026-05"])
    expect(monthsInRangeChronological("2026-05", "2026-03")).toEqual(["2026-05", "2026-04", "2026-03"])
  })

  it("gradientIntensity caps at 1 using p95 max", () => {
    expect(gradientIntensity(100, 200)).toBe(0.5)
    expect(gradientIntensity(300, 200)).toBe(1)
  })

  it("cellState reflects tx0 and pre-history", () => {
    expect(cellState({ periodKey: "2022-05", tx0PeriodKey: "2022-06", amount: 0 })).toBe("preHistory")
    expect(cellState({ periodKey: "2022-06", tx0PeriodKey: "2022-06", amount: 0 })).toBe("tx0")
    expect(cellState({ periodKey: "2022-07", tx0PeriodKey: "2022-06", amount: 500 })).toBe("shaded")
  })

  it("cellState compares annual year keys against tx0 month", () => {
    expect(cellState({ periodKey: "2021", tx0PeriodKey: "2022-06", amount: 0 })).toBe("preHistory")
    expect(cellState({ periodKey: "2022", tx0PeriodKey: "2022-06", amount: 0 })).toBe("tx0")
    expect(cellState({ periodKey: "2023", tx0PeriodKey: "2022-06", amount: 500 })).toBe("shaded")
  })

  it("summarizeImportEntries totals pending and existing", () => {
    const map = new Map([["2026-01", 1000]])
    const summary = summarizeImportEntries([{ periodKey: "2026-01", amount: 1200 }], map)
    expect(summary.totalExisting).toBe(1000)
    expect(summary.totalPending).toBe(1200)
    expect(summary.rows[0]!.delta).toBe(200)
  })

  it("summarizeImportEntries sorts rows chronologically", () => {
    const summary = summarizeImportEntries(
      [
        { periodKey: "2025", amount: 5000 },
        { periodKey: "2024-06", amount: 1000 },
        { periodKey: "2024-01", amount: 800 },
      ],
      new Map(),
    )
    expect(summary.rows.map((r) => r.periodKey)).toEqual(["2024-01", "2024-06", "2025"])
  })

  it("p95MaxAmount clamps long tail", () => {
    const amounts = [100, 200, 300, 400, 10000]
    expect(p95MaxAmount(amounts)).toBe(400)
  })

  it("heatmapIntensity scales against the true max staged amount", () => {
    expect(heatmapIntensity(11500, 25500)).toBeCloseTo(11500 / 25500, 4)
    expect(heatmapIntensity(25500, 25500)).toBe(1)
    expect(heatmapIntensity(12750, 25500)).toBeCloseTo(0.5, 4)
  })

  it("maxStagedAmount returns highest positive value", () => {
    expect(maxStagedAmount([11500, 11500, 25500])).toBe(25500)
    expect(maxStagedAmount([])).toBe(0)
  })
})
