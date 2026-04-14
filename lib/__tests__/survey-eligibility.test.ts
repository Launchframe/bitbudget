import { describe, expect, it } from "vitest"
import { computeSurveyEligibility } from "@/lib/survey-eligibility"

const oldEnough = new Date(Date.now() - 8 * 86400000)

describe("computeSurveyEligibility", () => {
  it("not eligible before onboarding complete", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: false,
      createdAt: oldEnough,
      transactionCount: 5,
      hasReferralReceived: false,
      survey: null,
      sessionReferrerTrigger: false,
    })
    expect(r.eligible).toBe(false)
  })

  it("not eligible when completed", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: oldEnough,
      transactionCount: 5,
      hasReferralReceived: false,
      survey: {
        completedAt: new Date(),
        dismissType: null,
        currentStep: 6,
      },
      sessionReferrerTrigger: false,
    })
    expect(r.eligible).toBe(false)
  })

  it("not eligible when dismissed never", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: oldEnough,
      transactionCount: 5,
      hasReferralReceived: false,
      survey: {
        completedAt: null,
        dismissType: "never",
        currentStep: 2,
      },
      sessionReferrerTrigger: false,
    })
    expect(r.eligible).toBe(false)
  })

  it("general trigger: 7d + txn", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: oldEnough,
      transactionCount: 1,
      hasReferralReceived: false,
      survey: null,
      sessionReferrerTrigger: false,
    })
    expect(r.eligible).toBe(true)
    expect(r.triggerType).toBe("general")
  })

  it("referrer session trigger not eligible without transactions", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: new Date(),
      transactionCount: 0,
      hasReferralReceived: false,
      survey: null,
      sessionReferrerTrigger: true,
    })
    expect(r.eligible).toBe(false)
  })

  it("referrer session trigger when user has at least one transaction", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: new Date(),
      transactionCount: 1,
      hasReferralReceived: false,
      survey: null,
      sessionReferrerTrigger: true,
    })
    expect(r.eligible).toBe(true)
    expect(r.triggerType).toBe("referrer")
  })

  it("referee not eligible without transactions even after 7d", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: oldEnough,
      transactionCount: 0,
      hasReferralReceived: true,
      survey: null,
      sessionReferrerTrigger: false,
    })
    expect(r.eligible).toBe(false)
  })

  it("referee trigger when referred, 7d, and has transaction", () => {
    const r = computeSurveyEligibility({
      onboardingComplete: true,
      createdAt: oldEnough,
      transactionCount: 1,
      hasReferralReceived: true,
      survey: null,
      sessionReferrerTrigger: false,
    })
    expect(r.eligible).toBe(true)
    expect(r.triggerType).toBe("referee")
  })
})
