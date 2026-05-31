import { describe, expect, it } from "vitest"
import {
  cadenceDisplayInteger,
  formatAllotmentInputDisplay,
  fromMonthly,
  monthlyFromDigitOnlyInput,
  monthlyFromMoneyInput,
  parsePartialMoneyInput,
  roundMoneyCents,
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

describe("parsePartialMoneyInput / monthlyFromMoneyInput", () => {
  it("returns null for empty or lone decimal while typing", () => {
    expect(parsePartialMoneyInput("")).toBeNull()
    expect(parsePartialMoneyInput(".")).toBeNull()
    expect(parsePartialMoneyInput("  ")).toBeNull()
  })

  it("parses partial amounts without forcing $5 snap (regression: typing 2 then 5)", () => {
    expect(parsePartialMoneyInput("2")).toBe(2)
    expect(parsePartialMoneyInput("25")).toBe(25)
    expect(parsePartialMoneyInput("25.5")).toBe(25.5)
    expect(parsePartialMoneyInput("25.50")).toBe(25.5)
  })

  it("commits penny amounts clamped to max", () => {
    expect(monthlyFromMoneyInput("123.45", 500)).toBe(123.45)
    expect(monthlyFromMoneyInput("999", 100)).toBe(100)
    expect(monthlyFromMoneyInput("", 100)).toBe(0)
  })

  it("rounds to cents on commit", () => {
    expect(roundMoneyCents(10.999)).toBe(11)
    expect(formatAllotmentInputDisplay(12.5)).toBe("12.50")
    expect(formatAllotmentInputDisplay(100)).toBe("100")
  })
})
