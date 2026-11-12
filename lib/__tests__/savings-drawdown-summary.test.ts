import { describe, expect, it } from "vitest"
import { savingsDrawRatioTitle } from "@/components/savings-drawdown-summary"

describe("savingsDrawRatioTitle", () => {
  it("describes no draw", () => {
    expect(savingsDrawRatioTitle(0, 150)).toMatch(/no draw/i)
  })

  it("warns when baseline is zero but draw is positive", () => {
    expect(savingsDrawRatioTitle(50, 0)).toMatch(/zero Savings balance/i)
  })

  it("uses low band under 25%", () => {
    expect(savingsDrawRatioTitle(24, 100)).toMatch(/under a quarter/i)
  })

  it("uses mid band between thresholds", () => {
    expect(savingsDrawRatioTitle(35, 100)).toMatch(/moderate share/i)
  })

  it("uses high band at or above 40%", () => {
    expect(savingsDrawRatioTitle(40, 100)).toMatch(/large share/i)
  })
})
