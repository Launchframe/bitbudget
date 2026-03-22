import { describe, expect, it } from "vitest"
import {
  daysBetweenIsoInclusiveRange,
  formatExpenseChartXAxisTick,
  parseIsoDateLocal,
} from "../chart-x-axis-format"

describe("parseIsoDateLocal", () => {
  it("parses calendar date at local noon", () => {
    const d = parseIsoDateLocal("2026-03-12")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(12)
  })
})

describe("daysBetweenIsoInclusiveRange", () => {
  it("returns whole-day difference", () => {
    expect(daysBetweenIsoInclusiveRange("2025-10-05", "2025-10-06")).toBe(1)
    expect(daysBetweenIsoInclusiveRange("2025-10-05", "2025-10-05")).toBe(0)
  })
})

describe("formatExpenseChartXAxisTick", () => {
  it("uses month+day for 12m preset", () => {
    const s = formatExpenseChartXAxisTick("2026-03-12", {
      activeRange: "12m",
      dataFirstIso: "2025-12-01",
      dataLastIso: "2026-03-12",
    })
    expect(s).toMatch(/Mar/)
    expect(s).toMatch(/12/)
  })

  it("uses month+day+2-digit year when tick year differs from last data year", () => {
    const s = formatExpenseChartXAxisTick("2025-12-27", {
      activeRange: "3m",
      dataFirstIso: "2025-12-01",
      dataLastIso: "2026-03-15",
    })
    expect(s).toMatch(/Dec/)
    expect(s).toMatch(/27/)
    expect(s).toMatch(/25|2025/)
  })

  it("uses month+day for 5y when span is short (imported history)", () => {
    const s = formatExpenseChartXAxisTick("2025-11-15", {
      activeRange: "5y",
      dataFirstIso: "2025-10-01",
      dataLastIso: "2026-03-01",
    })
    expect(s).toMatch(/Nov/)
    expect(s).toMatch(/15/)
  })

  it("uses month+year for 5y when span exceeds 800 days", () => {
    const s = formatExpenseChartXAxisTick("2022-06-15", {
      activeRange: "5y",
      dataFirstIso: "2020-01-01",
      dataLastIso: "2024-12-31",
    })
    expect(s).toMatch(/Jun/)
    expect(s).toMatch(/22/)
  })
})
