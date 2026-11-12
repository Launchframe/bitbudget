import { describe, expect, it } from "vitest"
import { buildSavingsGoalsWalkthroughSlides } from "@/lib/savings-goals-walkthrough-slides"
import { SAVINGS_GOAL_GRACE_DAYS } from "@/lib/savings-goal"

describe("buildSavingsGoalsWalkthroughSlides", () => {
  it("returns 6 slides ending with the ready CTA", () => {
    const slides = buildSavingsGoalsWalkthroughSlides()
    expect(slides).toHaveLength(6)
    expect(slides[5]?.id).toBe("ready")
    expect(slides[5]?.title).toMatch(/ready to start saving/i)
  })

  it("mentions grace days on the first-week slide", () => {
    const slide = buildSavingsGoalsWalkthroughSlides().find((s) => s.id === "first-week")
    expect(slide?.body).toContain(String(SAVINGS_GOAL_GRACE_DAYS))
  })
})
