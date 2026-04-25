import { describe, expect, it } from "vitest"
import {
  assertTagStringArray,
  isPositiveFiniteAmount,
  parseCalendarDateString,
  RECURRING_TXN_TYPES,
} from "@/lib/recurring-field-validation"

describe("recurring field validation", () => {
  it("RECURRING_TXN_TYPES matches transaction expense/credit", () => {
    expect(RECURRING_TXN_TYPES.has("expense")).toBe(true)
    expect(RECURRING_TXN_TYPES.has("credit")).toBe(true)
    expect(RECURRING_TXN_TYPES.has("income")).toBe(false)
  })

  it("isPositiveFiniteAmount rejects NaN, non-finite, and non-positive", () => {
    expect(isPositiveFiniteAmount(1)).toBe(true)
    expect(isPositiveFiniteAmount("2.5")).toBe(true)
    expect(isPositiveFiniteAmount(0)).toBe(false)
    expect(isPositiveFiniteAmount(-1)).toBe(false)
    expect(isPositiveFiniteAmount(NaN)).toBe(false)
    expect(isPositiveFiniteAmount("x")).toBe(false)
  })

  it("assertTagStringArray accepts only string arrays", () => {
    expect(assertTagStringArray(["a", "b"])).toBe(true)
    expect(assertTagStringArray([])).toBe(true)
    expect(assertTagStringArray(null)).toBe(false)
    expect(assertTagStringArray(["a", 1])).toBe(false)
  })

  it("parseCalendarDateString validates parseable dates", () => {
    expect(parseCalendarDateString("2026-04-20")?.getFullYear()).toBe(2026)
    expect(parseCalendarDateString("")).toBeNull()
    expect(parseCalendarDateString("not-a-date")).toBeNull()
  })
})
