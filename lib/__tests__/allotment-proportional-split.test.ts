import { describe, expect, it } from "vitest"
import { splitUsdProportionalByAllotment } from "@/lib/allotment-proportional-split"

describe("splitUsdProportionalByAllotment", () => {
  it("splits pool across positive allotments with exact sum", () => {
    const m = splitUsdProportionalByAllotment(100, [
      { id: "a", monthlyAllotment: 60 },
      { id: "b", monthlyAllotment: 40 },
    ])
    let s = 0
    for (const v of m.values()) s += v
    expect(Math.round(s * 100) / 100).toBe(100)
    expect(m.get("a")).toBeCloseTo(60, 5)
    expect(m.get("b")).toBeCloseTo(40, 5)
  })

  it("ignores zero-allotment envelopes", () => {
    const m = splitUsdProportionalByAllotment(10, [
      { id: "a", monthlyAllotment: 0 },
      { id: "b", monthlyAllotment: 100 },
    ])
    expect(m.size).toBe(1)
    expect(m.get("b")).toBe(10)
  })
})
