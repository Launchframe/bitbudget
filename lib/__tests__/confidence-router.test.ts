// @vitest-environment node
import { describe, it, expect } from "vitest"
import { routeByConfidence } from "../confidence-router"

describe("routeByConfidence", () => {
  it("routes high confidence to live transaction", () => {
    expect(routeByConfidence(0.85)).toBe("live")
  })

  it("routes low confidence to pending", () => {
    expect(routeByConfidence(0.5)).toBe("pending")
  })

  it("routes very low confidence to pending", () => {
    expect(routeByConfidence(0.2)).toBe("pending")
  })

  it("treats threshold (0.75) as high confidence", () => {
    expect(routeByConfidence(0.75)).toBe("live")
  })

  it("treats just below threshold as pending", () => {
    expect(routeByConfidence(0.749)).toBe("pending")
  })
})
