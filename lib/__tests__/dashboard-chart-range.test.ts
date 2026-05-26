import { describe, expect, it, vi, afterEach } from "vitest"
import {
  getDashboardChartRange,
  getStartDateForRange,
  setDashboardChartCustomRange,
  setDashboardChartPresetRange,
  transactionInDashboardChartRange,
} from "@/lib/dashboard-chart-range"

describe("dashboard-chart-range", () => {
  afterEach(() => {
    setDashboardChartPresetRange("12m")
  })

  it("getStartDateForRange returns expected anchors", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-26T15:00:00Z"))
    expect(getStartDateForRange("mtd")).toBe("2026-05-01")
    expect(getStartDateForRange("ytd")).toBe("2026-01-01")
    expect(getStartDateForRange("all")).toBe("2009-01-03")
    vi.useRealTimers()
  })

  it("setDashboardChartPresetRange updates active preset and end date to today", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-26T15:00:00Z"))
    setDashboardChartPresetRange("3m")
    const range = getDashboardChartRange()
    expect(range.activeRange).toBe("3m")
    expect(range.endDate).toBe("2026-05-26")
    expect(range.startDate).toBe(getStartDateForRange("3m"))
    vi.useRealTimers()
  })

  it("setDashboardChartCustomRange normalizes inverted bounds", () => {
    setDashboardChartCustomRange("2026-04-10", "2026-03-01")
    const range = getDashboardChartRange()
    expect(range.activeRange).toBe("custom")
    expect(range.startDate).toBe("2026-03-01")
    expect(range.endDate).toBe("2026-04-10")
  })

  it("transactionInDashboardChartRange is inclusive on both ends", () => {
    const range = { startDate: "2026-03-01", endDate: "2026-03-31" }
    expect(transactionInDashboardChartRange("2026-03-01T08:00:00Z", range)).toBe(true)
    expect(transactionInDashboardChartRange("2026-03-31", range)).toBe(true)
    expect(transactionInDashboardChartRange("2026-02-28", range)).toBe(false)
    expect(transactionInDashboardChartRange("2026-04-01", range)).toBe(false)
  })
})
