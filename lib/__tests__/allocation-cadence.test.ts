import { describe, expect, it } from "vitest"
import {
  cadenceDisplayInteger,
  fromMonthly,
  monthlyFromDigitOnlyInput,
  toMonthly,
} from "../allocation-cadence"

describe("monthlyFromDigitOnlyInput", () => {
  it("returns 0 for empty or non-digit input", () => {
    expect(monthlyFromDigitOnlyInput("", "monthly", 5000)).toBe(0)
    expect(monthlyFromDigitOnlyInput("   ", "monthly", 5000)).toBe(0)
    expect(monthlyFromDigitOnlyInput("abc", "monthly", 5000)).toBe(0)
  })

  it("allows small positive amounts without $50 snap (regression: typing 5 was forced to 0)", () => {
    expect(monthlyFromDigitOnlyInput("5", "monthly", 5000)).toBe(5)
    expect(monthlyFromDigitOnlyInput("25", "monthly", 5000)).toBe(25)
    expect(monthlyFromDigitOnlyInput("100", "monthly", 5000)).toBe(100)
  })

  it("strips non-digits and keeps leading digit run", () => {
    expect(monthlyFromDigitOnlyInput("12x3", "monthly", 5000)).toBe(123)
  })

  it("clamps to max monthly implied by sliderMax", () => {
    expect(monthlyFromDigitOnlyInput("99999", "monthly", 100)).toBe(100)
  })
})

describe("toMonthly / fromMonthly", () => {
  it("round-trips display for monthly", () => {
    expect(fromMonthly(500, "monthly")).toBe(500)
    expect(toMonthly(500, "monthly")).toBe(500)
  })
})

describe("cadenceDisplayInteger", () => {
  it("returns empty string for zero monthly", () => {
    expect(cadenceDisplayInteger(0, "monthly")).toBe("")
  })

  it("shows rounded cadence amount", () => {
    expect(cadenceDisplayInteger(500, "monthly")).toBe("500")
  })
})
