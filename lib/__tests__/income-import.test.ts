// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  currentMonthKeyUtc,
  distributeImportDates,
  importBatchPeriodKey,
  isPeriodCurrentOrFuture,
  parseIncomePeriodKey,
  resolveImportPayDay,
  splitAmountAcrossChecks,
} from "../income-import"

describe("income-import helpers", () => {
  it("parseIncomePeriodKey accepts YYYY-MM and YYYY", () => {
    expect(parseIncomePeriodKey("2026-05")).toEqual({
      kind: "month",
      year: 2026,
      month: 5,
      periodKey: "2026-05",
    })
    expect(parseIncomePeriodKey("2025")).toEqual({
      kind: "year",
      year: 2025,
      periodKey: "2025",
    })
    expect(parseIncomePeriodKey("2026-13")).toBeNull()
  })

  it("isPeriodCurrentOrFuture distinguishes past vs current/future", () => {
    const now = new Date("2026-05-15T12:00:00.000Z")
    expect(isPeriodCurrentOrFuture("2026-04", now)).toBe(false)
    expect(isPeriodCurrentOrFuture("2026-05", now)).toBe(true)
    expect(isPeriodCurrentOrFuture("2026-06", now)).toBe(true)
    expect(isPeriodCurrentOrFuture("2025", now)).toBe(false)
    expect(isPeriodCurrentOrFuture("2026", now)).toBe(true)
  })

  it("importBatchPeriodKey is stable for idempotency", () => {
    expect(importBatchPeriodKey("user-1", "2026-05", 1200)).toBe("import-user-1-2026-05-120000")
    expect(importBatchPeriodKey("user-1", "2026-05", 1200.005)).toBe("import-user-1-2026-05-120001")
  })

  it("resolveImportPayDay prefers payDays then defaults to 15", () => {
    expect(resolveImportPayDay([1, 15])).toBe(1)
    expect(resolveImportPayDay([])).toBe(15)
  })

  it("splitAmountAcrossChecks sums to gross", () => {
    expect(splitAmountAcrossChecks(100, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2)
    expect(splitAmountAcrossChecks(100.01, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(100.01, 2)
  })

  it("distributeImportDates returns dates inside the period", () => {
    const dates = distributeImportDates({ periodKey: "2026-05", payDay: 15, splitCount: 2 })
    expect(dates.length).toBe(2)
    for (const d of dates) {
      expect(d.startsWith("2026-05")).toBe(true)
    }
  })

  it("currentMonthKeyUtc matches UTC month", () => {
    expect(currentMonthKeyUtc(new Date("2026-05-23T00:00:00.000Z"))).toBe("2026-05")
  })
})
