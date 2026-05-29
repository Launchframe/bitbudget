import { describe, expect, it } from "vitest"
import { buildWalkthroughSteps, type WalkthroughContext } from "@/lib/walkthrough-steps"

const baseCtx: WalkthroughContext = {
  opportunityCostEnabled: false,
  savingsEngaged: true,
  hasPremiumFeatures: false,
  pendingCount: 0,
  isMobile: false,
}

describe("buildWalkthroughSteps", () => {
  it("includes analytics step when opportunity cost is on", () => {
    const steps = buildWalkthroughSteps({ ...baseCtx, opportunityCostEnabled: true })
    expect(steps.some((s) => s.id === "analytics-header")).toBe(true)
  })

  it("omits analytics step in vanilla mode", () => {
    const steps = buildWalkthroughSteps({ ...baseCtx, hasPremiumFeatures: true, pendingCount: 2 })
    expect(steps.some((s) => s.id === "analytics-header")).toBe(false)
    expect(steps.some((s) => s.id === "setup-progress")).toBe(true)
  })

  it("includes scan-receipt on desktop and omits mobile-only steps", () => {
    const steps = buildWalkthroughSteps({ ...baseCtx, isMobile: false })
    expect(steps.some((s) => s.id === "scan-receipt")).toBe(true)
    expect(steps.some((s) => s.id === "transaction-mode-intro")).toBe(false)
    expect(steps.some((s) => s.id === "capture-modes")).toBe(false)
  })

  it("includes mobile-only steps on mobile and omits scan-receipt", () => {
    const steps = buildWalkthroughSteps({ ...baseCtx, isMobile: true })
    expect(steps.some((s) => s.id === "scan-receipt")).toBe(false)
    expect(steps.some((s) => s.id === "transaction-mode-intro")).toBe(true)
    expect(steps.some((s) => s.id === "capture-modes")).toBe(true)
  })

  it("includes new-transaction-dialog step on both platforms", () => {
    const desktopSteps = buildWalkthroughSteps({ ...baseCtx, isMobile: false })
    const mobileSteps = buildWalkthroughSteps({ ...baseCtx, isMobile: true })
    expect(desktopSteps.some((s) => s.id === "new-transaction-dialog")).toBe(true)
    expect(mobileSteps.some((s) => s.id === "new-transaction-dialog")).toBe(true)
  })

  it("new-transaction step has spotlight config", () => {
    const steps = buildWalkthroughSteps(baseCtx)
    const step = steps.find((s) => s.id === "new-transaction")
    expect(step?.spotlight).toBeDefined()
    expect(step?.spotlight?.action).toBe("open-new-transaction")
  })

  it("app-nav step uses platform-aware wording", () => {
    const desktopSteps = buildWalkthroughSteps({ ...baseCtx, isMobile: false })
    const mobileSteps = buildWalkthroughSteps({ ...baseCtx, isMobile: true })
    const desktopStep = desktopSteps.find((s) => s.id === "app-nav")
    const mobileStep = mobileSteps.find((s) => s.id === "app-nav")
    expect(desktopStep?.description).toContain("left")
    expect(mobileStep?.description).toContain("bottom")
  })

  it("capture-modes step has awaitClose and closeOnAdvance", () => {
    const steps = buildWalkthroughSteps({ ...baseCtx, isMobile: true })
    const step = steps.find((s) => s.id === "capture-modes")
    expect(step?.awaitClose).toBe("input-mode-sheet")
    expect(step?.closeOnAdvance).toBe("input-mode-sheet")
  })

  it("keeps connection and pending review copy readable", () => {
    const premiumSteps = buildWalkthroughSteps({ ...baseCtx, hasPremiumFeatures: true })
    const connections = premiumSteps.find((s) => s.id === "settings-connections")
    expect(connections?.description).toContain("Link a bank account or set up email forwarding")
    expect(connections?.description).not.toContain("connect your email set up")

    const pendingSteps = buildWalkthroughSteps({ ...baseCtx, pendingCount: 1 })
    const review = pendingSteps.find((s) => s.id === "review-header")
    expect(review?.description).toBe(
      "You have transactions waiting to be reviewed. Approve them before they hit your budget.",
    )
  })
})
