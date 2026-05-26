import { describe, expect, it } from "vitest"
import { buildWalkthroughSteps } from "@/lib/walkthrough-steps"

describe("buildWalkthroughSteps", () => {
  it("includes analytics step when opportunity cost is on", () => {
    const steps = buildWalkthroughSteps({
      opportunityCostEnabled: true,
      savingsEngaged: true,
      hasPremiumFeatures: false,
      pendingCount: 0,
    })
    expect(steps.some((s) => s.id === "analytics-header")).toBe(true)
  })

  it("omits analytics step in vanilla mode", () => {
    const steps = buildWalkthroughSteps({
      opportunityCostEnabled: false,
      savingsEngaged: true,
      hasPremiumFeatures: true,
      pendingCount: 2,
    })
    expect(steps.some((s) => s.id === "analytics-header")).toBe(false)
    expect(steps.some((s) => s.id === "setup-progress")).toBe(true)
  })
})
